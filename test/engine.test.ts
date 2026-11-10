import { describe, expect, it } from 'vitest';
import type { CreatedIssue, Edit, IssueApi, IssueSnapshot } from '../src/api.js';
import { Authorizer } from '../src/auth.js';
import { runEngine, type Clock } from '../src/engine.js';
import { renderForm } from '../src/form.js';
import { parseTemplate, renderTemplate } from '../src/template.js';

const SELF = 'github-actions[bot]';

const form = renderTemplate(
  parseTemplate(`
title: Pick
fields:
  - id: env
    type: choice
    label: Env
    options:
      - { label: Staging, value: staging }
      - { label: Production, value: prod }
`),
  {},
);
const { body: initial, layout } = renderForm(form, { marker: 'suii:v1 repo=o/r run=1 attempt=1 job=j step=s' });

/** A tiny in-memory GitHub: scripted human edits happen at given poll numbers. */
class FakeGitHub implements IssueApi {
  body = initial;
  state: 'open' | 'closed' = 'open';
  closedBy: string | null = null;
  edits: Edit[] = [];
  comments: string[] = [];
  roles: Record<string, string> = { alice: 'write', bob: 'read', carol: 'admin' };
  version = 0;
  t = 1_000_000;

  constructor(private script: Record<number, (gh: FakeGitHub) => void>) {}
  poll = 0;

  humanEdit(login: string, change: (b: string) => string): void {
    this.body = change(this.body);
    this.t += 1000;
    this.edits.push({ editor: login, isBot: false, editedAt: new Date(this.t).toISOString() });
    this.version++;
  }

  async createIssue(): Promise<CreatedIssue> {
    return { number: 1, url: 'u', author: SELF, createdAt: new Date(0).toISOString() };
  }
  async getIssue(_n: number, etag?: string) {
    this.poll++;
    this.script[this.poll]?.(this);
    if (etag === String(this.version)) return { notModified: true as const };
    const issue: IssueSnapshot = { body: this.body, state: this.state, closedBy: this.closedBy, updatedAt: '' };
    return { notModified: false as const, etag: String(this.version), issue };
  }
  async getEdits() {
    return this.edits;
  }
  async updateIssue(_n: number, p: { body?: string; state?: 'open' | 'closed' }) {
    if (p.body !== undefined) this.body = p.body;
    if (p.state) this.state = p.state;
    this.t += 1000;
    this.edits.push({ editor: 'github-actions', isBot: true, editedAt: new Date(this.t).toISOString() });
    this.version++;
  }
  async setLabels() {}
  async comment(_n: number, b: string) {
    this.comments.push(b);
  }
  async lock() {}
  async role(login: string) {
    return this.roles[login] ?? 'none';
  }
  async inTeam() {
    return false;
  }
}

function fakeClock(): Clock {
  let now = 0;
  return { now: () => now, sleep: async (ms) => void (now += ms) };
}

const tick = (label: string) => (b: string) => b.replace(`- [ ] ${label}`, `- [x] ${label}`);

function run(gh: FakeGitHub, extra: Partial<Parameters<typeof runEngine>[0]> = {}) {
  const auth = new Authorizer(gh, { minPermission: 'write', allowedUsers: [], allowedTeams: [], forbidSelf: false, actor: 'alice', self: SELF });
  return runEngine({
    api: gh,
    auth,
    form,
    layout,
    issueNumber: 1,
    body: initial,
    self: SELF,
    createdAt: new Date(0).toISOString(),
    deadline: 60_000,
    pollMs: 1000,
    maxReverts: 3,
    onTimeout: 'fail',
    clock: fakeClock(),
    ...extra,
  });
}

describe('engine', () => {
  it('returns the answer once an allowed person submits', async () => {
    const gh = new FakeGitHub({
      2: (g) => g.humanEdit('alice', tick('Production')),
      4: (g) => g.humanEdit('alice', tick('**Submit**')),
    });
    const r = await run(gh);
    expect(r).toMatchObject({ status: 'answered', values: { env: 'prod' }, responder: 'alice' });
  });

  it('reverts edits by people without access', async () => {
    const gh = new FakeGitHub({
      2: (g) => g.humanEdit('bob', (b) => tick('**Submit**')(tick('Staging')(b))),
      5: (g) => g.humanEdit('alice', (b) => tick('**Submit**')(tick('Production')(b))),
    });
    const r = await run(gh);
    expect(gh.comments[0]).toMatch(/@bob \(needs write access \(has read\)\)/);
    expect(r).toMatchObject({ status: 'answered', values: { env: 'prod' }, responder: 'alice' });
  });

  it('reverts edits that change more than checkboxes', async () => {
    const gh = new FakeGitHub({
      2: (g) => g.humanEdit('alice', (b) => b.replace('- [ ] Staging', '- [x] Staging — trust me')),
      4: (g) => g.humanEdit('alice', (b) => tick('**Submit**')(tick('Staging')(b))),
    });
    const r = await run(gh);
    expect(gh.comments[0]).toMatch(/only ticking boxes/);
    expect(r).toMatchObject({ status: 'answered', values: { env: 'staging' } });
  });

  it('unticks Submit and explains when the answer is incomplete', async () => {
    const gh = new FakeGitHub({
      2: (g) => g.humanEdit('alice', tick('**Submit**')),
      4: (g) => g.humanEdit('alice', (b) => tick('**Submit**')(tick('Staging')(b))),
    });
    const r = await run(gh);
    expect(gh.comments[0]).toMatch(/not complete yet/);
    expect(gh.comments[0]).toMatch(/pick one option/);
    expect(r).toMatchObject({ status: 'answered', values: { env: 'staging' } });
  });

  it('cancels when an allowed person ticks Cancel', async () => {
    const gh = new FakeGitHub({ 2: (g) => g.humanEdit('carol', tick('Cancel')) });
    expect(await run(gh)).toMatchObject({ status: 'cancelled', by: 'carol' });
  });

  it('treats closing by an allowed person as cancel, and reopens otherwise', async () => {
    const gh = new FakeGitHub({
      2: (g) => {
        g.state = 'closed';
        g.closedBy = 'bob';
        g.version++;
      },
      5: (g) => {
        g.state = 'closed';
        g.closedBy = 'alice';
        g.version++;
      },
    });
    const r = await run(gh);
    expect(gh.comments[0]).toMatch(/Reopened/);
    expect(r).toMatchObject({ status: 'cancelled', by: 'alice' });
  });

  it('expires at the deadline, or uses defaults when allowed', async () => {
    expect(await run(new FakeGitHub({}), { deadline: 5000 })).toMatchObject({ status: 'expired' });
    expect(await run(new FakeGitHub({}), { deadline: 5000, onTimeout: 'default' })).toMatchObject({ status: 'expired' });
  });

  it('gives up as contested after too many reverts', async () => {
    const script: Record<number, (g: FakeGitHub) => void> = {};
    for (let i = 2; i < 40; i += 2) script[i] = (g) => g.humanEdit('bob', tick('Staging'));
    const r = await run(new FakeGitHub(script));
    expect(r).toMatchObject({ status: 'contested', rejected: ['bob'] });
  });

  it('enforces the four-eyes rule', async () => {
    const gh = new FakeGitHub({
      2: (g) => g.humanEdit('alice', (b) => tick('**Submit**')(tick('Staging')(b))),
      4: (g) => g.humanEdit('carol', (b) => tick('**Submit**')(tick('Production')(b))),
    });
    const auth = new Authorizer(gh, { minPermission: 'write', allowedUsers: [], allowedTeams: [], forbidSelf: true, actor: 'alice', self: SELF });
    const r = await run(gh, { auth });
    expect(gh.comments[0]).toMatch(/four-eyes/);
    expect(r).toMatchObject({ status: 'answered', responder: 'carol', values: { env: 'prod' } });
  });

  it('waits for the edit history before trusting a changed body', async () => {
    const gh = new FakeGitHub({
      2: (g) => {
        g.body = tick('Staging')(g.body); // body changed, edit not recorded yet
        g.version++;
      },
      4: (g) => {
        g.t += 1000;
        g.edits.push({ editor: 'alice', isBot: false, editedAt: new Date(g.t).toISOString() });
        g.body = tick('**Submit**')(g.body);
        g.version++;
      },
    });
    expect(await run(gh)).toMatchObject({ status: 'answered', values: { env: 'staging' } });
    expect(gh.comments).toEqual([]);
  });
});
