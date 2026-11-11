import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiExplorer, NetronPlayground, PortalIslandHost } from '@omnitron-dev/lumen-ui';

describe('Feature 15: Interactive Playground & Explorer', () => {
  it('TC-F15-01: renders ApiExplorer component with designated class', () => {
    const html = renderToStaticMarkup(React.createElement(ApiExplorer));
    expect(html).toContain('class="lumen-api-explorer"');
  });

  it('TC-F15-02: renders NetronPlayground component with designated class', () => {
    const html = renderToStaticMarkup(React.createElement(NetronPlayground));
    expect(html).toContain('class="lumen-netron-playground"');
  });

  it('TC-F15-03: wraps ApiExplorer inside PortalIslandHost with visible hydration trigger', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        PortalIslandHost,
        {
          islandId: 'api-explorer-island',
          hydrate: 'visible',
          props: { endpoint: '/api/v1/query' },
        },
        React.createElement(ApiExplorer)
      )
    );

    expect(html).toContain('data-lumen-island="api-explorer-island"');
    expect(html).toContain('data-hydrate="visible"');
    expect(html).toContain('class="lumen-api-explorer"');
  });

  it('TC-F15-04: wraps NetronPlayground inside PortalIslandHost with interaction hydration trigger', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        PortalIslandHost,
        {
          islandId: 'playground-island',
          hydrate: 'interaction',
          props: { initialSnippet: 'return 42;' },
        },
        React.createElement(NetronPlayground)
      )
    );

    expect(html).toContain('data-lumen-island="playground-island"');
    expect(html).toContain('data-hydrate="interaction"');
    expect(html).toContain('class="lumen-netron-playground"');
  });

  it('TC-F15-05: serializes complex configuration props safely to data-props', () => {
    const complexProps = {
      service: 'LumenRpcService',
      method: 'search',
      timeoutMs: 5000,
      headers: { 'X-Requested-With': 'LumenUI' },
    };

    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'complex-config',
        hydrate: 'load',
        props: complexProps,
      })
    );

    expect(html).toContain('data-props');
    expect(html).toContain('LumenRpcService');
    expect(html).toContain('timeoutMs');
  });
});
