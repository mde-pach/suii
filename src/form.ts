// Renders a Form into issue markdown, and reads it back.
//
// The issue body is described by a Layout: one entry per line, in order.
// - static lines must come back unchanged (checkbox marks aside)
// - check lines are read for their checkbox state, by position only
// - group lines (rank / buckets fields) may be reordered by drag and drop,
//   but must stay the same set of lines inside their own group
// Values never come from the issue text: a line's meaning is its position in
// the layout, and the layout lives on the runner.
import { escapeMarkdown } from './escape.js';
import type { Field, FieldValue, Form, Values } from './types.js';

export type CheckRole =
  | { kind: 'option'; field: string; index: number }
  | { kind: 'confirm'; field: string }
  | { kind: 'submit' }
  | { kind: 'cancel' };

export type GroupRef = { kind: 'option'; index: number } | { kind: 'bucket'; id: string };

export type LayoutEntry =
  | { kind: 'static'; text: string; footer?: boolean }
  | { kind: 'check'; text: string; role: CheckRole }
  | { kind: 'group'; field: string; lines: { text: string; ref: GroupRef }[] };

export type Layout = LayoutEntry[];

export interface Meta {
  /** Marker identifying the run that owns the issue. Never trusted as input. */
  marker: string;
  actor?: string;
  runUrl?: string;
  runLabel?: string;
  expiresAt?: Date;
}

export interface FormState {
  checks: Map<string, boolean>;
  groups: Map<string, GroupRef[]>;
}

export class TamperError extends Error {
  override name = 'TamperError';
}

/** GitHub body limit is 65,536 characters; keep a margin for the frozen version. */
export const MAX_BODY = 60_000;

const CHECKBOX = /^(\s*[-*+]\s+)\[([ xX])\](?=\s|$)/;

export function roleKey(role: CheckRole): string {
  switch (role.kind) {
    case 'option':
      return `option:${role.field}:${role.index}`;
    case 'confirm':
      return `confirm:${role.field}`;
    default:
      return role.kind;
  }
}

/** Split a body into comparable lines: no CR, no trailing spaces, no trailing blank lines. */
export function normalizeLines(body: string): string[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** A line with any checkbox mark reset to unchecked. */
export function canonical(line: string): string {
  return line.replace(CHECKBOX, '$1[ ]');
}

function isChecked(line: string): boolean {
  const m = CHECKBOX.exec(line);
  return m !== null && (m[2] === 'x' || m[2] === 'X');
}

function box(checked: boolean): string {
  return checked ? '- [x] ' : '- [ ] ';
}

function hint(field: Field): string {
  const req = field.required ? 'required' : 'optional';
  switch (field.type) {
    case 'choice':
      return `Pick one · ${req}`;
    case 'multi': {
      const parts = ['Pick any'];
      if (field.min !== undefined && field.max !== undefined) parts[0] = `Pick ${field.min} to ${field.max}`;
      else if (field.min !== undefined) parts[0] = `Pick at least ${field.min}`;
      else if (field.max !== undefined) parts[0] = `Pick up to ${field.max}`;
      return `${parts[0]} · ${req}`;
    }
    case 'confirm':
      return field.required ? 'Must be ticked' : 'Optional';
    case 'rank':
      return field.top
        ? `Drag the ⠿ handle to reorder · the top ${field.top} count · ticking does nothing`
        : 'Drag the ⠿ handle to reorder · ticking does nothing';
    case 'buckets':
      return 'Drag each item under the group it belongs to · ticking does nothing';
  }
}

function fmtTime(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Render the form. Returns the issue body and the layout used to read it back. */
export function renderForm(form: Form, meta: Meta): { body: string; layout: Layout } {
  const layout: Layout = [];
  const st = (text: string, footer = false): void => {
    layout.push(footer ? { kind: 'static', text, footer } : { kind: 'static', text });
  };
  const blank = (): void => st('');

  st(`<!-- ${meta.marker} -->`);
  st('> [!NOTE]');
  const info: string[] = [];
  if (meta.actor) info.push(`requested by @${meta.actor}`);
  if (meta.runUrl) info.push(`[${meta.runLabel ?? 'workflow run'}](${meta.runUrl})`);
  if (meta.expiresAt) info.push(`answer before **${fmtTime(meta.expiresAt)}**`);
  const text = info.length ? info.join(' · ') : 'Answer below';
  st(`> ${text.charAt(0).toUpperCase()}${text.slice(1)}`);
  if (form.intro) {
    blank();
    for (const line of normalizeLines(form.intro)) st(line);
  }

  for (const field of form.fields) {
    blank();
    st(`### ${field.label}`);
    st(`<sub>${hint(field)}</sub>`);
    if (field.description) {
      blank();
      for (const line of normalizeLines(field.description)) st(line);
    }
    blank();
    switch (field.type) {
      case 'confirm':
        layout.push({ kind: 'check', text: `${box(field.default)}Yes`, role: { kind: 'confirm', field: field.id } });
        break;
      case 'choice':
      case 'multi':
        field.options.forEach((o, index) => {
          if (o.disabled) st(`- ~~${o.label}~~ · *unavailable*`);
          else layout.push({ kind: 'check', text: `${box(o.default)}${o.label}`, role: { kind: 'option', field: field.id, index } });
        });
        break;
      case 'rank': {
        const lines = field.options
          .map((o, index) => ({ o, index }))
          .filter(({ o }) => !o.disabled)
          .map(({ o, index }) => ({ text: `- [ ] ${o.label}`, ref: { kind: 'option', index } as GroupRef }));
        layout.push({ kind: 'group', field: field.id, lines });
        break;
      }
      case 'buckets': {
        const lines: { text: string; ref: GroupRef }[] = [];
        field.buckets.forEach((b, bi) => {
          lines.push({ text: `- [ ] **▸ ${b.label}**`, ref: { kind: 'bucket', id: b.id } });
          field.options.forEach((o, index) => {
            if (o.disabled) return;
            const home = o.bucket ?? field.buckets[0]?.id;
            if (home === b.id || (bi === 0 && !home)) {
              lines.push({ text: `- [ ] ${o.label}`, ref: { kind: 'option', index } });
            }
          });
        });
        layout.push({ kind: 'group', field: field.id, lines });
        break;
      }
    }
    // Lines inside one group must be distinguishable after a drag.
    const last = layout[layout.length - 1];
    if (last?.kind === 'group') {
      const seen = new Set<string>();
      for (const l of last.lines) {
        if (seen.has(canonical(l.text))) {
          throw new Error(`Field \`${field.id}\`: two lines render identically (\`${l.text}\`); make labels unique.`);
        }
        seen.add(canonical(l.text));
      }
    }
  }

  blank();
  st('---', true);
  st('', true);
  layout.push({ kind: 'check', text: `- [ ] **${form.submitLabel}**`, role: { kind: 'submit' } });
  if (form.cancel) layout.push({ kind: 'check', text: `- [ ] ${form.cancelLabel}`, role: { kind: 'cancel' } });
  st('', true);
  st(
    '<sub>Tick your answers, then tick <b>' +
      escapeMarkdown(form.submitLabel) +
      '</b>. Only people allowed by the workflow can answer. Edits other than ticking boxes and dragging list items are reverted.</sub>',
    true,
  );

  const body = layoutLines(layout).join('\n') + '\n';
  if (body.length > MAX_BODY) {
    throw new Error(`The rendered issue is ${body.length} characters, over the ${MAX_BODY} limit. Reduce the options (e.g. with \`limit\`).`);
  }
  return { body, layout };
}

/** The lines a layout renders to, in its original order. */
export function layoutLines(layout: Layout): string[] {
  const out: string[] = [];
  for (const e of layout) {
    if (e.kind === 'group') out.push(...e.lines.map((l) => l.text));
    else out.push(e.text);
  }
  return out;
}

/**
 * Read an issue body back against its layout.
 * Throws TamperError when anything other than checkbox marks and in-group
 * reordering changed.
 */
export function readForm(body: string, layout: Layout): FormState {
  const lines = normalizeLines(body);
  const expected = normalizeLines(layoutLines(layout).join('\n'));
  if (lines.length !== expected.length) {
    throw new TamperError(`the body has ${lines.length} lines instead of ${expected.length}`);
  }
  const checks = new Map<string, boolean>();
  const groups = new Map<string, GroupRef[]>();
  let i = 0;
  for (const entry of layout) {
    if (entry.kind === 'group') {
      const byText = new Map(entry.lines.map((l) => [canonical(l.text), l.ref] as const));
      const order: GroupRef[] = [];
      const used = new Set<string>();
      for (let k = 0; k < entry.lines.length; k++, i++) {
        const c = canonical(lines[i] ?? '');
        const ref = byText.get(c);
        if (!ref || used.has(c)) throw new TamperError(`line ${i + 1} does not belong to field \`${entry.field}\``);
        used.add(c);
        order.push(ref);
      }
      groups.set(entry.field, order);
      continue;
    }
    const line = lines[i] ?? '';
    // Trailing blank lines were stripped from both sides; an empty expected line matches an empty one.
    if (canonical(line) !== canonical(entry.text)) {
      throw new TamperError(`line ${i + 1} was changed`);
    }
    if (entry.kind === 'check') checks.set(roleKey(entry.role), isChecked(line));
    i++;
  }
  return { checks, groups };
}

/** Return `body` with one checkbox set or cleared (used to untick Submit). */
export function setCheck(body: string, layout: Layout, role: CheckRole, checked: boolean): string {
  const lines = normalizeLines(body);
  const key = roleKey(role);
  let i = 0;
  for (const entry of layout) {
    if (entry.kind === 'group') {
      i += entry.lines.length;
      continue;
    }
    if (entry.kind === 'check' && roleKey(entry.role) === key && lines[i] !== undefined) {
      lines[i] = canonical(lines[i]!).replace(CHECKBOX, checked ? '$1[x]' : '$1[ ]');
    }
    i++;
  }
  return lines.join('\n') + '\n';
}

export interface Evaluation {
  values: Values;
  errors: string[];
  submit: boolean;
  cancel: boolean;
}

/** Turn a read-back state into values, plus the reasons it is not a valid answer yet. */
export function evaluate(form: Form, state: FormState): Evaluation {
  const values: Values = {};
  const errors: string[] = [];
  for (const field of form.fields) {
    const label = `**${field.label}**`;
    switch (field.type) {
      case 'confirm': {
        const v = state.checks.get(roleKey({ kind: 'confirm', field: field.id })) ?? false;
        values[field.id] = v;
        if (field.required && !v) errors.push(`${label} must be ticked.`);
        break;
      }
      case 'choice': {
        const picked = field.options
          .map((o, index) => ({ o, index }))
          .filter(({ o, index }) => !o.disabled && state.checks.get(roleKey({ kind: 'option', field: field.id, index })));
        values[field.id] = picked.length === 1 ? picked[0]!.o.value : null;
        if (picked.length > 1) errors.push(`${label}: pick only one option (${picked.length} are ticked).`);
        else if (picked.length === 0 && field.required) errors.push(`${label}: pick one option.`);
        break;
      }
      case 'multi': {
        const picked = field.options
          .map((o, index) => ({ o, index }))
          .filter(({ o, index }) => !o.disabled && state.checks.get(roleKey({ kind: 'option', field: field.id, index })))
          .map(({ o }) => o.value);
        values[field.id] = picked;
        const min = field.min ?? (field.required ? 1 : 0);
        if (picked.length < min) errors.push(`${label}: pick at least ${min} (${picked.length} ticked).`);
        if (field.max !== undefined && picked.length > field.max) {
          errors.push(`${label}: pick at most ${field.max} (${picked.length} ticked).`);
        }
        break;
      }
      case 'rank': {
        const order = (state.groups.get(field.id) ?? [])
          .filter((r): r is { kind: 'option'; index: number } => r.kind === 'option')
          .map((r) => field.options[r.index]!.value);
        values[field.id] = field.top ? order.slice(0, field.top) : order;
        break;
      }
      case 'buckets': {
        const result: Record<string, string[]> = Object.fromEntries(field.buckets.map((b) => [b.id, [] as string[]]));
        let current: string | null = null;
        let stray = 0;
        for (const ref of state.groups.get(field.id) ?? []) {
          if (ref.kind === 'bucket') current = ref.id;
          else if (current === null) stray++;
          else result[current]!.push(field.options[ref.index]!.value);
        }
        values[field.id] = result;
        if (stray > 0) errors.push(`${label}: ${stray} item(s) sit above the first group; drag them under a group.`);
        break;
      }
    }
  }
  return {
    values,
    errors,
    submit: state.checks.get('submit') ?? false,
    cancel: state.checks.get('cancel') ?? false,
  };
}

/** The values used when nobody answered and `on-timeout: default`; null when a required field has no default. */
export function defaultValues(form: Form, layout: Layout): Values | null {
  const state = readForm(layoutLines(layout).join('\n'), layout);
  const result = evaluate(form, state);
  return result.errors.length === 0 ? result.values : null;
}

export type FreezeStatus = 'answered' | 'defaulted' | 'cancelled' | 'expired' | 'contested' | 'aborted' | 'error';

const STATUS_TEXT: Record<FreezeStatus, { alert: string; title: string }> = {
  answered: { alert: 'TIP', title: 'Answered' },
  defaulted: { alert: 'NOTE', title: 'Expired · default values used' },
  cancelled: { alert: 'WARNING', title: 'Cancelled' },
  expired: { alert: 'WARNING', title: 'Expired without an answer' },
  contested: { alert: 'CAUTION', title: 'Stopped: too many rejected edits' },
  aborted: { alert: 'WARNING', title: 'Aborted: the workflow run stopped' },
  error: { alert: 'CAUTION', title: 'Stopped on an error' },
};

function formatValue(v: FieldValue): string {
  return JSON.stringify(v);
}

/**
 * Turn the last accepted body into a read-only record: checkboxes become ✅ / ⬜,
 * ranked items become a numbered list, Submit / Cancel and the footer go away,
 * and a status note is added at the top.
 */
export function freezeBody(
  body: string,
  layout: Layout,
  status: FreezeStatus,
  detail: { by?: string; at?: Date; values?: Values; note?: string },
): string {
  const lines = normalizeLines(body);
  const out: string[] = [];
  let i = 0;
  for (const entry of layout) {
    if (entry.kind === 'group') {
      let rank = 0;
      for (let k = 0; k < entry.lines.length; k++, i++) {
        const line = canonical(lines[i] ?? '');
        const text = line.replace(/^(\s*)[-*+]\s+\[ \]\s?/, '');
        if (text.startsWith('**▸ ')) {
          rank = 0;
          out.push(`- ${text}`);
        } else {
          rank++;
          out.push(`${rank}. ${text}`);
        }
      }
      continue;
    }
    const line = lines[i] ?? entry.text;
    i++;
    if (entry.kind === 'static') {
      if (!entry.footer) out.push(line);
      continue;
    }
    if (entry.role.kind === 'submit' || entry.role.kind === 'cancel') continue;
    out.push(canonical(line).replace(/^(\s*[-*+]\s+)\[ \]/, isChecked(line) ? '$1✅' : '$1⬜'));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (out[out.length - 1] === '---') out.pop();

  const s = STATUS_TEXT[status];
  const head: string[] = [`> [!${s.alert}]`];
  const parts = [`**${s.title}**`];
  if (detail.by) parts.push(`by @${detail.by}`);
  if (detail.at) parts.push(`at ${fmtTime(detail.at)}`);
  head.push(`> ${parts.join(' ')}`);
  if (detail.note) head.push(`> ${detail.note}`);
  if (detail.values && Object.keys(detail.values).length > 0) {
    head.push('>');
    for (const [k, v] of Object.entries(detail.values)) head.push(`> - \`${k}\`: \`${formatValue(v).replace(/`/g, "'")}\``);
  }
  // Keep the marker first, then the status note, then the record.
  const [marker, ...rest] = out;
  return [marker ?? '', ...head, '', ...rest].join('\n') + '\n';
}
