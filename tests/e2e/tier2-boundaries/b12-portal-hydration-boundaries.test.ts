import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenShell, PortalIslandHost, type HydrationTrigger } from '@omnitron-dev/lumen-ui';

describe('Feature 12: Portal Island Hydration Runtime Boundaries', () => {
  it('TC-B12-01: handles custom or non-standard hydration trigger values', () => {
    const customTrigger = 'onScroll' as HydrationTrigger;
    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'scroll-island',
        hydrate: customTrigger,
      })
    );

    expect(html).toContain('class="lumen-portal-island"');
    expect(html).toContain('data-lumen-island="scroll-island"');
    expect(html).toContain('data-hydrate="onScroll"');
  });

  it('TC-B12-02: renders portal island with empty string islandId safely', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: '',
      })
    );

    expect(html).toContain('class="lumen-portal-island"');
    expect(html).toContain('data-lumen-island=""');
  });

  it('TC-B12-03: serializes deeply nested and complex prop types into data-props attribute safely', () => {
    const complexProps = {
      numbers: [1, 2, 3, -99.9, 0],
      booleans: [true, false],
      nested: {
        level1: {
          level2: {
            leaf: 'value with "quotes" and <tags>',
          },
        },
      },
      nullVal: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'nested-props-island',
        props: complexProps,
      })
    );

    expect(html).toContain('data-props');
    expect(html).toContain('&quot;leaf&quot;:&quot;value with \\&quot;quotes\\&quot; and &lt;tags&gt;&quot;');
  });

  it('TC-B12-04: renders empty portal island with zero children without null reference error', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'empty-island',
        hydrate: 'idle',
      })
    );

    expect(html).toBe(
      '<div class="lumen-portal-island" data-lumen-island="empty-island" data-hydrate="idle" data-props="{}"></div>'
    );
  });

  it('TC-B12-05: mounts multiple distinct portal islands within single LumenShell root container', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'en', currentPath: '/dashboard' },
        React.createElement(PortalIslandHost, { islandId: 'island-1', hydrate: 'load' }),
        React.createElement(PortalIslandHost, { islandId: 'island-2', hydrate: 'visible' }),
        React.createElement(PortalIslandHost, { islandId: 'island-3', hydrate: 'interaction' }),
        React.createElement(PortalIslandHost, { islandId: 'island-4', hydrate: 'idle' })
      )
    );

    expect(html).toContain('class="lumen-shell"');
    expect(html).toContain('data-lumen-island="island-1"');
    expect(html).toContain('data-lumen-island="island-2"');
    expect(html).toContain('data-lumen-island="island-3"');
    expect(html).toContain('data-lumen-island="island-4"');
    expect(html).toContain('data-hydrate="load"');
    expect(html).toContain('data-hydrate="visible"');
    expect(html).toContain('data-hydrate="interaction"');
    expect(html).toContain('data-hydrate="idle"');
  });
});
