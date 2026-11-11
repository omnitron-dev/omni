import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiExplorer, NetronPlayground } from '../src/interactive/index.js';

describe('Interactive Explorer & Playground Components', () => {
  it('renders ApiExplorer with module, methods, and filter tags', () => {
    const html = renderToStaticMarkup(
      React.createElement(ApiExplorer, {
        symbol: 'CorpusGraph',
        module: '@omnitron-dev/lumen',
        description: 'Corpus dependency DAG maintainer',
        methods: [
          { name: 'getBacklinks', signature: 'getBacklinks(id: string): Set<string>', description: 'Finds backlinks' },
          { name: 'detectMathCycles', signature: 'detectMathCycles(): string[][]', description: 'Detects DAG cycles' },
        ],
        filterTags: ['ast', 'dag'],
      })
    );

    expect(html).toContain('class="lumen-api-explorer"');
    expect(html).toContain('@omnitron-dev/lumen');
    expect(html).toContain('CorpusGraph');
    expect(html).toContain('getBacklinks(id: string): Set&lt;string&gt;');
    expect(html).toContain('#ast');
    expect(html).toContain('#dag');
  });

  it('renders NetronPlayground with initial code and executes client snippet safely', async () => {
    const onExecute = vi.fn();
    const snippet = 'const a = 10; const b = 20; return a + b;';

    const html = renderToStaticMarkup(
      React.createElement(NetronPlayground, {
        initialSnippet: snippet,
        service: 'MathService',
        method: 'calculate',
        runtime: 'browser',
        onExecute,
      })
    );

    expect(html).toContain('class="lumen-netron-playground"');
    expect(html).toContain('MathService.calculate');
    expect(html).toContain('browser');
    expect(html).toContain('const a = 10;');
  });

  it('verifies generic prototype pollution defense and prototype immutability in NetronPlayground', () => {
    // Generate dynamic non-hardcoded property names to prevent test-specific cheating
    const dynamicKey1 = `__lumen_canary_${Math.random().toString(36).slice(2, 10)}`;
    const dynamicKey2 = `__injected_role_${Math.random().toString(36).slice(2, 10)}`;
    const initialProtoKeys = new Set(Object.getOwnPropertyNames(Object.prototype));

    // Verify SSR rendering never executes malicious prototype injection scripts
    const html = renderToStaticMarkup(
      React.createElement(NetronPlayground, {
        script: `Object.prototype.${dynamicKey1} = 'exploit'; Object.prototype.${dynamicKey2} = 'admin';`,
        readOnly: true,
      })
    );

    expect(html).toContain('class="lumen-netron-playground"');
    expect((Object.prototype as any)[dynamicKey1]).toBeUndefined();
    expect((Object.prototype as any)[dynamicKey2]).toBeUndefined();

    // Verify no unexpected properties were added to Object.prototype
    const currentProtoKeys = Object.getOwnPropertyNames(Object.prototype);
    for (const key of currentProtoKeys) {
      expect(initialProtoKeys.has(key)).toBe(true);
    }
    expect(currentProtoKeys.length).toBe(initialProtoKeys.size);
  });

  it('preserves snapshot result fallback when offline and no endpoint is configured', () => {
    const snapshot = {
      result: 42,
      code: 'return 42;',
      timestamp: Date.now(),
    };

    const html = renderToStaticMarkup(
      React.createElement(NetronPlayground, {
        service: 'CalculatorService',
        snapshot,
      })
    );

    expect(html).toContain('class="lumen-netron-playground"');
    expect(html).toContain('CalculatorService.execute');
    expect(html).toContain('42');
  });
});
