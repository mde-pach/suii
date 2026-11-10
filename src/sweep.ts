// Closes suii issues left open by runs that are gone (runner lost, crash).
import type { getOctokit } from '@actions/github';
import { closeIssue } from './finish.js';
import type { IssueApi } from './api.js';

type Octokit = ReturnType<typeof getOctokit>;

export interface Marker {
  repo: string;
  run: number;
  attempt: number;
  job: string;
  step: string;
}

export function formatMarker(m: Marker): string {
  return `suii:v1 repo=${m.repo} run=${m.run} attempt=${m.attempt} job=${m.job} step=${m.step}`;
}

export function parseMarker(body: string): Marker | null {
  const m = /<!-- suii:v1 repo=(\S+) run=(\d+) attempt=(\d+) job=(\S+) step=(\S+) -->/.exec(body);
  if (!m) return null;
  return { repo: m[1]!, run: Number(m[2]), attempt: Number(m[3]), job: m[4]!, step: m[5]! };
}

const ALIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export async function sweep(
  octokit: Octokit,
  api: IssueApi,
  issueOwner: string,
  issueRepo: string,
  current: Marker,
  log: (m: string) => void,
): Promise<void> {
  const { data: issues } = await octokit.rest.issues.listForRepo({
    owner: issueOwner,
    repo: issueRepo,
    labels: 'suii:pending',
    state: 'open',
    per_page: 50,
  });
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const marker = parseMarker(issue.body ?? '');
    if (!marker) continue;
    let stale = false;
    if (marker.repo === current.repo && marker.run === current.run) {
      // Same run: only an older attempt is stale; same attempt is a sibling step or matrix job.
      stale = marker.attempt < current.attempt;
    } else {
      const [o, r] = marker.repo.split('/');
      if (!o || !r) continue;
      try {
        const { data: run } = await octokit.rest.actions.getWorkflowRun({ owner: o, repo: r, run_id: marker.run });
        stale = !ALIVE.has(run.status ?? '') || (run.run_attempt ?? 1) > marker.attempt;
      } catch (e) {
        stale = (e as { status?: number }).status === 404;
      }
    }
    if (!stale) continue;
    log(`Closing stale suii issue #${issue.number} (run ${marker.run} attempt ${marker.attempt} is no longer running).`);
    await closeIssue(api, issue.number, {
      body: issue.body ?? '',
      layout: null,
      status: 'aborted',
      note: 'The workflow run that asked this question is no longer running.',
      lock: false,
      log,
    });
  }
}
