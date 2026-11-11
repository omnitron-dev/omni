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

describe('Feature 14: Documentation Content Blocks', () => {
  it('TC-F14-01: renders MathTheoremBlock with theorem type, title, id, and status', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MathTheoremBlock,
        {
          id: 'thm-purity',
          title: 'Purity Bound',
          envType: 'theorem',
          status: 'verified',
        },
        'Trace of density matrix squared is at most 1.'
      )
    );

    expect(html).toContain('id="thm-purity"');
    expect(html).toContain('lumen-math-block');
    expect(html).toContain('lumen-math-theorem');
    expect(html).toContain('data-status="verified"');
    expect(html).toContain('Purity Bound');
    expect(html).toContain('Trace of density matrix');
  });

  it('TC-F14-02: renders HoverReferenceCard with target identifier and title', () => {
    const html = renderToStaticMarkup(
      React.createElement(HoverReferenceCard, {
        id: 'thm-spectral-decomp',
        targetTitle: 'Spectral Decomposition Theorem',
      })
    );

    expect(html).toContain('class="lumen-hover-reference-card"');
    expect(html).toContain('data-reference-id="thm-spectral-decomp"');
    expect(html).toContain('Spectral Decomposition Theorem');
  });

  it('TC-F14-03: renders CodeBlock with language CSS class and code content', () => {
    const code = 'const answer = 42;';
    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        code,
        language: 'typescript',
      })
    );

    expect(html).toContain('class="lumen-code-block language-typescript"');
    expect(html).toContain('<code>const answer = 42;</code>');
  });

  it('TC-F14-04: renders BacklinksSection with list of referencing document IDs', () => {
    const backlinks = ['docs/intro', 'docs/advanced/overview'];
    const html = renderToStaticMarkup(React.createElement(BacklinksSection, { backlinks }));

    expect(html).toContain('class="lumen-backlinks"');
    expect(html).toContain('Backlinks');
    expect(html).toContain('docs/intro');
    expect(html).toContain('docs/advanced/overview');
  });

  it('TC-F14-05: renders PageAgentActions with target document path', () => {
    const html = renderToStaticMarkup(React.createElement(PageAgentActions, { path: 'docs/foundations.pdx' }));

    expect(html).toContain('class="lumen-page-agent-actions"');
    expect(html).toContain('data-path="docs/foundations.pdx"');
  });
});
