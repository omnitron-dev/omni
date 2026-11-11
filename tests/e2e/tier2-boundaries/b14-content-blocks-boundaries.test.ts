import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MathTheoremBlock,
  CodeBlock,
  HoverReferenceCard,
  BacklinksSection,
  PageAgentActions,
} from '@omnitron-dev/lumen-ui';

describe('Feature 14: Documentation Content Blocks Boundaries', () => {
  it('TC-B14-01: renders MathTheoremBlock with empty title and empty body without crash', () => {
    const html = renderToStaticMarkup(
      React.createElement(MathTheoremBlock, {
        id: 'thm-minimal',
        title: '',
        envType: 'axiom',
      })
    );

    expect(html).toContain('id="thm-minimal"');
    expect(html).toContain('lumen-math-axiom');
    expect(html).toContain('AXIOM');
    expect(html).toContain('#thm-minimal');
    expect(html).toContain('class="lumen-math-body"');
  });

  it('TC-B14-02: renders HoverReferenceCard fallback when target title is omitted', () => {
    const html = renderToStaticMarkup(
      React.createElement(HoverReferenceCard, {
        id: 'thm-isolated-id',
      })
    );

    expect(html).toContain('class="lumen-hover-reference-card"');
    expect(html).toContain('data-reference-id="thm-isolated-id"');
    expect(html).toContain('thm-isolated-id');
  });

  it('TC-B14-03: renders CodeBlock with 0 lines of code safely', () => {
    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        code: '',
        language: 'python',
      })
    );

    expect(html).toBe('<pre class="lumen-code-block language-python"><code></code></pre>');
  });

  it('TC-B14-04: renders BacklinksSection with 0 backlinks without throwing errors', () => {
    const html = renderToStaticMarkup(
      React.createElement(BacklinksSection, {
        backlinks: [],
      })
    );

    expect(html).toBe('<section class="lumen-backlinks"><h4>Backlinks</h4><ul></ul></section>');
  });

  it('TC-B14-05: renders PageAgentActions with root or deep nested path including slashes', () => {
    const rootHtml = renderToStaticMarkup(React.createElement(PageAgentActions, { path: '/' }));
    expect(rootHtml).toContain('data-path="/"');
    expect(rootHtml).toContain('href="/.md"');

    const deepHtml = renderToStaticMarkup(React.createElement(PageAgentActions, { path: 'deep/nested/sub/doc' }));
    expect(deepHtml).toContain('data-path="deep/nested/sub/doc"');
    expect(deepHtml).toContain('href="deep/nested/sub/doc.md"');
  });
});
