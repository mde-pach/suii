// Escaping for untrusted values interpolated into issue markdown.

const ZWSP = '​';

/** Collapse any line break into a single space, so a value can never add lines. */
export function oneLine(value: unknown): string {
  return String(value ?? '').replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * Escape a value for plain markdown text.
 * - newlines become spaces (a value can never add a line, a list item or a checkbox)
 * - markdown punctuation is backslash-escaped
 * - `@` and `#` get a zero-width space so values never mention people or link issues
 */
export function escapeMarkdown(value: unknown): string {
  return oneLine(value)
    .replace(/[\\`*_{}[\]()#+\-!|<>~&]/g, (c) => `\\${c}`)
    .replace(/@/g, `@${ZWSP}`)
    .replace(/\\#/g, `\\#${ZWSP}`);
}

/** Render a value as an inline code span, whatever backticks it contains. */
export function codeSpan(value: unknown): string {
  const text = oneLine(value);
  if (text === '') return '` `';
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}
