// Closing an issue: freeze the body into a record, label, comment, close, lock.
import type { IssueApi } from './api.js';
import { freezeBody, normalizeLines, readForm, type FreezeStatus, type Layout } from './form.js';
import type { Values } from './types.js';

const STATUS_LABEL: Record<FreezeStatus, string> = {
  answered: 'suii:answered',
  defaulted: 'suii:expired',
  cancelled: 'suii:cancelled',
  expired: 'suii:expired',
  contested: 'suii:contested',
  aborted: 'suii:aborted',
  error: 'suii:error',
};

/** Freeze when the body still matches the layout; otherwise just neutralise the checkboxes. */
export function safeFreeze(
  body: string,
  layout: Layout | null,
  status: FreezeStatus,
  detail: Parameters<typeof freezeBody>[3],
): string {
  if (layout) {
    try {
      readForm(body, layout);
      return freezeBody(body, layout, status, detail);
    } catch {
      // fall through to the loose freeze
    }
  }
  const lines = normalizeLines(body).map((l) =>
    l.replace(/^(\s*[-*+]\s+)\[([ xX])\]/, (_m, p: string, mark: string) => `${p}${mark === ' ' ? '⬜' : '✅'}`),
  );
  const [marker, ...rest] = lines;
  const note = detail.note ? `> ${detail.note}` : `> Closed by suii (${status}).`;
  return [marker ?? '', `> [!WARNING]`, note, '', ...rest].join('\n') + '\n';
}

export async function closeIssue(
  api: IssueApi,
  number: number,
  p: {
    body: string;
    layout: Layout | null;
    status: FreezeStatus;
    by?: string | null;
    at?: Date;
    values?: Values;
    note?: string;
    comment?: string;
    lock: boolean;
    log?: (m: string) => void;
  },
): Promise<void> {
  const log = p.log ?? (() => {});
  const frozen = safeFreeze(p.body, p.layout, p.status, {
    ...(p.by ? { by: p.by } : {}),
    ...(p.at ? { at: p.at } : {}),
    ...(p.values ? { values: p.values } : {}),
    ...(p.note ? { note: p.note } : {}),
  });
  const reason = p.status === 'answered' || p.status === 'defaulted' ? 'completed' : 'not_planned';
  // Each step is best effort: a failure here must not hide the result.
  const steps: [string, () => Promise<void>][] = [
    ['update the issue', () => api.updateIssue(number, { body: frozen, state: 'closed', stateReason: reason })],
    ['update labels', () => api.setLabels(number, [STATUS_LABEL[p.status]], ['suii:pending'])],
  ];
  if (p.comment) steps.push(['comment', () => api.comment(number, p.comment!)]);
  if (p.lock) steps.push(['lock the issue', () => api.lock(number)]);
  for (const [what, fn] of steps) {
    try {
      await fn();
    } catch (e) {
      log(`Could not ${what}: ${(e as Error).message}`);
    }
  }
}
