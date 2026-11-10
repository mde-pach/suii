import { describe, expect, it } from 'vitest';
import {
  canonical,
  defaultValues,
  evaluate,
  freezeBody,
  normalizeLines,
  readForm,
  renderForm,
  setCheck,
  TamperError,
} from '../src/form.js';
import { parseTemplate, renderTemplate } from '../src/template.js';

const template = parseTemplate(`
title: Release 2.4
intro: Pick what ships.
fields:
  - id: target
    type: choice
    label: Target
    options:
      - label: Staging
        value: staging
      - label: Production
        value: prod
      - label: Moon
        value: moon
        disabled: true
  - id: flags
    type: multi
    label: Flags
    max: 2
    options: [alpha, beta, gamma]
  - id: ack
    type: confirm
    label: I read the changelog
    required: true
  - id: order
    type: rank
    label: Rollout order
    top: 2
    options: [eu, us, asia]
  - id: triage
    type: buckets
    label: Triage
    buckets:
      - { id: now, label: Now }
      - { id: later, label: Later }
    options:
      - { label: Bug 1, value: b1 }
      - { label: Bug 2, value: b2, bucket: later }
`);

const form = renderTemplate(template, {});
const meta = { marker: 'suii:v1 repo=o/r run=1 attempt=1 job=j step=s', actor: 'alice', runUrl: 'https://x', runLabel: 'CI #1' };

function tick(body: string, labelEnd: string): string {
  return body
    .split('\n')
    .map((l) => (l.startsWith('- [ ] ') && l.endsWith(labelEnd) ? l.replace('- [ ] ', '- [x] ') : l))
    .join('\n');
}

function moveLine(body: string, text: string, beforeText: string): string {
  const lines = body.split('\n');
  const from = lines.findIndex((l) => l === text);
  const [line] = lines.splice(from, 1);
  const to = lines.findIndex((l) => l === beforeText);
  lines.splice(to, 0, line!);
  return lines.join('\n');
}

describe('rendering', () => {
  const { body, layout } = renderForm(form, meta);

  it('renders a task list per field with Submit and Cancel', () => {
    expect(body).toContain('<!-- suii:v1 repo=o/r run=1 attempt=1 job=j step=s -->');
    expect(body).toContain('> Requested by @alice · [CI #1](https://x)');
    expect(body).toContain('- [ ] Staging');
    expect(body).toContain('- ~~Moon~~ · *unavailable*');
    expect(body).toContain('- [ ] **▸ Now**');
    expect(body).toContain('- [ ] **Submit**');
    expect(body).toContain('- [ ] Cancel');
    expect(readForm(body, layout).checks.get('submit')).toBe(false);
  });

  it('reads back an untouched body', () => {
    const ev = evaluate(form, readForm(body, layout));
    expect(ev.submit).toBe(false);
    expect(ev.values).toEqual({
      target: null,
      flags: [],
      ack: false,
      order: ['eu', 'us'],
      triage: { now: ['b1'], later: ['b2'] },
    });
    expect(ev.errors.join(' ')).toMatch(/Target.*pick one/);
    expect(ev.errors.join(' ')).toMatch(/must be ticked/);
  });
});

describe('reading answers', () => {
  const { body, layout } = renderForm(form, meta);

  it('reads ticks, ranks and buckets into values', () => {
    let b = tick(body, 'Production');
    b = tick(b, 'beta');
    b = tick(b, 'Yes');
    b = moveLine(b, '- [ ] asia', '- [ ] eu');
    b = moveLine(b, '- [ ] Bug 1', '- [ ] Bug 2');
    b = tick(b, '**Submit**');
    const ev = evaluate(form, readForm(b, layout));
    expect(ev.errors).toEqual([]);
    expect(ev.submit).toBe(true);
    expect(ev.values).toEqual({
      target: 'prod',
      flags: ['beta'],
      ack: true,
      order: ['asia', 'eu'],
      triage: { now: [], later: ['b1', 'b2'] },
    });
  });

  it('accepts CRLF line endings and trailing spaces', () => {
    const b = tick(body, 'Staging').replace(/\n/g, '  \r\n');
    expect(evaluate(form, readForm(b, layout)).values.target).toBe('staging');
  });

  it('reports invalid answers instead of accepting them', () => {
    let b = tick(body, 'Staging');
    b = tick(b, 'Production');
    b = tick(b, 'alpha');
    b = tick(b, 'beta');
    b = tick(b, 'gamma');
    const ev = evaluate(form, readForm(b, layout));
    expect(ev.errors.join(' ')).toMatch(/only one/);
    expect(ev.errors.join(' ')).toMatch(/at most 2/);
  });

  it('flags items dragged above the first bucket', () => {
    const b = moveLine(body, '- [ ] Bug 2', '- [ ] **▸ Now**');
    expect(evaluate(form, readForm(b, layout)).errors.join(' ')).toMatch(/above the first group/);
  });

  it('ignores ticks in rank lists and fake checkboxes in static text', () => {
    const b = tick(body, 'eu');
    expect(evaluate(form, readForm(b, layout)).values.order).toEqual(['eu', 'us']);
  });
});

describe('tamper check', () => {
  const { body, layout } = renderForm(form, meta);

  it('rejects reworded labels', () => {
    expect(() => readForm(body.replace('- [ ] Staging', '- [ ] Staging (please)'), layout)).toThrow(TamperError);
  });

  it('rejects added options', () => {
    expect(() => readForm(body.replace('- [ ] Staging', '- [ ] Staging\n- [x] Mars'), layout)).toThrow(TamperError);
  });

  it('rejects moving lines between fields', () => {
    expect(() => readForm(moveLine(body, '- [ ] eu', '- [ ] Bug 1'), layout)).toThrow(TamperError);
  });

  it('rejects reordering a choice list', () => {
    expect(() => readForm(moveLine(body, '- [ ] Production', '- [ ] Staging'), layout)).toThrow(TamperError);
  });

  it('rejects a removed marker or changed intro', () => {
    expect(() => readForm(body.replace('<!-- suii', '<!-- nope'), layout)).toThrow(TamperError);
    expect(() => readForm(body.replace('Pick what ships.', 'Ship it all.'), layout)).toThrow(TamperError);
  });

  it('rejects duplicating a ranked line', () => {
    expect(() => readForm(body.replace('- [ ] us', '- [ ] eu'), layout)).toThrow(TamperError);
  });
});

describe('helpers', () => {
  const { body, layout } = renderForm(form, meta);

  it('unticks Submit without touching anything else', () => {
    const b = tick(tick(body, 'Staging'), '**Submit**');
    const after = setCheck(b, layout, { kind: 'submit' }, false);
    const ev = evaluate(form, readForm(after, layout));
    expect(ev.submit).toBe(false);
    expect(ev.values.target).toBe('staging');
  });

  it('computes default values only when every required field has one', () => {
    expect(defaultValues(form, layout)).toBeNull();
    const t = parseTemplate('title: t\nfields:\n  - id: env\n    type: choice\n    label: Env\n    options:\n      - label: A\n        value: a\n        default: true\n      - B');
    const f = renderTemplate(t, {});
    expect(defaultValues(f, renderForm(f, meta).layout)).toEqual({ env: 'a' });
  });

  it('freezes the body into a read-only record', () => {
    let b = tick(body, 'Production');
    b = tick(b, '**Submit**');
    const frozen = freezeBody(b, layout, 'answered', { by: 'bob', at: new Date('2026-11-10T14:00:00Z'), values: { target: 'prod' } });
    expect(frozen.startsWith('<!-- suii:v1')).toBe(true);
    expect(frozen).toContain('> [!TIP]');
    expect(frozen).toContain('**Answered** by @bob at 2026-11-10 14:00 UTC');
    expect(frozen).toContain('- ✅ Production');
    expect(frozen).toContain('- ⬜ Staging');
    expect(frozen).toContain('1. eu');
    expect(frozen).toContain('- **▸ Later**');
    expect(frozen).not.toContain('[ ]');
    expect(frozen).not.toContain('**Submit**');
    expect(frozen).not.toContain('<sub>Tick');
  });

  it('normalises lines and canonical checkboxes', () => {
    expect(normalizeLines('a \r\nb\n\n')).toEqual(['a', 'b']);
    expect(canonical('- [X] a')).toBe('- [ ] a');
    expect(canonical('  * [x] a')).toBe('  * [ ] a');
  });
});
