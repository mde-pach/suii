// Loads a suii template (YAML + Liquid) and renders it into a Form.
import { Liquid } from 'liquidjs';
import { parse as parseYaml } from 'yaml';
import { codeSpan, escapeMarkdown, oneLine } from './escape.js';
import type {
  Bucket,
  Field,
  FieldType,
  Form,
  Option,
  RawField,
  RawOption,
  RawOptionsFrom,
  RawTemplate,
} from './types.js';

export class TemplateError extends Error {
  override name = 'TemplateError';
}

const FIELD_TYPES: FieldType[] = ['choice', 'multi', 'confirm', 'rank', 'buckets'];
const ID_RE = /^[a-z][a-z0-9_-]{0,62}$/;
/** Output names suii sets itself; a field cannot use them. */
const RESERVED_IDS = new Set(['status', 'values', 'responder', 'answered-at', 'issue-number', 'issue-url']);

export type RenderContext = Record<string, unknown>;

function makeLiquid(escape: boolean): Liquid {
  const liquid = new Liquid({
    ownPropertyOnly: true,
    strictFilters: true,
    ...(escape ? { outputEscape: escapeMarkdown } : {}),
  });
  // `code` renders a safe inline code span; it is never escaped again.
  liquid.registerFilter('code', { handler: (v: unknown) => codeSpan(v), raw: true });
  // `short` truncates, e.g. a commit SHA: {{ sha | short }} or {{ sha | short: 10 }}
  liquid.registerFilter('short', (v: unknown, n: unknown = 7) => String(v ?? '').slice(0, Number(n)));
  return liquid;
}

/** Markdown rendering: every `{{ }}` output is escaped unless it ends with `| raw` or `| code`. */
const md = makeLiquid(true);
/** Plain rendering for values and conditions: nothing is escaped. */
const plain = makeLiquid(false);

function renderMd(source: string, ctx: RenderContext, where: string): string {
  try {
    return md.parseAndRenderSync(source, ctx);
  } catch (e) {
    throw new TemplateError(`${where}: ${(e as Error).message}`);
  }
}

function renderPlain(source: string, ctx: RenderContext, where: string): string {
  try {
    return plain.parseAndRenderSync(source, ctx);
  } catch (e) {
    throw new TemplateError(`${where}: ${(e as Error).message}`);
  }
}

/** A condition is a boolean, a Liquid expression (`item.ok == false`), or a template rendering to true/false. */
function evalCondition(cond: boolean | string | undefined, ctx: RenderContext, where: string): boolean {
  if (cond === undefined || cond === null) return false;
  if (typeof cond === 'boolean') return cond;
  const src = String(cond).trim();
  if (src === '') return false;
  const out = src.includes('{{') || src.includes('{%')
    ? renderPlain(src, ctx, where)
    : renderPlain(`{% if ${src} %}true{% else %}false{% endif %}`, ctx, where);
  return out.trim().toLowerCase() === 'true';
}

/** Resolve `data.plan` (a dotted path) in the render context. */
function evalPath(expr: string, ctx: RenderContext, where: string): unknown {
  let cur: unknown = ctx;
  for (const part of expr.split('.')) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      throw new TemplateError(`${where}: \`${expr}\` was not found in the render context`);
    }
  }
  return cur;
}

/** Parse template YAML text into a RawTemplate, with structural validation. */
export function parseTemplate(text: string): RawTemplate {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new TemplateError(`Template is not valid YAML: ${(e as Error).message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new TemplateError('Template must be a YAML mapping with `title` and `fields`.');
  }
  const t = doc as Record<string, unknown>;
  if (typeof t.title !== 'string' || t.title.trim() === '') {
    throw new TemplateError('Template needs a non-empty `title`.');
  }
  if (!Array.isArray(t.fields) || t.fields.length === 0) {
    throw new TemplateError('Template needs at least one entry in `fields`.');
  }
  const ids = new Set<string>();
  t.fields.forEach((f: unknown, i: number) => {
    const where = `fields[${i}]`;
    if (!f || typeof f !== 'object') throw new TemplateError(`${where} must be a mapping.`);
    const field = f as Record<string, unknown>;
    const id = field.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      throw new TemplateError(`${where}.id must match ${ID_RE} (got ${JSON.stringify(id)}).`);
    }
    if (RESERVED_IDS.has(id)) throw new TemplateError(`${where}.id \`${id}\` is reserved for suii's own outputs.`);
    if (ids.has(id)) throw new TemplateError(`Field id \`${id}\` is used twice.`);
    ids.add(id);
    if (!FIELD_TYPES.includes(field.type as FieldType)) {
      throw new TemplateError(`Field \`${id}\`: type must be one of ${FIELD_TYPES.join(', ')}.`);
    }
    if (typeof field.label !== 'string' || field.label.trim() === '') {
      throw new TemplateError(`Field \`${id}\` needs a \`label\`.`);
    }
    if (field.type !== 'confirm' && !field.options) {
      throw new TemplateError(`Field \`${id}\` (${String(field.type)}) needs \`options\`.`);
    }
    if (field.type === 'buckets') {
      const b = field.buckets;
      if (!Array.isArray(b) || b.length < 2) {
        throw new TemplateError(`Field \`${id}\` (buckets) needs at least two \`buckets\`.`);
      }
      const bids = new Set<string>();
      for (const bucket of b as Record<string, unknown>[]) {
        if (typeof bucket?.id !== 'string' || !ID_RE.test(bucket.id) || typeof bucket.label !== 'string') {
          throw new TemplateError(`Field \`${id}\`: each bucket needs an \`id\` matching ${ID_RE} and a \`label\`.`);
        }
        if (bids.has(bucket.id)) throw new TemplateError(`Field \`${id}\`: bucket id \`${bucket.id}\` is used twice.`);
        bids.add(bucket.id);
      }
    }
  });
  return t as unknown as RawTemplate;
}

function renderOptions(field: RawField, ctx: RenderContext): Option[] {
  const where = `field \`${field.id}\``;
  const spec = field.options;
  if (!spec) return [];
  const out: Option[] = [];

  const build = (o: RawOption | RawOptionsFrom, scope: RenderContext, label: string): void => {
    if (o.if !== undefined && !evalCondition(o.if, scope, `${where} option if`)) return;
    const renderedLabel = oneLine(renderMd(label, scope, `${where} option label`)).trim();
    const value = o.value !== undefined
      ? oneLine(renderPlain(String(o.value), scope, `${where} option value`)).trim()
      : oneLine(renderPlain(label, scope, `${where} option value`)).trim();
    const bucket = o.bucket !== undefined
      ? oneLine(renderPlain(String(o.bucket), scope, `${where} option bucket`)).trim()
      : undefined;
    out.push({
      label: renderedLabel,
      value,
      disabled: evalCondition(o.disabled, scope, `${where} option disabled`),
      default: evalCondition(o.default, scope, `${where} option default`),
      ...(bucket ? { bucket } : {}),
    });
  };

  if (Array.isArray(spec)) {
    spec.forEach((o, i) => {
      if (typeof o === 'string') {
        build({ label: o }, ctx, o);
      } else if (o && typeof o.label === 'string') {
        build(o, ctx, o.label);
      } else {
        throw new TemplateError(`${where}: options[${i}] needs a \`label\`.`);
      }
    });
  } else {
    if (typeof spec.from !== 'string' || typeof spec.label !== 'string') {
      throw new TemplateError(`${where}: generated options need \`from\` and \`label\`.`);
    }
    const items = evalPath(spec.from, ctx, where);
    if (!Array.isArray(items)) {
      throw new TemplateError(`${where}: \`${spec.from}\` must be an array (got ${items === null ? 'null' : typeof items}).`);
    }
    items.forEach((item, index) => build(spec, { ...ctx, item, index }, spec.label));
    if (spec.limit !== undefined && out.length > spec.limit) out.length = spec.limit;
  }
  return out;
}

function checkField(field: Field): void {
  const where = `Field \`${field.id}\``;
  const values = new Set<string>();
  const labels = new Set<string>();
  for (const o of field.options) {
    if (o.value === '') throw new TemplateError(`${where}: an option rendered an empty value.`);
    if (o.label === '') throw new TemplateError(`${where}: an option rendered an empty label.`);
    if (values.has(o.value)) throw new TemplateError(`${where}: option value \`${o.value}\` appears twice.`);
    if (labels.has(o.label)) throw new TemplateError(`${where}: option label \`${o.label}\` appears twice; labels must be unique.`);
    values.add(o.value);
    labels.add(o.label);
  }
  if (field.type === 'choice' && field.options.filter((o) => o.default && !o.disabled).length > 1) {
    throw new TemplateError(`${where}: a choice field can have at most one default option.`);
  }
  if (field.type === 'multi') {
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      throw new TemplateError(`${where}: min is greater than max.`);
    }
  }
  if (field.type === 'buckets') {
    const ids = new Set(field.buckets.map((b) => b.id));
    for (const o of field.options) {
      if (o.bucket && !ids.has(o.bucket)) {
        throw new TemplateError(`${where}: option \`${o.value}\` starts in unknown bucket \`${o.bucket}\`.`);
      }
    }
  }
}

/** Render a parsed template into a Form with the given context (`data`, `run`, `vars`). */
export function renderTemplate(t: RawTemplate, ctx: RenderContext): Form {
  const title = oneLine(renderMd(t.title, ctx, 'title')).trim();
  if (!title) throw new TemplateError('`title` rendered empty.');
  const intro = t.intro ? renderMd(t.intro, ctx, 'intro').trim() : '';
  const fields: Field[] = t.fields.map((f) => {
    const options = f.type === 'confirm' ? [] : renderOptions(f, ctx);
    const buckets: Bucket[] = (f.buckets ?? []).map((b) => ({
      id: b.id,
      label: oneLine(renderMd(b.label, ctx, `field \`${f.id}\` bucket label`)).trim(),
    }));
    const field: Field = {
      id: f.id,
      type: f.type,
      label: oneLine(renderMd(f.label, ctx, `field \`${f.id}\` label`)).trim(),
      ...(f.description ? { description: renderMd(f.description, ctx, `field \`${f.id}\` description`).trim() } : {}),
      // Choice fields are required unless said otherwise; others are optional.
      required: f.required ?? (f.type === 'choice'),
      default: f.type === 'confirm' ? Boolean(f.default) : false,
      ...(f.min !== undefined ? { min: Number(f.min) } : {}),
      ...(f.max !== undefined ? { max: Number(f.max) } : {}),
      ...(f.top !== undefined ? { top: Number(f.top) } : {}),
      buckets,
      options,
    };
    checkField(field);
    return field;
  });
  const submit = t.submit ? oneLine(renderMd(t.submit, ctx, 'submit')).trim() : 'Submit';
  const cancel = t.cancel === undefined ? true : t.cancel !== false && t.cancel !== 'false';
  const cancelLabel = typeof t.cancel === 'string' && t.cancel !== 'true' && t.cancel !== 'false'
    ? oneLine(renderMd(t.cancel, ctx, 'cancel')).trim()
    : 'Cancel';
  return { title, intro, fields, submitLabel: submit, cancel, cancelLabel };
}

/** Required choice/multi/rank/buckets fields with nothing selectable make the form empty. */
export function emptyFields(form: Form): string[] {
  return form.fields
    .filter((f) => f.type !== 'confirm' && f.required && f.options.every((o) => o.disabled))
    .map((f) => f.id);
}
