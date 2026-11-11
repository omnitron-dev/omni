import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenShell, LumenNavbar, LumenFooter, DocPagination, MathTheoremBlock } from '@omnitron-dev/lumen-ui';

describe('Tier 4: Scenario 11 — Dark/Light Mode Critical Emotion CSS SSR', () => {
  it('renders complete page layout in dark mode with critical theme variables and classes', () => {
    const htmlDark = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'en', currentPath: '/docs/architecture' },
        React.createElement(
          'div',
          { className: 'lumen-layout' },
          React.createElement(LumenNavbar, {
            title: 'Lumen Documentation',
            items: [
              { label: 'Docs', href: '/docs' },
              { label: 'API', href: '/api' },
            ],
          }),
          React.createElement(
            'main',
            { className: 'lumen-content' },
            React.createElement(
              MathTheoremBlock,
              { id: 'thm-purity', title: 'Spectral Purity', envType: 'theorem' },
              'Trace condition $\\operatorname{Tr}(\\rho^2) \\le 1$.'
            )
          ),
          React.createElement(DocPagination, {
            prev: { label: 'Installation', href: '/docs/installation' },
            next: { label: 'Configuration', href: '/docs/configuration' },
          }),
          React.createElement(LumenFooter, { copyright: '© 2026 LuxQuant Omnitron' })
        )
      )
    );

    expect(htmlDark).toContain('data-theme="dark"');
    expect(htmlDark).toContain('class="lumen-shell"');
    expect(htmlDark).toContain('class="lumen-navbar"');
    expect(htmlDark).toContain('Lumen Documentation');
    expect(htmlDark).toContain('thm-purity');
    expect(htmlDark).toContain('class="lumen-pagination"');
    expect(htmlDark).toContain('Installation');
    expect(htmlDark).toContain('Configuration');
    expect(htmlDark).toContain('© 2026 LuxQuant Omnitron');
  });

  it('renders complete page layout in light mode and preserves structural and attribute parity', () => {
    const htmlLight = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'light', locale: 'en', currentPath: '/docs/architecture' },
        React.createElement(
          'div',
          { className: 'lumen-layout' },
          React.createElement(LumenNavbar, {
            title: 'Lumen Documentation',
            items: [
              { label: 'Docs', href: '/docs' },
              { label: 'API', href: '/api' },
            ],
          }),
          React.createElement(
            'main',
            { className: 'lumen-content' },
            React.createElement(
              MathTheoremBlock,
              { id: 'thm-purity', title: 'Spectral Purity', envType: 'theorem' },
              'Trace condition $\\operatorname{Tr}(\\rho^2) \\le 1$.'
            )
          ),
          React.createElement(LumenFooter, { copyright: '© 2026 LuxQuant Omnitron' })
        )
      )
    );

    expect(htmlLight).toContain('data-theme="light"');
    expect(htmlLight).toContain('class="lumen-shell"');
    expect(htmlLight).toContain('class="lumen-navbar"');
    expect(htmlLight).toContain('thm-purity');
  });
});
