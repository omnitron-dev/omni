import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MathTheoremBlock,
  HoverReferenceCard,
  CodeBlock,
  ComponentExample,
  BacklinksSection,
  PageAgentActions,
} from '../src/blocks/index.js';

describe('Documentation Content Blocks', () => {
  it('renders MathTheoremBlock with proof and QED tombstone', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MathTheoremBlock,
        {
          id: 'prf-euclid',
          title: 'Proof of Infinitude of Primes',
          envType: 'proof',
          number: '1.2',
        },
        'Assume finitely many primes...'
      )
    );

    expect(html).toContain('id="prf-euclid"');
    expect(html).toContain('lumen-math-proof');
    expect(html).toContain('PROOF');
    expect(html).toContain('1.2');
    expect(html).toContain('Proof of Infinitude of Primes');
    expect(html).toContain('∎');
    expect(html).toContain('href="#prf-euclid"');
  });

  it('renders HoverReferenceCard with title or falls back to ID', () => {
    const withTitle = renderToStaticMarkup(HoverReferenceCard({ id: 'thm-1', targetTitle: 'Fundamental Theorem' }));
    expect(withTitle).toContain('class="lumen-hover-reference-card"');
    expect(withTitle).toContain('data-reference-id="thm-1"');
    expect(withTitle).toContain('Fundamental Theorem');

    const fallback = renderToStaticMarkup(HoverReferenceCard({ id: 'def-prime' }));
    expect(fallback).toContain('def-prime');
  });

  it('renders CodeBlock with exact empty match and language classes', () => {
    const emptyHtml = renderToStaticMarkup(CodeBlock({ code: '', language: 'python' }));
    expect(emptyHtml).toBe('<pre class="lumen-code-block language-python"><code></code></pre>');

    const withCode = renderToStaticMarkup(CodeBlock({ code: 'const x = 10;', language: 'typescript' }));
    expect(withCode).toContain('class="lumen-code-block language-typescript"');
    expect(withCode).toContain('tabindex="0"');
    expect(withCode).toContain('<code>const x = 10;</code>');
  });

  it('copies exact code through Prism and exposes clipboard failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      const code = 'const message = "Привет";\n';
      await act(async () => root.render(<CodeBlock code={code} copyable />));
      await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
      expect(writeText).toHaveBeenCalledExactlyOnceWith(code);
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied');
      writeText.mockRejectedValue(new Error('Clipboard denied'));
      await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Copy failed');
      expect(container.querySelector('code')?.textContent).toBe(code);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it('renders the example, its accessible caption and literal source in server HTML', () => {
    const code = '<script>throw Error("example");</script>';
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<ComponentExample title="Counter" code={code} resettable
      labels={{ source: 'Исходник' }}><output>0</output></ComponentExample>);
    const figure = host.querySelector('figure')!;
    expect(figure.querySelector('figcaption span')?.id).toBe(figure.getAttribute('aria-labelledby'));
    expect(figure.querySelector('output')?.textContent).toBe('0');
    expect(figure.querySelector('details > summary')?.textContent).toBe('Исходник');
    expect(figure.querySelector('details code')?.textContent).toBe(code);
    expect(figure.querySelector('script, button')).toBeNull();
  });

  it('keeps the literal full source once in a closed keyboard-readable disclosure', () => {
    const source = 'const one = 1;\nconst two = 2;\n// [!code highlight]\n';
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<ComponentExample title="Source" code={source}
      labels={{ source: 'Пример' }}>Preview</ComponentExample>);
    expect(Array.from(host.querySelectorAll('details')).map(node => node.open)).toEqual([false]);
    expect(Array.from(host.querySelectorAll('summary')).map(node => node.textContent)).toEqual(['Пример']);
    expect(Array.from(host.querySelectorAll('pre')).map(node => node.tabIndex)).toEqual([0]);
    expect(Array.from(host.querySelectorAll('pre code')).map(node => node.textContent)).toEqual([source]);
  });

  it('restores just the stateful preview and preserves the source disclosure', async () => {
    function Counter() {
      const [count, setCount] = React.useState(0);
      return <button type="button" onClick={() => setCount(value => value + 1)}>{count}</button>;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ComponentExample title="Counter" code="Counter" resettable
        labels={{ reset: 'Restore' }}><Counter /></ComponentExample>));
      const details = host.querySelector('details')!;
      details.open = true;
      const before = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '0')!;
      await act(async () => before.click());
      expect(before.textContent).toBe('1');
      const reset = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Restore')!;
      await act(async () => reset.click());
      expect(host.contains(before)).toBe(false);
      expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === '0')).toBe(true);
      expect(host.querySelector('details')).toBe(details);
      expect(details.open).toBe(true);
      await act(async () => root.render(<ComponentExample title="Text" code="Text">Text</ComponentExample>));
      expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.includes('Reset'))).toBe(false);
    } finally { await act(async () => root.unmount()); }
  });

  it('renders BacklinksSection with exact empty match and backlink items', () => {
    const emptyHtml = renderToStaticMarkup(BacklinksSection({ backlinks: [] }));
    expect(emptyHtml).toBe('<section class="lumen-backlinks"><h4>Backlinks</h4><ul></ul></section>');

    const withLinks = renderToStaticMarkup(BacklinksSection({ backlinks: ['docs/arch', 'docs/specs'] }));
    expect(withLinks).toContain('docs/arch');
    expect(withLinks).toContain('docs/specs');
  });

  it('renders PageAgentActions with correct Markdown mirror links', () => {
    const rootPath = renderToStaticMarkup(PageAgentActions({ path: '/index' }));
    expect(rootPath).toContain('data-path="/index"');
    expect(rootPath).toContain('href="/index.md"');
    expect(rootPath).toContain('View Clean Markdown');

    const subPath = renderToStaticMarkup(PageAgentActions({ path: 'api/core' }));
    expect(subPath).toContain('data-path="api/core"');
    expect(subPath).toContain('href="api/core.md"');
  });
});
