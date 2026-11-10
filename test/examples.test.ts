// Every example template in .github/suii must render with the data its workflow sends.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, readForm, renderForm } from '../src/form.js';
import { parseTemplate, renderTemplate } from '../src/template.js';

const run = { workflow: 'Example', number: 7, actor: 'octocat' };
const cases: Record<string, Record<string, unknown>> = {
  'choose-migration': {
    vars: { environment: 'production' },
    data: {
      current: '3f9a1c2e7b10',
      plan: [
        { revision: '8c2d4e6f1a3b', message: 'add orders table', deploy_sha: '1a2b3c4d5e6f', deployable: true },
        { revision: '4d5e6f7a8b9c', message: 'backfill', deploy_sha: null, deployable: false },
      ],
    },
  },
  'release-checklist': { vars: { version: '2.4.0' }, data: {} },
  'feature-flags': {
    vars: { environment: 'production' },
    data: {
      flags: [
        { key: 'new-checkout', description: 'One-page checkout', owner: 'payments', enabled: false },
        { key: 'dark-mode', description: 'Dark theme', owner: 'web', enabled: true },
      ],
    },
  },
  'rollout-order': { vars: { version: '2.4.0' }, data: { regions: [{ id: 'eu', name: 'Europe', users: '1M' }, { id: 'us', name: 'US', users: '2M' }] } },
  triage: { vars: {}, data: { issues: [{ number: 101, title: 'Login fails' }, { number: 102, title: 'Typo' }] } },
};

describe('example templates', () => {
  for (const [name, ctx] of Object.entries(cases)) {
    it(`${name} renders and reads back`, () => {
      const t = parseTemplate(readFileSync(`.github/suii/${name}.yml`, 'utf8'));
      const form = renderTemplate(t, { ...ctx, run });
      const { body, layout } = renderForm(form, { marker: 'suii:v1 repo=o/r run=1 attempt=1 job=j step=s', actor: 'octocat' });
      expect(body).not.toMatch(/@payments|@web/);
      const ev = evaluate(form, readForm(body, layout));
      expect(ev.submit).toBe(false);
    });
  }

  it('feature flags hides flags that are already on', () => {
    const t = parseTemplate(readFileSync('.github/suii/feature-flags.yml', 'utf8'));
    const form = renderTemplate(t, { ...cases['feature-flags'], run });
    expect(form.fields[0]!.options.map((o) => o.value)).toEqual(['new-checkout']);
  });

  it('triage puts every issue in the backlog first', () => {
    const t = parseTemplate(readFileSync('.github/suii/triage.yml', 'utf8'));
    const form = renderTemplate(t, { ...cases.triage, run });
    const { body, layout } = renderForm(form, { marker: 'm' });
    expect(form.title).toBe('Weekly triage: 2 open issues');
    expect(evaluate(form, readForm(body, layout)).values.triage).toEqual({ 'this-week': [], backlog: ['101', '102'], close: [] });
  });
});
