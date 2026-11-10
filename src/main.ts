// Entry point: render the template, open the issue, wait for the answer, set outputs.
import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { ensureLabels, octokitApi } from './api.js';
import { Authorizer } from './auth.js';
import { runEngine, type EngineResult } from './engine.js';
import { closeIssue } from './finish.js';
import { renderForm, type Layout } from './form.js';
import { readInputs } from './inputs.js';
import { formatMarker, sweep, type Marker } from './sweep.js';
import { emptyFields, parseTemplate, renderTemplate } from './template.js';
import type { Status, Values } from './types.js';

function setValueOutputs(values: Values): void {
  core.setOutput('values', JSON.stringify(values));
  for (const [id, v] of Object.entries(values)) {
    core.setOutput(id, typeof v === 'string' ? v : v === null ? '' : JSON.stringify(v));
  }
}

async function run(): Promise<void> {
  const inputs = readInputs();
  const repo = `${context.repo.owner}/${context.repo.repo}`;
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? 1);
  const runUrl = `${context.serverUrl}/${repo}/actions/runs/${context.runId}/attempts/${runAttempt}`;

  // 1. Render. A bad template fails here, before any issue exists.
  const raw = parseTemplate(inputs.templateText);
  const ctx = {
    data: inputs.data,
    vars: inputs.vars,
    run: {
      repo,
      workflow: context.workflow,
      id: context.runId,
      number: context.runNumber,
      attempt: runAttempt,
      actor: context.actor,
      event: context.eventName,
      ref: context.ref,
      sha: context.sha,
      job: context.job,
      url: runUrl,
    },
  };
  const form = renderTemplate(raw, ctx);
  core.info(`Rendered ${inputs.templateSource}: "${form.title}" with ${form.fields.length} field(s).`);

  const empty = emptyFields(form);
  if (empty.length > 0) {
    const msg = `Nothing to choose from in required field(s): ${empty.join(', ')}.`;
    core.setOutput('status', 'empty');
    if (inputs.onEmpty === 'fail') throw new Error(msg);
    core.notice(`${msg} No issue was created (on-empty: skip).`);
    return;
  }

  const octokit = getOctokit(inputs.token);
  const api = octokitApi(octokit, inputs.issueOwner, inputs.issueRepo);
  const marker: Marker = {
    repo,
    run: context.runId,
    attempt: runAttempt,
    job: context.job,
    step: (process.env.GITHUB_ACTION ?? 'suii').replace(/\s+/g, '_'),
  };

  // 2. Housekeeping, best effort.
  try {
    await sweep(octokit, api, inputs.issueOwner, inputs.issueRepo, marker, (m) => core.info(m));
  } catch (e) {
    core.info(`Stale-issue sweep skipped: ${(e as Error).message}`);
  }
  await ensureLabels(octokit, inputs.issueOwner, inputs.issueRepo);

  try {
    const { data: r } = await octokit.rest.repos.get({ owner: inputs.issueOwner, repo: inputs.issueRepo });
    if (!r.has_issues) throw new Error(`Issues are disabled in ${inputs.issueOwner}/${inputs.issueRepo}; suii needs them.`);
    if (!r.private) {
      core.warning(`${inputs.issueOwner}/${inputs.issueRepo} is public: the question and its answer are visible to anyone. Use \`issue-repo\` to ask in a private repository.`);
    }
  } catch (e) {
    if ((e as Error).message.startsWith('Issues are disabled')) throw e;
  }

  // 3. Open the issue.
  const deadline = Date.now() + inputs.timeoutSec * 1000;
  const { body, layout } = renderForm(form, {
    marker: formatMarker(marker),
    actor: context.actor,
    runUrl,
    runLabel: `${context.workflow} #${context.runNumber}`,
    expiresAt: new Date(deadline),
  });
  const title = form.title;
  const labels = ['suii', 'suii:pending', ...inputs.labels];
  let created;
  try {
    created = await api.createIssue({ title, body, labels, assignees: inputs.assignees });
  } catch (e) {
    if (inputs.assignees.length === 0) throw e;
    core.warning(`Could not assign ${inputs.assignees.join(', ')} (${(e as Error).message}); creating the issue without assignees.`);
    created = await api.createIssue({ title, body, labels, assignees: [] });
  }
  const issueNumber = created.number;
  core.saveState('issue', String(issueNumber));
  core.saveState('owner', inputs.issueOwner);
  core.saveState('repo', inputs.issueRepo);
  core.saveState('layout', JSON.stringify(layout));
  core.saveState('lock', String(inputs.lock));
  core.setOutput('issue-number', String(issueNumber));
  core.setOutput('issue-url', created.url);
  core.notice(`Waiting for an answer in ${created.url}`, { title: `suii: ${title}` });
  core.info(`Answer here: ${created.url} (expires in ${Math.round(inputs.timeoutSec / 60)} min)`);

  const auth = new Authorizer(api, {
    minPermission: inputs.minPermission,
    allowedUsers: inputs.allowedUsers,
    allowedTeams: inputs.allowedTeams,
    forbidSelf: inputs.forbidSelf,
    actor: context.actor,
    self: created.author,
  });

  // 4. Wait.
  let result: EngineResult;
  try {
    result = await runEngine({
      api,
      auth,
      form,
      layout,
      issueNumber,
      body,
      self: created.author,
      createdAt: created.createdAt,
      deadline,
      pollMs: inputs.pollSec * 1000,
      maxReverts: inputs.maxReverts,
      onTimeout: inputs.onTimeout,
      log: { info: (m) => core.info(m), warn: (m) => core.warning(m) },
    });
  } catch (e) {
    await closeIssue(api, issueNumber, {
      body,
      layout,
      status: 'error',
      note: `suii stopped on an error: ${(e as Error).message}`,
      lock: inputs.lock,
      log: (m) => core.warning(m),
    });
    core.saveState('finalized', 'true');
    core.setOutput('status', 'error');
    throw e;
  }

  // 5. Close and report.
  await finish(api, issueNumber, layout, result, inputs.lock);
  core.saveState('finalized', 'true');
  core.setOutput('status', result.status);
  await summary(result, created.url, title);

  switch (result.status) {
    case 'answered':
      core.setOutput('responder', result.responder);
      core.setOutput('answered-at', result.at.toISOString());
      setValueOutputs(result.values);
      core.info(`Answered by @${result.responder}: ${JSON.stringify(result.values)}`);
      return;
    case 'defaulted':
      setValueOutputs(result.values);
      core.warning(`Nobody answered in time; using default values: ${JSON.stringify(result.values)}`);
      return;
    case 'cancelled':
      if (result.by) core.setOutput('responder', result.by);
      if (inputs.onCancel === 'continue') {
        core.notice(`Cancelled by ${result.by ? '@' + result.by : 'someone'} (on-cancel: continue).`);
        return;
      }
      throw new Error(`Cancelled by ${result.by ? '@' + result.by : 'someone'} in ${created.url}`);
    case 'expired':
      throw new Error(`Nobody answered ${created.url} before the timeout.`);
    case 'contested':
      throw new Error(`Too many rejected edits in ${created.url}; giving up.`);
  }
}

async function finish(
  api: ReturnType<typeof octokitApi>,
  n: number,
  layout: Layout,
  r: EngineResult,
  lock: boolean,
): Promise<void> {
  const log = (m: string): void => core.warning(m);
  switch (r.status) {
    case 'answered': {
      const others = r.contributors.filter((c) => c !== r.responder);
      await closeIssue(api, n, {
        body: r.body,
        layout,
        status: 'answered',
        by: r.responder,
        at: r.at,
        values: r.values,
        comment: `✅ Answered by @${r.responder}${others.length ? ` (also edited by ${others.map((o) => '@' + o).join(', ')})` : ''}. The workflow continues.`,
        lock,
        log,
      });
      return;
    }
    case 'defaulted':
      await closeIssue(api, n, {
        body: r.body,
        layout,
        status: 'defaulted',
        at: new Date(),
        values: r.values,
        comment: '⏱️ Nobody answered in time; the workflow continued with the default values.',
        lock,
        log,
      });
      return;
    case 'cancelled':
      await closeIssue(api, n, { body: r.body, layout, status: 'cancelled', by: r.by, at: new Date(), comment: '🛑 Cancelled.', lock, log });
      return;
    case 'expired':
      await closeIssue(api, n, { body: r.body, layout, status: 'expired', at: new Date(), comment: '⏱️ Expired without an answer.', lock, log });
      return;
    case 'contested':
      await closeIssue(api, n, {
        body: r.body,
        layout,
        status: 'contested',
        note: `Rejected edits from: ${r.rejected.map((x) => '@' + x).join(', ') || 'unknown'}.`,
        lock,
        log,
      });
      return;
  }
}

async function summary(r: EngineResult, url: string, title: string): Promise<void> {
  try {
    const s = core.summary.addHeading(`suii: ${title}`, 3).addRaw(`Issue: ${url}\n\n`).addRaw(`Status: **${r.status as Status}**\n\n`);
    if ('values' in r && r.values && Object.keys(r.values).length > 0) {
      s.addTable([
        [{ data: 'Field', header: true }, { data: 'Value', header: true }],
        ...Object.entries(r.values).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
      ]);
    }
    if (r.status === 'answered') s.addRaw(`Answered by @${r.responder}\n`);
    await s.write();
  } catch {
    // The job summary is a nicety.
  }
}

run().catch((e: unknown) => {
  core.setFailed((e as Error).message);
});
