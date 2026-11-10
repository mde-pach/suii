// Reads and validates the action inputs.
import * as core from '@actions/core';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { ROLES, type Role } from './auth.js';

export interface Inputs {
  templateText: string;
  templateSource: string;
  data: unknown;
  vars: Record<string, string>;
  timeoutSec: number;
  pollSec: number;
  minPermission: Role;
  allowedUsers: string[];
  allowedTeams: string[];
  forbidSelf: boolean;
  assignees: string[];
  labels: string[];
  issueOwner: string;
  issueRepo: string;
  onTimeout: 'fail' | 'default';
  onCancel: 'fail' | 'continue';
  onEmpty: 'skip' | 'fail';
  maxReverts: number;
  lock: boolean;
  token: string;
}

export function list(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean);
}

function workspacePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.GITHUB_WORKSPACE ?? process.cwd(), p);
}

function int(name: string, min: number): number {
  const raw = core.getInput(name);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`Input \`${name}\` must be an integer >= ${min} (got "${raw}").`);
  return n;
}

function oneOf<T extends string>(name: string, allowed: readonly T[]): T {
  const v = (core.getInput(name) || allowed[0]!) as T;
  if (!allowed.includes(v)) throw new Error(`Input \`${name}\` must be one of ${allowed.join(', ')} (got "${v}").`);
  return v;
}

export function readInputs(): Inputs {
  const template = core.getInput('template', { required: true });
  let templateText: string;
  let templateSource: string;
  const looksInline = template.includes('\n') || /^\s*(title|fields)\s*:/m.test(template);
  if (!looksInline && existsSync(workspacePath(template))) {
    templateText = readFileSync(workspacePath(template), 'utf8');
    templateSource = template;
  } else if (looksInline) {
    templateText = template;
    templateSource = 'inline template';
  } else {
    throw new Error(`Template file not found: ${template}. Did you run actions/checkout first?`);
  }

  let data: unknown = {};
  const dataFile = core.getInput('data-file');
  try {
    if (dataFile) data = JSON.parse(readFileSync(workspacePath(dataFile), 'utf8'));
    else data = JSON.parse(core.getInput('data') || '{}');
  } catch (e) {
    throw new Error(`Could not read ${dataFile ? `data-file ${dataFile}` : 'the `data` input'} as JSON: ${(e as Error).message}`);
  }

  const vars: Record<string, string> = {};
  for (const line of core.getInput('vars').split('\n')) {
    const m = /^\s*([A-Za-z_][\w-]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vars[m[1]!] = m[2]!;
    else if (line.trim()) throw new Error(`Input \`vars\`: expected key=value, got "${line.trim()}".`);
  }

  const repoInput = core.getInput('issue-repo') || process.env.GITHUB_REPOSITORY || '';
  const [issueOwner, issueRepo] = repoInput.split('/');
  if (!issueOwner || !issueRepo) throw new Error(`Input \`issue-repo\` must look like owner/repo (got "${repoInput}").`);

  const minPermission = oneOf('min-permission', ROLES.filter((r) => r !== 'none'));

  return {
    templateText,
    templateSource,
    data,
    vars,
    timeoutSec: int('timeout', 1),
    pollSec: int('poll-interval', 2),
    minPermission,
    allowedUsers: list(core.getInput('allowed-users')),
    allowedTeams: list(core.getInput('allowed-teams')),
    forbidSelf: core.getBooleanInput('forbid-self'),
    assignees: list(core.getInput('assignees')),
    labels: list(core.getInput('labels')),
    issueOwner,
    issueRepo,
    onTimeout: oneOf('on-timeout', ['fail', 'default'] as const),
    onCancel: oneOf('on-cancel', ['fail', 'continue'] as const),
    onEmpty: oneOf('on-empty', ['skip', 'fail'] as const),
    maxReverts: int('max-reverts', 0),
    lock: core.getBooleanInput('lock'),
    token: core.getInput('github-token', { required: true }),
  };
}
