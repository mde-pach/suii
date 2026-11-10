// Slack notifications: tell people a question is waiting, and how it ended.
//
// Two ways to connect, both optional:
// - an incoming webhook (`slack-webhook-url`): one message when the question
//   opens, one when it closes;
// - a bot token and channel (`slack-bot-token`, `slack-channel`): one message
//   when the question opens, updated in place when it closes, plus a reply in
//   its thread.
// Messages carry the title, the link and the outcome, never the answer's values.
// A Slack failure is logged and never fails the step.

export interface SlackOptions {
  webhookUrl?: string;
  token?: string;
  channel?: string;
  /** Prepended to the opening message, e.g. `<!here>` or `<@U0123ABC>`. */
  mention?: string;
}

export interface QuestionInfo {
  title: string;
  issueUrl: string;
  issueNumber: number;
  repo: string;
  actor?: string;
  runUrl?: string;
  expiresAt?: Date;
}

export type Outcome = 'answered' | 'defaulted' | 'cancelled' | 'expired' | 'contested' | 'aborted' | 'error';

export interface OutcomeInfo {
  status: Outcome;
  by?: string | null;
}

/** Where the opening message went, so it can be updated (bot mode only). */
export interface SlackRef {
  channel: string;
  ts: string;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

const SLACK_API = 'https://slack.com/api';

/** Template text is markdown-escaped for GitHub; undo that, then escape for Slack. */
export function slackText(value: string): string {
  return value
    .replace(/​/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-!|<>~&.])/g, '$1')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtTime(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  answered: '✅ Answered',
  defaulted: '⏱️ Expired, default values used',
  cancelled: '🛑 Cancelled',
  expired: '⏱️ Expired without an answer',
  contested: '⚠️ Stopped after too many rejected edits',
  aborted: '🛑 Aborted: the workflow run stopped',
  error: '⚠️ Stopped on an error',
};

export function openingMessage(q: QuestionInfo, mention?: string): { text: string; blocks: unknown[] } {
  const title = slackText(q.title);
  const details = [`<${q.issueUrl}|${slackText(q.repo)}#${q.issueNumber}>`];
  if (q.actor) details.push(`requested by ${slackText(q.actor)}`);
  if (q.expiresAt) details.push(`answer before ${fmtTime(q.expiresAt)}`);
  const lead = mention ? `${mention} ` : '';
  return {
    text: `${lead}Waiting for an answer: ${title} ${q.issueUrl}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `${lead}*${title}*\n${details.join(' · ')}` } },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Answer on GitHub' }, url: q.issueUrl, style: 'primary' },
          ...(q.runUrl ? [{ type: 'button', text: { type: 'plain_text', text: 'Workflow run' }, url: q.runUrl }] : []),
        ],
      },
    ],
  };
}

export function closingMessage(q: QuestionInfo, o: OutcomeInfo): { text: string; blocks: unknown[] } {
  const title = slackText(q.title);
  const outcome = `${OUTCOME_TEXT[o.status]}${o.by ? ` by ${slackText(o.by)}` : ''}`;
  return {
    text: `${outcome}: ${title} ${q.issueUrl}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `~${title}~\n${outcome} · <${q.issueUrl}|${slackText(q.repo)}#${q.issueNumber}>` } },
    ],
  };
}

export class SlackNotifier {
  constructor(
    private opts: SlackOptions,
    private log: (msg: string) => void = () => {},
    private fetchImpl: Fetch = globalThis.fetch as unknown as Fetch,
  ) {}

  get enabled(): boolean {
    return Boolean(this.opts.webhookUrl || (this.opts.token && this.opts.channel));
  }

  private async webhook(payload: object): Promise<void> {
    const res = await this.fetchImpl(this.opts.webhookUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`webhook answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  private async api(method: string, payload: object): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${this.opts.token}` },
      body: JSON.stringify(payload),
    });
    const body = JSON.parse((await res.text()) || '{}') as Record<string, unknown>;
    if (!res.ok || body.ok !== true) throw new Error(`${method} failed: ${String(body.error ?? `HTTP ${res.status}`)}`);
    return body;
  }

  /** Announce a new question. Returns where it was posted when the message can be updated later. */
  async opened(q: QuestionInfo): Promise<SlackRef | null> {
    if (!this.enabled) return null;
    const msg = openingMessage(q, this.opts.mention);
    try {
      if (this.opts.token && this.opts.channel) {
        const res = await this.api('chat.postMessage', { channel: this.opts.channel, unfurl_links: false, ...msg });
        return { channel: String(res.channel), ts: String(res.ts) };
      }
      await this.webhook({ unfurl_links: false, ...msg });
    } catch (e) {
      this.log(`Slack: could not announce the question (${(e as Error).message}).`);
    }
    return null;
  }

  /** Report how the question ended: update the opening message when possible, else post a new one. */
  async closed(q: QuestionInfo, o: OutcomeInfo, ref: SlackRef | null): Promise<void> {
    if (!this.enabled) return;
    const msg = closingMessage(q, o);
    try {
      if (this.opts.token && ref) {
        await this.api('chat.update', { channel: ref.channel, ts: ref.ts, ...msg });
        await this.api('chat.postMessage', { channel: ref.channel, thread_ts: ref.ts, text: msg.text, unfurl_links: false });
        return;
      }
      if (this.opts.token && this.opts.channel) {
        await this.api('chat.postMessage', { channel: this.opts.channel, unfurl_links: false, ...msg });
        return;
      }
      await this.webhook({ unfurl_links: false, ...msg });
    } catch (e) {
      this.log(`Slack: could not report the outcome (${(e as Error).message}).`);
    }
  }
}
