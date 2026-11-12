import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { ApiExplorer, NetronPlayground, executeSandboxedCode, type NetronPlaygroundProps, type PlaygroundServiceResult } from '../src/interactive/index.js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('interactive documentation', () => {
  let container: HTMLDivElement;
  let root: Root;
  const mount = async (props: NetronPlaygroundProps) => { await act(async () => root.render(<NetronPlayground {...props} />)); };
  const run = async () => { await act(async () => (container.querySelector('button') as HTMLButtonElement).click()); };
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders API methods without executing them', () => {
    const html = renderToStaticMarkup(<ApiExplorer symbol="CorpusGraph" module="@omnitron-dev/lumen" methods={[{ name: 'getBacklinks', signature: 'getBacklinks(id: string): Set<string>' }]} filterTags={['ast']} />);
    expect(html).toContain('getBacklinks(id: string): Set&lt;string&gt;');
    expect(html).toContain('#ast');
  });

  it('keeps recorded output separate from a failed local run when Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const onExecute = vi.fn();
    const code = 'return 42';
    await mount({ code, snapshot: { code, result: 42 }, onExecute });
    await run();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Web Worker runtime is unavailable');
    expect(container.querySelector('.lumen-playground-result')).toBeNull();
    expect(container.querySelector('details')?.textContent).toContain('Recorded output42');
    expect(onExecute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ result: undefined, error: expect.any(String) }));
  });

  it('uses one typed remote method and preserves service errors', async () => {
    const code = 'return 6 * 7';
    const execute = vi.fn().mockResolvedValue({ code, result: 42 });
    const onExecute = vi.fn();
    await mount({ code, execute, onExecute });
    await run();
    expect(execute).toHaveBeenCalledExactlyOnceWith(code);
    expect(container.querySelector('.lumen-playground-result')?.textContent).toBe('42');
    execute.mockResolvedValue({ code, result: null, error: 'Permission denied' });
    await run();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Permission denied');
    expect(container.querySelector('.lumen-playground-result')).toBeNull();
    expect(onExecute.mock.lastCall?.[0].result).toBeUndefined();
  });

  it('fails server execution without a configured queried service rather than running locally', async () => {
    const worker = vi.fn();
    vi.stubGlobal('Worker', worker);
    await mount({ code: 'return 42', mode: 'server' });
    await run();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Netron executePlayground method is required');
    expect(worker).not.toHaveBeenCalled();
  });

  it('does not report a stale remote response after the snippet changes', async () => {
    let resolve!: (value: PlaygroundServiceResult) => void;
    const execute = () => new Promise<PlaygroundServiceResult>(done => { resolve = done; });
    const onExecute = vi.fn();
    await mount({ code: 'return 1', execute, onExecute });
    await run();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Running code…');
    await mount({ code: 'return 2', execute, onExecute });
    await act(async () => resolve({ code: 'return 1', result: 1 }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(container.querySelector('.lumen-playground-result')).toBeNull();
  });

  it('terminates its worker on unmount without reporting completion', async () => {
    const terminate = vi.fn();
    const options: unknown[] = [];
    vi.stubGlobal('Worker', class {
      constructor(...args: unknown[]) { options.push(args); }
      terminate = terminate;
      postMessage() {}
    });
    const onExecute = vi.fn();
    await mount({ code: 'while(true){}', onExecute });
    await run();
    expect(options[0]).toEqual([expect.any(URL), { type: 'module', name: 'lumen-playground' }]);
    await act(async () => root.render(null));
    expect(terminate).toHaveBeenCalledOnce();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('enforces the host deadline even when the worker never responds', async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    vi.stubGlobal('Worker', class { terminate = terminate; postMessage() {} });
    const outcome = executeSandboxedCode('while(true){}', 100).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toEqual(new Error('Execution timed out after 100ms'));
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('rejects oversized snippets and deadlines outside the shared limit before creating workers', async () => {
    const worker = vi.fn();
    vi.stubGlobal('Worker', worker);
    await expect(executeSandboxedCode('x'.repeat(65_537))).rejects.toThrow('65536 bytes');
    for (const timeout of [0, -1, 5001, Number.NaN, Infinity])
      await expect(executeSandboxedCode('return 42', timeout)).rejects.toThrow('between 1 and 5000');
    expect(worker).not.toHaveBeenCalled();
  });
});
