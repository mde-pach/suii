// The GitHub operations suii needs, behind an interface so the engine can be tested.
import type { getOctokit } from '@actions/github';

export interface IssueSnapshot {
  body: string;
  state: 'open' | 'closed';
  closedBy: string | null;
  updatedAt: string;
}

export interface Edit {
  editor: string | null;
  isBot: boolean;
  editedAt: string;
}

export interface CreatedIssue {
  number: number;
  url: string;
  author: string;
  createdAt: string;
}

export interface IssueApi {
  createIssue(p: { title: string; body: string; labels: string[]; assignees: string[] }): Promise<CreatedIssue>;
  getIssue(number: number, etag?: string): Promise<{ notModified: true } | { notModified: false; etag?: string; issue: IssueSnapshot }>;
  getEdits(number: number): Promise<Edit[]>;
  updateIssue(number: number, p: { body?: string; state?: 'open' | 'closed'; stateReason?: 'completed' | 'not_planned' | 'reopened' }): Promise<void>;
  setLabels(number: number, add: string[], remove: string[]): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  lock(number: number): Promise<void>;
  /** Repository role of a user: admin, maintain, write, triage, read or none. */
  role(login: string): Promise<string>;
  inTeam(org: string, team: string, login: string): Promise<boolean>;
}

type Octokit = ReturnType<typeof getOctokit>;

interface HttpError {
  status?: number;
  response?: { headers?: Record<string, string> };
}

function isRetryable(e: unknown): boolean {
  const status = (e as HttpError).status;
  if (status === undefined) return true; // network error
  if (status >= 500 || status === 429) return true;
  if (status === 403) {
    const remaining = (e as HttpError).response?.headers?.['x-ratelimit-remaining'];
    return remaining === '0' || /rate limit/i.test(String((e as Error).message));
  }
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 2000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRetryable(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

/** Strip the REST `[bot]` suffix so REST and GraphQL logins compare equal. */
export function sameLogin(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = (s: string): string => s.toLowerCase().replace(/\[bot\]$/, '');
  return n(a) === n(b);
}

export function octokitApi(octokit: Octokit, owner: string, repo: string): IssueApi {
  const rest = octokit.rest;
  return {
    async createIssue({ title, body, labels, assignees }) {
      const { data } = await withRetry(() =>
        rest.issues.create({ owner, repo, title, body, labels, ...(assignees.length ? { assignees } : {}) }),
      );
      return { number: data.number, url: data.html_url, author: data.user?.login ?? '', createdAt: data.created_at };
    },

    async getIssue(number, etag) {
      try {
        const res = await withRetry(() =>
          rest.issues.get({ owner, repo, issue_number: number, headers: etag ? { 'if-none-match': etag } : {} }),
        );
        const d = res.data;
        return {
          notModified: false,
          ...(res.headers.etag ? { etag: res.headers.etag } : {}),
          issue: {
            body: d.body ?? '',
            state: d.state === 'closed' ? 'closed' : 'open',
            closedBy: d.closed_by?.login ?? null,
            updatedAt: d.updated_at,
          },
        };
      } catch (e) {
        if ((e as HttpError).status === 304) return { notModified: true };
        throw e;
      }
    },

    async getEdits(number) {
      const query = `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            lastEditedAt
            editor { __typename login }
            userContentEdits(last: 50) { nodes { editedAt editor { __typename login } } }
          }
        }
      }`;
      type Actor = { __typename: string; login: string } | null;
      type Res = {
        repository: {
          issue: {
            lastEditedAt: string | null;
            editor: Actor;
            userContentEdits: { nodes: ({ editedAt: string; editor: Actor } | null)[] };
          };
        };
      };
      const res = await withRetry(() => octokit.graphql<Res>(query, { owner, repo, number }));
      const issue = res.repository.issue;
      const edits: Edit[] = issue.userContentEdits.nodes
        .filter((n): n is { editedAt: string; editor: Actor } => n !== null)
        .map((n) => ({
          editor: n.editor?.login ?? null,
          isBot: n.editor?.__typename === 'Bot' || /\[bot\]$/.test(n.editor?.login ?? ''),
          editedAt: n.editedAt,
        }));
      // The latest editor, in case the edit history lags behind the body.
      if (issue.lastEditedAt && !edits.some((e) => e.editedAt === issue.lastEditedAt)) {
        edits.push({
          editor: issue.editor?.login ?? null,
          isBot: issue.editor?.__typename === 'Bot',
          editedAt: issue.lastEditedAt,
        });
      }
      return edits;
    },

    async updateIssue(number, { body, state, stateReason }) {
      await withRetry(() =>
        rest.issues.update({
          owner,
          repo,
          issue_number: number,
          ...(body !== undefined ? { body } : {}),
          ...(state ? { state } : {}),
          ...(stateReason ? { state_reason: stateReason } : {}),
        }),
      );
    },

    async setLabels(number, add, remove) {
      for (const name of remove) {
        try {
          await withRetry(() => rest.issues.removeLabel({ owner, repo, issue_number: number, name }));
        } catch (e) {
          if ((e as HttpError).status !== 404) throw e;
        }
      }
      if (add.length) await withRetry(() => rest.issues.addLabels({ owner, repo, issue_number: number, labels: add }));
    },

    async comment(number, body) {
      await withRetry(() => rest.issues.createComment({ owner, repo, issue_number: number, body }));
    },

    async lock(number) {
      await withRetry(() => rest.issues.lock({ owner, repo, issue_number: number, lock_reason: 'resolved' }));
    },

    async role(login) {
      try {
        const { data } = await withRetry(() => rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login }));
        return (data.role_name || data.permission || 'none').toLowerCase();
      } catch (e) {
        if ((e as HttpError).status === 404) return 'none';
        throw e;
      }
    },

    async inTeam(org, team, login) {
      try {
        const { data } = await withRetry(() =>
          rest.teams.getMembershipForUserInOrg({ org, team_slug: team, username: login }),
        );
        return data.state === 'active';
      } catch (e) {
        if ((e as HttpError).status === 404) return false;
        throw e;
      }
    },
  };
}

const LABEL_COLORS: Record<string, string> = {
  suii: '0969da',
  'suii:pending': 'bf8700',
  'suii:answered': '1a7f37',
  'suii:cancelled': '6e7781',
  'suii:expired': '6e7781',
  'suii:aborted': '6e7781',
  'suii:contested': 'cf222e',
  'suii:error': 'cf222e',
};

/** Create suii's labels when they are missing. Failures are not fatal. */
export async function ensureLabels(octokit: Octokit, owner: string, repo: string): Promise<void> {
  for (const [name, color] of Object.entries(LABEL_COLORS)) {
    try {
      await octokit.rest.issues.getLabel({ owner, repo, name });
    } catch (e) {
      if ((e as HttpError).status !== 404) continue;
      try {
        await octokit.rest.issues.createLabel({ owner, repo, name, color, description: 'Created by suii' });
      } catch {
        // Another run may have created it at the same time.
      }
    }
  }
}
