import { describe, it, expect } from 'vitest';
import { parseCodeDirectives, parseTwoslashAnnotations, LumenHighlighter } from '../src/index.js';

describe('Syntax Highlighter, Magic Diff Comments, and Twoslash Annotations', () => {
  it('parses magic comments for line highlight, additions, deletions, and focus', () => {
    const code = `const a = 1;
// [!code ++]
const b = 2;
const c = 3; // [!code --]
const d = 4; // [!code highlight]
const e = 5; // [!code focus]`;

    const lines = parseCodeDirectives(code);
    expect(lines).toHaveLength(5);
    expect(lines[0]?.type).toBe('normal');
    expect(lines[1]?.type).toBe('diff-add');
    expect(lines[1]?.text).toBe('const b = 2;');
    expect(lines[2]?.type).toBe('diff-del');
    expect(lines[2]?.text).toBe('const c = 3;');
    expect(lines[3]?.type).toBe('highlight');
    expect(lines[4]?.type).toBe('focus');
  });

  it('parses Twoslash type queries and error annotations', () => {
    const twoslashCode = `// @noErrors
// @errors: 2322, 2304
const greeting = "hello";
//    ^?`;

    const result = parseTwoslashAnnotations(twoslashCode);
    expect(result.hasNoErrors).toBe(true);
    expect(result.expectedErrors).toEqual([2322, 2304]);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.type).toBe('hover');
    expect(result.annotations[0]?.column).toBe(6);
    expect(result.code).toBe('const greeting = "hello";');
  });

  it('renders code block HTML with CSS variable classes and escaped content', () => {
    const highlighter = new LumenHighlighter();
    const snippet = `const msg = "<script>alert(1)</script>"; // [!code ++]`;

    const html = highlighter.highlight(snippet, { language: 'typescript' });
    expect(html).toContain('lumen-code-block');
    expect(html).toContain('language-typescript');
    expect(html).toContain('diff add');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it.each(['text', 'typescript'])('keeps mixed newline compiler lines and directives aligned for %s', language => {
    const html = new LumenHighlighter().highlight(
      'const first = 1;\r// [!code highlight]\rconst second = 2;\r\nconst third = 3;\nconst last = 4;',
      { language },
    );
    const displayed = html.slice(html.indexOf('<code ')).replace(/<[^>]*>/g, '');
    expect(displayed).toBe('const first = 1;\nconst second = 2;\nconst third = 3;\nconst last = 4;');
    expect(html).toContain('class="line highlighted" data-line="2"');
    expect(html).toContain('data-line="4"');
  });
});
