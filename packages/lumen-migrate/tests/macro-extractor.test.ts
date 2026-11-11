import { describe, it, expect } from 'vitest';
import { extractKatexMacrosFromConfig } from '../src/katex/macro-extractor.js';

describe('KaTeX Macro Extractor', () => {
  it('extracts macros from config.katexMacros', () => {
    const macros = extractKatexMacrosFromConfig({
      katexMacros: {
        '\\braket': '\\langle #1 \\rangle',
        '\\energy': 'E = mc^2',
      },
    });

    expect(macros['\\braket']).toBe('\\langle #1 \\rangle');
    expect(macros['\\energy']).toBe('E = mc^2');
  });

  it('extracts macros from rehypePlugins in presets', () => {
    const macros = extractKatexMacrosFromConfig({
      presets: [
        [
          'classic',
          {
            docs: {
              rehypePlugins: [['rehypeKatex', { macros: { '\\H': '\\mathcal{H}' } }]],
            },
          },
        ],
      ],
    });

    expect(macros['\\H']).toBe('\\mathcal{H}');
  });
});
