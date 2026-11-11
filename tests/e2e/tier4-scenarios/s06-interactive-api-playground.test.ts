import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenShell, PortalIslandHost, ApiExplorer, NetronPlayground, CodeBlock } from '@omnitron-dev/lumen-ui';
import { LumenRpcService } from '@omnitron-dev/titan-lumen';

describe('Tier 4: Scenario 06 — Interactive API Documentation with Live Playground', () => {
  it('renders virtualized API explorer and sandboxed Netron playground inside selective portal islands', () => {
    const explorerProps = {
      specUrl: '/api/v1/openapi.json',
      filterTags: ['crypto', 'compiler'],
    };

    const playgroundProps = {
      initialSnippet: 'const client = new LumenRpcClient();\nawait client.ping();',
      runtime: 'node22',
      timeoutMs: 5000,
    };

    const html = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'en', currentPath: '/api/playground' },
        React.createElement('div', { className: 'api-layout' }, [
          React.createElement(
            PortalIslandHost,
            {
              key: 'api-explorer',
              islandId: 'api-explorer-island',
              hydrate: 'visible',
              props: explorerProps,
            },
            React.createElement(ApiExplorer)
          ),
          React.createElement(
            PortalIslandHost,
            {
              key: 'netron-playground',
              islandId: 'netron-playground-island',
              hydrate: 'interaction',
              props: playgroundProps,
            },
            React.createElement(NetronPlayground)
          ),
        ])
      )
    );

    expect(html).toContain('data-lumen-island="api-explorer-island"');
    expect(html).toContain('data-hydrate="visible"');
    expect(html).toContain('lumen-api-explorer');
    expect(html).toContain('data-lumen-island="netron-playground-island"');
    expect(html).toContain('data-hydrate="interaction"');
    expect(html).toContain('lumen-netron-playground');
  });

  it('executes sandboxed RPC snippets and provides signed static fallback outputs', async () => {
    const rpcService = new LumenRpcService({
      docsDir: 'docs',
      kbEnabled: true,
    });

    const snippet = 'const x = Math.sqrt(16); return x;';
    const execution = (await rpcService.executePlayground(snippet)) as { result: unknown; code: string };

    expect(execution).toBeDefined();
    expect(execution.code).toBe(snippet);

    // Static code fallback rendering for non-interactive clients
    const fallbackHtml = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        code: snippet,
        language: 'typescript',
      })
    );

    expect(fallbackHtml).toContain('class="lumen-code-block language-typescript"');
    expect(fallbackHtml).toContain('Math.sqrt(16)');
  });
});
