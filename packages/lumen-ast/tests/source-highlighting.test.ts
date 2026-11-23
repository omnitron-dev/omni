import { describe, expect, it, vi } from 'vitest';
import { getCodeTokenizer, highlightCode } from '../src/highlight/tokenizer.js';

function luminance(hex: string): number {
  const digits = hex.slice(1);
  const rgb = digits.length === 3 ? [...digits].map(value => value + value).join('') : digits;
  const weights = [0.2126, 0.7152, 0.0722];
  return weights.reduce((sum, weight, index) => {
    const channel = parseInt(rgb.slice(index * 2, index * 2 + 2), 16) / 255;
    return sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  }, 0);
}

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

  it('keeps comments legible against the background emitted for each color scheme', async () => {
    const source = '// Explanatory text';
    const result = await highlightCode(source, 'ts');
    const tokens = result.lines[0]!.tokens;
    expect(tokens.map(token => token.content).join('')).toBe(source);
    const colors = Object.fromEntries(result.rootStyle.split(';').map(pair => pair.split(':')));
    for (const scheme of ['light', 'dark']) {
      const variable = `--shiki-${scheme}`;
      const background = luminance(colors[`${variable}-bg`]);
      for (const token of tokens) {
        const foreground = luminance(token.style[variable]!);
        const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
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

  it('produces identical tokens when scheduling advances the wall clock during tokenization', async () => {
    const source = "const greeting = '<script>literal</script>';";
    const expected = await highlightCode(source, 'ts');
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock += 1000);
    try { expect(await highlightCode(source, 'ts')).toEqual(expected); }
    finally { now.mockRestore(); }
  });

  it.each([
    { source: '"' + 'x'.repeat(2048) + '";\r\nconst tail = 1;', minColored: 0, maxColored: 0 },
    {
      source: Array.from({ length: 200 }, (_, index) => `const text${index} = "${'x'.repeat(1000)}";`).join('\n'),
      minColored: 1,
      maxColored: 31,
    },
  ])('bounds long lines and total tokenized text without dropping source or resuming a broken grammar state', async ({ source, minColored, maxColored }) => {
    const result = await highlightCode(source, 'ts');
    const plain = result.lines.findIndex(line => line.tokens.every(token => Object.keys(token.style).length === 0));
    expect(plain).toBeGreaterThanOrEqual(minColored);
    expect(plain).toBeLessThanOrEqual(maxColored);
    expect(result.lines.slice(plain).every(line => line.tokens.every(token => Object.keys(token.style).length === 0))).toBe(true);
    expect(result.lines.map(line => line.tokens.map(token => token.content).join('') + line.ending).join('')).toBe(source);
  });
});
