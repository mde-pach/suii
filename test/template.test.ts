import { describe, expect, it } from 'vitest';
import { codeSpan, escapeMarkdown } from '../src/escape.js';
import { emptyFields, parseTemplate, renderTemplate, TemplateError } from '../src/template.js';

describe('escaping', () => {
  it('neutralises markdown, line breaks, mentions and issue links', () => {
    const out = escapeMarkdown('- [ ] **Submit**\n@alice #12 <b>x</b>');
    expect(out).not.toContain('\n');
    expect(out).toContain('\\[ \\]');
    expect(out).toContain('\\*\\*Submit\\*\\*');
    expect(out).toContain('@\u200balice');
    expect(out).toContain('\\#\u200b12');
    expect(out).toContain('\\<b\\>');
  });

  it('builds code spans that survive backticks', () => {
    expect(codeSpan('abc')).toBe('`abc`');
    expect(codeSpan('a`b')).toBe('``a`b``');
    expect(codeSpan('`x')).toBe('`` `x ``');
    expect(codeSpan('a\nb')).toBe('`a b`');
  });
});

const migrationTemplate = `
title: "Choose migration — {{ run.workflow }}"
intro: |
  Database is at {{ data.current | code }}.
fields:
  - id: revision
    type: choice
    label: Target migration
    options:
      from: data.plan
      label: "{{ item.revision | code }} {{ item.message }}"
      value: "{{ item.revision }}"
      disabled: item.deployable == false
  - id: seed
    type: confirm
    label: Also run seeds
`;

const data = {
  current: 'a1b2',
  plan: [
    { revision: 'c3d4', message: 'add *orders*', deployable: true },
    { revision: 'e5f6', message: 'backfill', deployable: false },
    { revision: 'g7h8', message: '@bob - [ ] **Submit**', deployable: true },
  ],
};

describe('templates', () => {
  it('renders generated options with escaping and conditions', () => {
    const form = renderTemplate(parseTemplate(migrationTemplate), { data, run: { workflow: 'Deploy' } });
    expect(form.title).toBe('Choose migration — Deploy');
    expect(form.intro).toBe('Database is at `a1b2`.');
    const [rev, seed] = form.fields;
    expect(rev!.required).toBe(true);
    expect(rev!.options.map((o) => o.value)).toEqual(['c3d4', 'e5f6', 'g7h8']);
    expect(rev!.options[0]!.label).toBe('`c3d4` add \\*orders\\*');
    expect(rev!.options[1]!.disabled).toBe(true);
    expect(rev!.options[2]!.label).not.toMatch(/- \[ \]/);
    expect(seed!.type).toBe('confirm');
    expect(seed!.required).toBe(false);
  });

  it('supports static options as strings or objects, with defaults', () => {
    const t = parseTemplate(`
title: Flags
fields:
  - id: flags
    type: multi
    label: Flags
    min: 1
    options:
      - beta
      - label: Dark mode
        value: dark
        default: true
`);
    const form = renderTemplate(t, {});
    expect(form.fields[0]!.options).toMatchObject([
      { label: 'beta', value: 'beta', default: false },
      { label: 'Dark mode', value: 'dark', default: true },
    ]);
  });

  it('rejects broken templates before anything is created', () => {
    expect(() => parseTemplate('fields: []')).toThrow(TemplateError);
    expect(() => parseTemplate('title: x\nfields:\n  - id: Bad Id\n    type: choice\n    label: x\n    options: [a]')).toThrow(/id must match/);
    expect(() => parseTemplate('title: x\nfields:\n  - id: a\n    type: nope\n    label: x')).toThrow(/type must be/);
    expect(() => parseTemplate('title: x\nfields:\n  - id: status\n    type: confirm\n    label: x')).toThrow(/reserved/);
    expect(() => parseTemplate('title: x\nfields:\n  - id: b\n    type: buckets\n    label: x\n    options: [a]\n    buckets: [{id: one, label: One}]')).toThrow(/two `buckets`/);
    const dup = parseTemplate('title: x\nfields:\n  - id: a\n    type: choice\n    label: x\n    options: [same, same]');
    expect(() => renderTemplate(dup, {})).toThrow(/appears twice/);
    const missing = parseTemplate('title: x\nfields:\n  - id: a\n    type: choice\n    label: x\n    options:\n      from: data.nope\n      label: "{{ item }}"');
    expect(() => renderTemplate(missing, { data: {} })).toThrow(/not found/);
  });

  it('flags required fields with nothing to pick as empty', () => {
    const form = renderTemplate(parseTemplate(migrationTemplate), { data: { current: 'x', plan: [] }, run: {} });
    expect(emptyFields(form)).toEqual(['revision']);
  });

  it('does not expose environment variables', () => {
    process.env.SUII_SECRET_TEST = 'hunter2';
    const form = renderTemplate(parseTemplate('title: "x{{ env.SUII_SECRET_TEST }}{{ SUII_SECRET_TEST }}"\nfields:\n  - id: a\n    type: confirm\n    label: ok'), {});
    expect(form.title).toBe('x');
  });
});
