import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenShell, PortalIslandHost } from '@omnitron-dev/lumen-ui';

describe('Feature 12: Portal Island Hydration Runtime', () => {
  it('TC-F12-01: renders LumenShell root container with theme and locale attributes', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'en', currentPath: '/intro' },
        React.createElement('div', { id: 'child-content' }, 'Hello Lumen')
      )
    );

    expect(html).toContain('class="lumen-shell"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('data-locale="en"');
    expect(html).toContain('Hello Lumen');
  });

  it('TC-F12-02: renders PortalIslandHost with immediate load trigger (data-hydrate="load")', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'critical-widget',
        hydrate: 'load',
        props: { initialCount: 10 },
      })
    );

    expect(html).toContain('class="lumen-portal-island"');
    expect(html).toContain('data-lumen-island="critical-widget"');
    expect(html).toContain('data-hydrate="load"');
    expect(html).toContain(JSON.stringify({ initialCount: 10 }).replace(/"/g, '&quot;'));
  });

  it('TC-F12-03: renders PortalIslandHost with visible trigger (data-hydrate="visible")', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'lazy-chart',
        hydrate: 'visible',
        props: { dataset: 'spectral' },
      })
    );

    expect(html).toContain('data-lumen-island="lazy-chart"');
    expect(html).toContain('data-hydrate="visible"');
  });

  it('TC-F12-04: renders PortalIslandHost with user interaction trigger (data-hydrate="interaction")', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'interactive-search',
        hydrate: 'interaction',
        props: { placeholder: 'Search docs...' },
      })
    );

    expect(html).toContain('data-lumen-island="interactive-search"');
    expect(html).toContain('data-hydrate="interaction"');
  });

  it('TC-F12-05: renders PortalIslandHost with idle callback trigger (data-hydrate="idle")', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'analytics-island',
        hydrate: 'idle',
        props: { sessionId: 'xyz-123' },
      })
    );

    expect(html).toContain('data-lumen-island="analytics-island"');
    expect(html).toContain('data-hydrate="idle"');
  });
});
