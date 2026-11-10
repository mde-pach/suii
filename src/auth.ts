// Decides whether a GitHub user may answer.
import { sameLogin, type IssueApi } from './api.js';

export const ROLES = ['none', 'read', 'triage', 'write', 'maintain', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthOptions {
  minPermission: Role;
  allowedUsers: string[];
  /** `org/team-slug` entries. */
  allowedTeams: string[];
  forbidSelf: boolean;
  /** The user who triggered the run. */
  actor: string;
  /** suii's own identity (the issue author). */
  self: string;
}

export interface AuthResult {
  ok: boolean;
  reason?: string;
}

function rank(role: string): number {
  const i = ROLES.indexOf(role as Role);
  // Custom repository roles are not ranked; treat them as read.
  return i === -1 ? ROLES.indexOf('read') : i;
}

export class Authorizer {
  private cache = new Map<string, Promise<AuthResult>>();

  constructor(
    private api: IssueApi,
    private opts: AuthOptions,
  ) {}

  check(login: string | null, isBot = false): Promise<AuthResult> {
    if (!login) return Promise.resolve({ ok: false, reason: 'the editor could not be identified' });
    const key = login.toLowerCase();
    let p = this.cache.get(key);
    if (!p) {
      p = this.compute(login, isBot);
      this.cache.set(key, p);
    }
    return p;
  }

  private async compute(login: string, isBot: boolean): Promise<AuthResult> {
    const o = this.opts;
    if (isBot || /\[bot\]$/i.test(login)) return { ok: false, reason: 'bots cannot answer' };
    if (o.forbidSelf && sameLogin(login, o.actor)) {
      return { ok: false, reason: 'the person who started the run cannot answer (four-eyes rule)' };
    }
    if (o.allowedUsers.length > 0 || o.allowedTeams.length > 0) {
      let listed = o.allowedUsers.some((u) => sameLogin(u, login));
      for (const entry of o.allowedTeams) {
        if (listed) break;
        const [org, team] = entry.split('/');
        if (org && team && (await this.api.inTeam(org, team, login))) listed = true;
      }
      if (!listed) return { ok: false, reason: 'not in the allowed users or teams' };
    }
    const role = await this.api.role(login);
    if (rank(role) < rank(o.minPermission)) {
      return { ok: false, reason: `needs ${o.minPermission} access (has ${role})` };
    }
    return { ok: true };
  }
}
