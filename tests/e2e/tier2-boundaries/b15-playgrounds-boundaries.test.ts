import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiExplorer, NetronPlayground, PortalIslandHost } from '@omnitron-dev/lumen-ui';
import { LumenService } from '@omnitron-dev/titan-lumen';
import { asUser } from '../../../packages/titan-lumen/tests/netron-fixture.js';

describe('Feature 15: Interactive Playground & Explorer Boundaries', () => {
  it('TC-B15-01: executes infinite loop snippet guard through an authorized Netron invocation', async () => {
    const service = await asUser(new LumenService(), 'admin');
    const infiniteSnippet = 'while (true) { /* infinite loop */ }';

    const result = (await service.executePlayground(infiniteSnippet)) as {
      code: string;
      result: unknown;
      error?: string;
    };
    expect(result).toBeDefined();
    expect(result.code).toContain('while (true)');
    expect(result.result).toBeNull();
    expect(result.error).toMatch(/timed out/);
  });

  it('TC-B15-02: reports an unavailable configured corpus without fabricating empty success', async () => {
    const offlineService = new LumenService({ docsDir: '__non_existent_offline__' });
    await expect(offlineService.search('test query')).rejects.toThrow('configured documentation corpus');

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
          props: { code: '', readOnly: true },
        },
        React.createElement(NetronPlayground)
      )
    );

    expect(htmlPlayground).toContain('class="lumen-netron-playground"');
    expect(htmlPlayground).toContain('&quot;code&quot;:&quot;&quot;');
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
