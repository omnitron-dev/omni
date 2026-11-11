import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi, it, expect, describe, beforeEach } from 'vitest';

import { ApiExplorer, NetronPlayground } from '../src/interactive/index.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Interactive Explorer & Playground Components', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    return () => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };
  });

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
    const dynamicKey1 = `__lumen_canary_${Math.random().toString(36).slice(2, 10)}`;
    const dynamicKey2 = `__injected_role_${Math.random().toString(36).slice(2, 10)}`;
    const initialProtoKeys = new Set(Object.getOwnPropertyNames(Object.prototype));

    const html = renderToStaticMarkup(
      React.createElement(NetronPlayground, {
        script: `Object.prototype.${dynamicKey1} = 'exploit'; Object.prototype.${dynamicKey2} = 'admin';`,
        readOnly: true,
      })
    );

    expect(html).toContain('class="lumen-netron-playground"');
    expect((Object.prototype as any)[dynamicKey1]).toBeUndefined();
    expect((Object.prototype as any)[dynamicKey2]).toBeUndefined();

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

  it('IA-05: fails closed on remote HTTP 403 / RPC errors without falling back to local execution', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    }) as any;

    const onExecute = vi.fn();
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          React.createElement(NetronPlayground, {
            endpoint: 'https://rpc.example.com/execute',
            initialSnippet: 'return 999;',
            onExecute,
          })
        );
      });

      const runBtn = container.querySelector('.lumen-playground-run-btn') as HTMLButtonElement;
      await act(async () => {
        runBtn.click();
      });

      expect(container.querySelector('.lumen-playground-error')?.textContent).toContain('403');
      expect(container.querySelector('.lumen-playground-result')).toBeNull();
      expect(onExecute).toHaveBeenCalledTimes(1);
      expect(onExecute.mock.calls[0]?.[0]?.result).toBeUndefined();
      expect(onExecute.mock.calls[0]?.[0]?.error).toContain('403');
    } finally {
      globalThis.fetch = originalFetch;
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('SEC-07 & IA-05: never retries failed Worker code on host window and strips Worker network APIs', async () => {
    const originalWorker = (globalThis as any).Worker;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let capturedWorkerBootstrap = '';

    URL.createObjectURL = vi.fn((blob: any) => {
      if (blob && typeof blob.text === 'function') {
        blob.text().then((t: string) => {
          capturedWorkerBootstrap = t;
        });
      }
      return 'blob:mock-worker-url';
    }) as any;
    URL.revokeObjectURL = vi.fn();

    class MockWorker {
      onmessage: ((e: { data: any }) => void) | null = null;

      onerror: ((e: any) => void) | null = null;

      postMessage(_msg: { code: string }) {
        setTimeout(() => {
          this.onmessage?.({ data: { ok: false, error: 'ReferenceError: document is not defined' } });
        }, 5);
      }

      terminate() {}
    }

    (globalThis as any).Worker = MockWorker;
    const onExecute = vi.fn();
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          React.createElement(NetronPlayground, {
            initialSnippet: 'return document.cookie;',
            onExecute,
          })
        );
      });

      const runBtn = container.querySelector('.lumen-playground-run-btn') as HTMLButtonElement;
      await act(async () => {
        runBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(capturedWorkerBootstrap).toContain("'fetch'");
      expect(capturedWorkerBootstrap).toContain("'XMLHttpRequest'");
      expect(capturedWorkerBootstrap).toContain("'WebSocket'");
      expect(capturedWorkerBootstrap).toContain("'importScripts'");
      expect(container.querySelector('.lumen-playground-error')?.textContent).toContain('document is not defined');
      expect(onExecute).toHaveBeenCalledTimes(1);
      expect(onExecute.mock.calls[0]?.[0]?.result).toBeUndefined();
      expect(onExecute.mock.calls[0]?.[0]?.error).toContain('document is not defined');
    } finally {
      (globalThis as any).Worker = originalWorker;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      await act(async () => {
        root.unmount();
      });
    }
  });

  it('SEC-07 & IA-05: shadows host window/document/localStorage/fetch in test fallback and fails closed in real browsers without Worker', async () => {
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = undefined;
    window.localStorage.setItem('secret_token', 'top-secret');

    const onExecute = vi.fn();
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          React.createElement(NetronPlayground, {
            initialSnippet:
              'return { hasWindow: typeof window !== "undefined", hasDoc: typeof document !== "undefined", hasStorage: typeof localStorage !== "undefined", hasFetch: typeof fetch !== "undefined" };',
            onExecute,
          })
        );
      });

      const runBtn = container.querySelector('.lumen-playground-run-btn') as HTMLButtonElement;
      await act(async () => {
        runBtn.click();
      });

      expect(onExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          result: {
            hasWindow: false,
            hasDoc: false,
            hasStorage: false,
            hasFetch: false,
          },
        })
      );

      // Simulate real browser without happyDOM marker and without Worker: must fail closed
      const savedDescriptor = Object.getOwnPropertyDescriptor(window, 'happyDOM');
      const savedProtoDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'happyDOM');
      Object.defineProperty(window, 'happyDOM', { value: undefined, configurable: true, writable: true });
      try {
        onExecute.mockClear();
        await act(async () => {
          runBtn.click();
        });
        expect(onExecute).toHaveBeenCalledTimes(1);
        expect(onExecute.mock.calls[0]?.[0]?.error).toContain('Isolated Web Worker runtime is unavailable');
      } finally {
        if (savedDescriptor) {
          Object.defineProperty(window, 'happyDOM', savedDescriptor);
        } else {
          delete (window as any).happyDOM;
          if (savedProtoDescriptor) {
            Object.defineProperty(Object.getPrototypeOf(window), 'happyDOM', savedProtoDescriptor);
          }
        }
      }
    } finally {
      (globalThis as any).Worker = originalWorker;
      window.localStorage.removeItem('secret_token');
      await act(async () => {
        root.unmount();
      });
    }
  });
});
