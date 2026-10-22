import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MultiBackendClient } from '@omnitron-dev/netron-browser';
import { NetronReactClient } from '../src/core/client.js';
import { NetronProvider } from '../src/core/provider.js';
import { useNetronClient } from '../src/core/context.js';
import { MultiBackendProvider } from '../src/multi-backend/provider.js';
import { useBackendQuery, useBackendService, useBackendMutation } from '../src/multi-backend/hooks.js';
import { useService } from '../src/hooks/useService.js';
import type { QueryOptions } from '../src/core/types.js';

interface Knowledge { read(): Promise<string>; }
interface Pending { signal: AbortSignal; reply(data: string): void; }
function pendingFetch() {
  const pending: Pending[] = [];
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const { id } = JSON.parse(String(init.body));
    const signal = init.signal!;
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.push({ signal, reply(data) {
      signal.removeEventListener('abort', abort);
      resolve(new Response(JSON.stringify({ id, success: true, data })));
    } });
  })));
  return pending;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('query cancellation owns the transport invocation', () => {
  it.each(['backend query', 'backend service'] as const)('%s forwards cancellation, then refetches with a fresh signal', async mode => {
    const pending = pendingFetch();
    const client = new MultiBackendClient({ baseUrl: 'https://example.test', backends: { site: { path: '/api' } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <MultiBackendProvider client={client} autoConnect={false} defaultOptions={{ queries: { retry: false } }}>{children}</MultiBackendProvider>;
    const { result, unmount } = renderHook(() => {
      const query = mode === 'backend query'
        ? useBackendQuery<string>('site', { service: 'Knowledge', method: 'read', queryKey: ['read'] })
        : useBackendService<Knowledge>('site', 'Knowledge').read.useQuery([]);
      return { query, engine: useNetronClient() };
    }, { wrapper });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { await result.current.engine.cancelQueries(); });
    expect(pending[0]!.signal.aborted).toBe(true);
    let refetch!: Promise<unknown>;
    act(() => { refetch = result.current.query.refetch(); });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.signal.aborted).toBe(false);
    await act(async () => { pending[0]!.reply('stale'); pending[1]!.reply('fresh'); await refetch; });
    expect(result.current.query.data).toBe('fresh');
    unmount(); await client.destroy();
  });

  it('single-backend useService forwards its cache signal into the HTTP client', async () => {
    const pending = pendingFetch();
    const client = new NetronReactClient({ url: 'https://example.test', transport: 'http', defaults: { retry: 0 } });
    await client.connect();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <NetronProvider client={client} autoConnect={false}>{children}</NetronProvider>;
    const { unmount } = renderHook(() => useService<Knowledge>('Knowledge').read.useQuery([]), { wrapper });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { await client.cancelQueries(); });
    expect(pending[0]!.signal.aborted).toBe(true);
    unmount(); await client.disconnect(); client.clear();
  });

  it('registry query configurations preserve the signal through service middleware', async () => {
    const pending = pendingFetch();
    const client = new NetronReactClient({ url: 'https://example.test', transport: 'http' }); await client.connect();
    // This legacy registry API returns query configuration; useService is the actual hook API.
    const config = client.service<Knowledge>('Knowledge').read.useQuery([]) as unknown as QueryOptions<string>;
    const controller = new AbortController();
    const call = config.queryFn({ queryKey: ['Knowledge', 'read'], signal: controller.signal });
    const rejected = expect(call).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(pending).toHaveLength(1)); controller.abort(); await rejected;
    expect(pending[0]!.signal.aborted).toBe(true);
    await client.disconnect(); client.clear();
  });

  it('unmount does not automatically cancel a mutation that may already have committed', async () => {
    const pending = pendingFetch();
    const client = new MultiBackendClient({ baseUrl: 'https://example.test', backends: { site: { path: '/api' } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <MultiBackendProvider client={client} autoConnect={false}>{children}</MultiBackendProvider>;
    const { result, unmount } = renderHook(() => useBackendMutation<string, Error, string[]>('site', { service: 'Knowledge', method: 'write' }), { wrapper });
    let mutation!: Promise<string>;
    act(() => { mutation = result.current.mutateAsync(['value']); });
    await waitFor(() => expect(pending).toHaveLength(1)); unmount();
    expect(pending[0]!.signal.aborted).toBe(false);
    pending[0]!.reply('committed'); await expect(mutation).resolves.toBe('committed'); await client.destroy();
  });
});
