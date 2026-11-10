// Post hook: runs after the step, even when the run was cancelled or the step was killed.
// If the issue is still open, freeze it as aborted, and tell Slack.
import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { octokitApi } from './api.js';
import { closeIssue } from './finish.js';
import type { Layout } from './form.js';
import { readSlackInputs } from './inputs.js';
import { SlackNotifier, type QuestionInfo, type SlackRef } from './slack.js';

async function post(): Promise<void> {
  const issue = Number(core.getState('issue'));
  if (!issue || core.getState('finalized') === 'true') return;
  const owner = core.getState('owner');
  const repo = core.getState('repo');
  let layout: Layout | null = null;
  try {
    layout = JSON.parse(core.getState('layout')) as Layout;
  } catch {
    layout = null;
  }
  const api = octokitApi(getOctokit(core.getInput('github-token', { required: true })), owner, repo);
  const current = await api.getIssue(issue);
  if (current.notModified || current.issue.state === 'closed') return;
  core.info(`The step stopped before an answer; closing issue #${issue} as aborted.`);
  await closeIssue(api, issue, {
    body: current.issue.body,
    layout,
    status: 'aborted',
    at: new Date(),
    note: 'The workflow run was cancelled or the step timed out before an answer.',
    comment: '🛑 The workflow run stopped before an answer; this request is closed.',
    lock: core.getState('lock') === 'true',
    log: (m) => core.warning(m),
  });

  const saved = core.getState('slack');
  if (saved) {
    const { question, ref } = JSON.parse(saved) as { question: QuestionInfo & { expiresAt?: string }; ref: SlackRef | null };
    const slack = new SlackNotifier(readSlackInputs(), (m) => core.warning(m));
    await slack.closed({ ...question, ...(question.expiresAt ? { expiresAt: new Date(question.expiresAt) } : {}) }, { status: 'aborted' }, ref);
  }
}

post().catch((e: unknown) => {
  // Never fail the job from the post hook.
  core.warning(`suii post hook: ${(e as Error).message}`);
});
