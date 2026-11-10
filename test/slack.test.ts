import { describe, expect, it } from 'vitest';
import { closingMessage, openingMessage, SlackNotifier, slackText, type QuestionInfo } from '../src/slack.js';

const question: QuestionInfo = {
  title: 'Deploy production: choose \\<the\\> migration \\- \\#\u200b12 & more',
  issueUrl: 'https://github.com/o/r/issues/7',
  issueNumber: 7,
  repo: 'o/r',
  actor: 'alice',
  runUrl: 'https://github.com/o/r/actions/runs/1',
  expiresAt: new Date('2026-11-10T15:00:00Z'),
};

/** Records every request; answers with the queued responses (default: Slack ok). */
function fakeFetch(responses: { status?: number; body?: unknown }[] = []) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const impl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const r = responses.shift() ?? { body: { ok: true, channel: 'C1', ts: '111.222' } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})) };
  };
  return { calls, impl };
}

describe('slack text', () => {
  it('undoes GitHub markdown escaping, then escapes for Slack', () => {
    expect(slackText(question.title)).toBe('Deploy production: choose &lt;the&gt; migration - #12 &amp; more');
  });

  it('builds an opening message with a link, details and buttons', () => {
    const m = openingMessage(question, '<!here>');
    expect(m.text).toContain('<!here> Waiting for an answer');
    const section = JSON.stringify(m.blocks[0]);
    expect(section).toContain('<https://github.com/o/r/issues/7|o/r#7>');
    expect(section).toContain('requested by alice');
    expect(section).toContain('answer before 2026-11-10 15:00 UTC');
    expect(JSON.stringify(m.blocks[1])).toContain('Answer on GitHub');
  });

  it('builds a closing message with the outcome and who, never the values', () => {
    const m = closingMessage(question, { status: 'answered', by: 'bob' });
    expect(m.text).toMatch(/^✅ Answered by bob/);
    expect(JSON.stringify(m.blocks)).toContain('~Deploy production');
  });
});

describe('webhook mode', () => {
  it('posts once when the question opens and once when it closes', async () => {
    const f = fakeFetch([{ body: 'ok' }, { body: 'ok' }]);
    const slack = new SlackNotifier({ webhookUrl: 'https://hooks.slack.com/services/T/B/X' }, () => {}, f.impl);
    const ref = await slack.opened(question);
    expect(ref).toBeNull();
    await slack.closed(question, { status: 'expired' }, ref);
    expect(f.calls.map((c) => c.url)).toEqual(['https://hooks.slack.com/services/T/B/X', 'https://hooks.slack.com/services/T/B/X']);
    expect(f.calls[1]!.body.text).toMatch(/^⏱️ Expired without an answer/);
  });
});

describe('bot mode', () => {
  it('posts, then updates the message in place and replies in its thread', async () => {
    const f = fakeFetch();
    const slack = new SlackNotifier({ token: 'xoxb-1', channel: '#deploys', mention: '<@U1>' }, () => {}, f.impl);
    const ref = await slack.opened(question);
    expect(ref).toEqual({ channel: 'C1', ts: '111.222' });
    await slack.closed(question, { status: 'cancelled', by: 'carol' }, ref);

    expect(f.calls.map((c) => c.url.split('/').pop())).toEqual(['chat.postMessage', 'chat.update', 'chat.postMessage']);
    expect(f.calls[0]!.headers.authorization).toBe('Bearer xoxb-1');
    expect(f.calls[0]!.body.channel).toBe('#deploys');
    expect(f.calls[1]!.body).toMatchObject({ channel: 'C1', ts: '111.222' });
    expect(f.calls[2]!.body).toMatchObject({ channel: 'C1', thread_ts: '111.222' });
    expect(f.calls[2]!.body.text).toMatch(/^🛑 Cancelled by carol/);
  });

  it('posts a new message when the opening one could not be sent', async () => {
    const logs: string[] = [];
    const f = fakeFetch([{ body: { ok: false, error: 'channel_not_found' } }]);
    const slack = new SlackNotifier({ token: 'xoxb-1', channel: '#nope' }, (m) => logs.push(m), f.impl);
    const ref = await slack.opened(question);
    expect(ref).toBeNull();
    expect(logs[0]).toMatch(/channel_not_found/);
    await slack.closed(question, { status: 'answered', by: 'bob' }, ref);
    expect(f.calls.map((c) => c.url.split('/').pop())).toEqual(['chat.postMessage', 'chat.postMessage']);
  });
});

describe('failures', () => {
  it('never throws, and logs instead', async () => {
    const logs: string[] = [];
    const broken = async () => {
      throw new Error('network down');
    };
    const slack = new SlackNotifier({ webhookUrl: 'https://hooks.slack.com/x' }, (m) => logs.push(m), broken as never);
    await expect(slack.opened(question)).resolves.toBeNull();
    await expect(slack.closed(question, { status: 'error' }, null)).resolves.toBeUndefined();
    expect(logs).toHaveLength(2);
  });

  it('does nothing when Slack is not configured', async () => {
    const f = fakeFetch();
    const slack = new SlackNotifier({}, () => {}, f.impl);
    expect(slack.enabled).toBe(false);
    await slack.opened(question);
    await slack.closed(question, { status: 'answered' }, null);
    expect(f.calls).toHaveLength(0);
  });

  it('reports HTTP errors from the webhook', async () => {
    const logs: string[] = [];
    const f = fakeFetch([{ status: 404, body: 'no_service' }]);
    const slack = new SlackNotifier({ webhookUrl: 'https://hooks.slack.com/x' }, (m) => logs.push(m), f.impl);
    await slack.opened(question);
    expect(logs[0]).toMatch(/HTTP 404: no_service/);
  });
});
