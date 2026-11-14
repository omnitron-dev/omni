import { describe, expect, it } from 'vitest';
import { getCodeTokenizer, highlightCode } from '../src/highlight/tokenizer.js';

describe('literal source highlighting', () => {
  it('loads the requested grammar without the compiler grammar bundle', async () => {
    expect(getCodeTokenizer().getLoadedLanguages()).toEqual([]);
    const highlighted = await highlightCode('const sample = <button disabled>Run</button>;', 'tsx');
    expect(highlighted.highlighted).toBe(true);
    expect(getCodeTokenizer().getLoadedLanguages()).toContain('tsx');
    expect(getCodeTokenizer().getLoadedLanguages()).not.toContain('python');
    expect(getCodeTokenizer().getLoadedLanguages()).not.toContain('rust');
    const colors = new Set(highlighted.lines.flatMap(line => line.tokens.map(token => token.style['--shiki-light'])));
    expect(colors.size).toBeGreaterThan(2);
    expect(highlighted.lines.flatMap(line => line.tokens).every(token => token.style['--shiki-dark'])).toBe(true);
  });

  it.each(['\n', '\r\n', '\r'])('preserves literal directives, Unicode and %j newlines', async ending => {
    const source = ['// [!code highlight]', 'const greeting = "Привет 🌐";', '// @errors: 1234', '// ^?', ''].join(ending);
    const result = await highlightCode(source, 'ts');
    expect(result.lines.map(line => line.tokens.map(token => token.content).join('') + line.ending).join('')).toBe(source);
  });

  it('leaves unknown languages readable and literal without fetching a grammar', async () => {
    const source = '<img src=x onerror="throw Error()">\n// [!code ++]\n';
    const before = getCodeTokenizer().getLoadedLanguages();
    const result = await highlightCode(source, 'custom-language');
    expect(result.highlighted).toBe(false);
    expect(result.lines.map(line => line.tokens.map(token => token.content).join('') + line.ending).join('')).toBe(source);
    expect(getCodeTokenizer().getLoadedLanguages()).toEqual(before);
  });

  it('keeps every line when a large source exceeds the tokenization budget', async () => {
    const source = Array.from({ length: 2600 }, (_, index) => `const value${index} = ${index};`).join('\n');
    const result = await highlightCode(source, 'ts');
    expect(result.lines[399]?.tokens.some(token => Object.keys(token.style).length)).toBe(true);
    expect(result.lines[400]?.tokens.every(token => Object.keys(token.style).length === 0)).toBe(true);
    expect(result.lines.map(line => line.tokens.map(token => token.content).join('') + line.ending).join('')).toBe(source);
  });
});
