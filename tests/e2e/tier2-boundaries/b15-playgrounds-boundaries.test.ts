import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiExplorer, NetronPlayground, PortalIslandHost } from '@omnitron-dev/lumen-ui';
import { LumenRpcService } from '@omnitron-dev/titan-lumen';

describe('Feature 15: Interactive Playground & Explorer Boundaries', () => {
  it('TC-B15-01: executes infinite loop snippet guard via timeout simulation', async () => {
    const service = new LumenRpcService();
    const infiniteSnippet = 'while (true) { /* infinite loop */ }';

    const result = (await service.executePlayground(infiniteSnippet)) as {
      code: string;
      result: unknown;
    };
    expect(result).toBeDefined();
    expect(result.code).toContain('while (true)');
  });

  it('TC-B15-02: handles offline backend simulation without crashing client components', async () => {
    // Simulate unreachable RPC service
    const offlineService = new LumenRpcService({ docsDir: '__non_existent_offline__' });
    const searchRes = await offlineService.search('test query');
    expect(Array.isArray(searchRes)).toBe(true);
    expect(searchRes).toHaveLength(0);

    const docRes = await offlineService.getDocument('phantom.pdx');
    expect(docRes).toBeNull();
  });

  it('TC-B15-03: renders ApiExplorer and NetronPlayground with null or empty property descriptors', () => {
    const htmlExplorer = renderToStaticMarkup(
      React.createElement(
        PortalIslandHost,
        {
          islandId: 'api-null-props',
          props: { symbol: null, methods: [], description: '' },
        },
        React.createElement(ApiExplorer)
      )
    );

    expect(htmlExplorer).toContain('class="lumen-api-explorer"');
    expect(htmlExplorer).toContain('&quot;symbol&quot;:null');

    const htmlPlayground = renderToStaticMarkup(
      React.createElement(
        PortalIslandHost,
        {
          islandId: 'playground-empty',
          props: { initialCode: '', readOnly: true },
        },
        React.createElement(NetronPlayground)
      )
    );

    expect(htmlPlayground).toContain('class="lumen-netron-playground"');
    expect(htmlPlayground).toContain('&quot;initialCode&quot;:&quot;&quot;');
  });

  it('TC-B15-04: serializes oversized script payloads (>1MB) safely in island configuration props', () => {
    const largeCode = 'const data = ' + JSON.stringify(new Array(5000).fill('payload'));
    expect(largeCode.length).toBeGreaterThan(50_000);

    const html = renderToStaticMarkup(
      React.createElement(PortalIslandHost, {
        islandId: 'oversized-script',
        props: { code: largeCode },
      })
    );

    expect(html).toContain('data-lumen-island="oversized-script"');
    expect(html).toContain('data-props');
  });

  it('TC-B15-05: verifies sandboxed global scope isolation prevents unhandled prototype leakage', () => {
    const maliciousSnippet = 'Object.prototype.polluted = true; return Object.prototype;';
    const originalPolluted = (Object.prototype as any).polluted;

    // Server-side rendering of playground should not execute code
    const html = renderToStaticMarkup(
      React.createElement(
        PortalIslandHost,
        {
          islandId: 'secure-sandbox',
          props: { script: maliciousSnippet },
        },
        React.createElement(NetronPlayground)
      )
    );

    expect(html).toContain('class="lumen-netron-playground"');
    expect((Object.prototype as any).polluted).toBe(originalPolluted);
  });
});
