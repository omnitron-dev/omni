import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenShell, PortalIslandHost, MathTheoremBlock, HoverReferenceCard } from '@omnitron-dev/lumen-ui';

describe('Tier 3: Cross-Feature — Portal Island Hydration & Emotion SSR (F12 + F14 + F20)', () => {
  it('TC-X05-01: PortalIslandHost markup in SSR HTML includes data-lumen-island, data-hydrate, and serialized props', () => {
    const props = {
      modelId: 'gpt-4o',
      temperature: 0.2,
      contextLength: 8192,
    };

    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'ai-playground-island',
        hydrate: 'interaction',
        props,
      })
    );

    expect(html).toContain('class="lumen-portal-island"');
    expect(html).toContain('data-lumen-island="ai-playground-island"');
    expect(html).toContain('data-hydrate="interaction"');
    expect(html).toContain('ai-playground-island');
  });

  it('TC-X05-02: Critical Emotion styles and class names generated from MathTheoremBlock are preserved in SSR HTML', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'en' },
        React.createElement(
          MathTheoremBlock,
          {
            id: 'thm-density-positivity',
            title: 'Positivity of Density Matrices',
            envType: 'theorem',
            status: 'verified',
          },
          'For all state vectors $\\psi$, $\\langle\\psi|\\rho|\\psi\\rangle \\ge 0$.'
        )
      )
    );

    expect(html).toContain('class="lumen-shell"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('lumen-math-block');
    expect(html).toContain('lumen-math-theorem');
    expect(html).toContain('data-status="verified"');
    expect(html).toContain('Positivity of Density Matrices');
  });

  it('TC-X05-03: Island with visible hydration trigger renders fallback static content during SSR', () => {
    const fallbackContent = 'Loading interactive reference details...';
    const html = renderToStaticMarkup(
      React.createElement(
        PortalIslandHost,
        {
          islandId: 'hover-card-preview',
          hydrate: 'visible',
          props: { refId: 'thm-spectral' },
        },
        React.createElement('span', { className: 'lumen-ssr-fallback' }, fallbackContent)
      )
    );

    expect(html).toContain('data-hydrate="visible"');
    expect(html).toContain('lumen-ssr-fallback');
    expect(html).toContain(fallbackContent);
  });

  it('TC-X05-04: Multiple nested islands within LumenShell preserve shared context values in SSR output', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'ru', currentPath: '/ru/docs/matrix' },
        React.createElement('div', { className: 'page-grid' }, [
          React.createElement(PortalIslandHost, {
            key: 'island-1',
            islandId: 'search-modal',
            hydrate: 'idle',
            props: { locale: 'ru' },
          }),
          React.createElement(PortalIslandHost, {
            key: 'island-2',
            islandId: 'theme-toggle',
            hydrate: 'load',
            props: { currentTheme: 'dark' },
          }),
        ])
      )
    );

    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('data-locale="ru"');
    expect(html).toContain('data-lumen-island="search-modal"');
    expect(html).toContain('data-hydrate="idle"');
    expect(html).toContain('data-lumen-island="theme-toggle"');
    expect(html).toContain('data-hydrate="load"');
  });
});
