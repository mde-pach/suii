// The wait loop: poll the issue until it is answered, cancelled or expired.
import { sameLogin, type Edit, type IssueApi } from './api.js';
import type { Authorizer } from './auth.js';
import {
  defaultValues,
  evaluate,
  normalizeLines,
  readForm,
  setCheck,
  TamperError,
  type Layout,
} from './form.js';
import type { Form, Values } from './types.js';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface EngineOptions {
  api: IssueApi;
  auth: Authorizer;
  form: Form;
  layout: Layout;
  issueNumber: number;
  /** The body as created. */
  body: string;
  /** suii's own login (the issue author). */
  self: string;
  createdAt: string;
  deadline: number;
  pollMs: number;
  maxReverts: number;
  onTimeout: 'fail' | 'default';
  clock?: Clock;
  log?: Logger;
  /** Called whenever the accepted body changes, so the post hook can freeze the latest state. */
  onAccepted?: (body: string) => void;
}

export type EngineResult =
  | { status: 'answered'; values: Values; responder: string; at: Date; body: string; contributors: string[] }
  | { status: 'defaulted'; values: Values; body: string }
  | { status: 'cancelled'; by: string | null; body: string; values: Values }
  | { status: 'expired'; body: string }
  | { status: 'contested'; body: string; rejected: string[] };

/** Polls left unanswered by the edit history before an unexplained change is reverted. */
const UNVERIFIED_LIMIT = 6;

function same(a: string, b: string): boolean {
  const x = normalizeLines(a);
  const y = normalizeLines(b);
  return x.length === y.length && x.every((l, i) => l === y[i]);
}

function mentions(logins: string[]): string {
  return logins.map((l) => `@${l}`).join(', ');
}

export async function runEngine(o: EngineOptions): Promise<EngineResult> {
  const clock = o.clock ?? realClock;
  const log = o.log ?? { info: () => {}, warn: () => {} };
  const { api, auth, form, layout, issueNumber: n } = o;

  let accepted = o.body;
  let lastSeen = Date.parse(o.createdAt) || 0;
  let etag: string | undefined;
  let reverts = 0;
  let unverified = 0;
  const rejected = new Set<string>();
  const contributors = new Set<string>();

  const accept = (body: string): void => {
    accepted = body;
    o.onAccepted?.(body);
  };

  const revert = async (reason: string): Promise<EngineResult | null> => {
    reverts++;
    log.warn(`Reverting the issue body: ${reason}`);
    await api.updateIssue(n, { body: accepted });
    await api.comment(n, `↩️ The last edit was reverted: ${reason}`);
    etag = undefined;
    if (reverts > o.maxReverts) {
      return { status: 'contested', body: accepted, rejected: [...rejected] };
    }
    return null;
  };

  const timeout = (): EngineResult => {
    if (o.onTimeout === 'default') {
      const values = defaultValues(form, layout);
      if (values) return { status: 'defaulted', values, body: accepted };
      log.warn('on-timeout is "default" but a required field has no default value.');
    }
    return { status: 'expired', body: accepted };
  };

  for (;;) {
    if (clock.now() >= o.deadline) return timeout();
    await clock.sleep(Math.min(o.pollMs, Math.max(0, o.deadline - clock.now())));
    if (clock.now() >= o.deadline) return timeout();

    const res = await api.getIssue(n, etag);
    if (res.notModified) continue;
    etag = res.etag;
    const issue = res.issue;

    // 1. Closed by someone.
    if (issue.state === 'closed') {
      const closer = issue.closedBy;
      const verdict = closer && !sameLogin(closer, o.self) ? await auth.check(closer) : { ok: false, reason: 'unknown' };
      if (verdict.ok) {
        log.info(`Issue closed by @${closer}: treating it as a cancellation.`);
        return { status: 'cancelled', by: closer, body: accepted, values: {} };
      }
      log.warn(`Issue closed by ${closer ? '@' + closer : 'someone'} who cannot answer; reopening.`);
      await api.updateIssue(n, { state: 'open', stateReason: 'reopened' });
      await api.comment(
        n,
        `🔓 Reopened: ${closer ? '@' + closer + ' ' : ''}cannot close this request (${verdict.reason ?? 'not allowed'}). Tick **Cancel** instead if you are allowed to answer.`,
      );
      etag = undefined;
      continue;
    }

    // 2. Nothing changed in the body (a comment or a label changed the ETag).
    if (same(issue.body, accepted)) continue;

    // 3. Who changed it?
    const edits: Edit[] = (await api.getEdits(n)).filter(
      (e) => Date.parse(e.editedAt) > lastSeen && !sameLogin(e.editor, o.self),
    );
    if (edits.length === 0) {
      unverified++;
      if (unverified < UNVERIFIED_LIMIT) continue; // the edit history can lag behind the body
      unverified = 0;
      const r = await revert('suii could not tell who made it.');
      if (r) return r;
      continue;
    }
    unverified = 0;
    lastSeen = Math.max(lastSeen, ...edits.map((e) => Date.parse(e.editedAt)));

    const denied: { login: string; reason: string }[] = [];
    for (const e of edits) {
      const verdict = await auth.check(e.editor, e.isBot);
      if (!verdict.ok) denied.push({ login: e.editor ?? 'unknown', reason: verdict.reason ?? 'not allowed' });
    }
    if (denied.length > 0) {
      for (const d of denied) rejected.add(d.login);
      const who = denied.map((d) => `@${d.login} (${d.reason})`).join(', ');
      const r = await revert(`${who} cannot answer this request.`);
      if (r) return r;
      continue;
    }

    // 4. Only checkbox marks and in-group reordering may change.
    let state;
    try {
      state = readForm(issue.body, layout);
    } catch (e) {
      if (!(e instanceof TamperError)) throw e;
      const editors = [...new Set(edits.map((x) => x.editor ?? 'unknown'))];
      const r = await revert(
        `${mentions(editors)}: only ticking boxes and dragging list items is allowed (${e.message}).`,
      );
      if (r) return r;
      continue;
    }

    accept(issue.body);
    const lastEditor = [...edits].sort((a, b) => Date.parse(a.editedAt) - Date.parse(b.editedAt)).at(-1)!.editor!;
    for (const e of edits) if (e.editor) contributors.add(e.editor);

    const ev = evaluate(form, state);
    if (ev.cancel) {
      log.info(`Cancel ticked by @${lastEditor}.`);
      return { status: 'cancelled', by: lastEditor, body: accepted, values: ev.values };
    }
    if (!ev.submit) continue;

    if (ev.errors.length > 0) {
      log.info(`Submit ticked, but the answer is not valid yet: ${ev.errors.join(' ')}`);
      const unticked = setCheck(accepted, layout, { kind: 'submit' }, false);
      await api.updateIssue(n, { body: unticked });
      accept(unticked);
      etag = undefined;
      await api.comment(
        n,
        [`⚠️ @${lastEditor}, the answer is not complete yet, so **Submit** was unticked:`, '', ...ev.errors.map((x) => `- ${x}`)].join('\n'),
      );
      continue;
    }

    // 5. Make sure nothing moved since we read it, then accept.
    const again = await api.getIssue(n);
    if (!again.notModified && !same(again.issue.body, accepted)) {
      etag = undefined;
      continue;
    }
    return {
      status: 'answered',
      values: ev.values,
      responder: lastEditor,
      at: new Date(clock.now()),
      body: accepted,
      contributors: [...contributors],
    };
  }
}
