import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { ServiceDescriptor } from '@omnitron-dev/netron-protocol';
import { NetronClient, MultiBackendClient } from '@omnitron-dev/netron-browser';
import { NetronReactClient } from '../src/core/client.js';
import { NetronProvider } from '../src/core/provider.js';
import { useService } from '../src/hooks/useService.js';
import { createTestClient } from '../src/test/index.js';

interface Catalog { read(id: string): Promise<string> }
const CatalogService = ServiceDescriptor.of<Catalog>('Catalog', '2.0.0');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function echoTransport() {
  const calls: Array<{ service: string; method: string; input: unknown[] }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    return new Response(JSON.stringify({ id: body.id, success: true, data: String(body.input[0]) }));
  }));
  return calls;
}

describe('shared Netron service identity in browser and React', () => {
  it('uses the qualified name with the public test client as well', async () => {
    const client = createTestClient({ mocks: [{ service: 'Catalog@2.0.0', method: 'read', response: 'mock document' }] });
    try {
      expect(await client.invoke(CatalogService, 'read', ['guide'])).toBe('mock document');
    } finally { await client.disconnect(); client.clear(); }
  });
  it('uses the same qualified name for direct calls, proxies and hooks', async () => {
    const calls = echoTransport();
    const client = new NetronReactClient({ url: 'https://example.test', transport: 'http', defaults: { retry: 0 } });
    await client.connect();
    try {
      expect(await client.invoke(CatalogService, 'read', ['direct'])).toBe('direct');
      expect(await client.service(CatalogService).read.call('proxy')).toBe('proxy');
      const wrapper = ({ children }: { children: React.ReactNode }) => <NetronProvider client={client} autoConnect={false}>{children}</NetronProvider>;
      const { result, unmount } = renderHook(() => useService(CatalogService).read.useQuery(['hook']), { wrapper });
      await waitFor(() => expect(result.current.data).toBe('hook'));
      unmount();
      expect(calls.map(({ service, method }) => [service, method])).toEqual(Array.from({ length: 3 }, () => ['Catalog@2.0.0', 'read']));
    } finally { await client.disconnect(); client.clear(); }
  });

  it('supports the same descriptor in browser and multiple-backend clients', async () => {
    const calls = echoTransport();
    const browser = new NetronClient({ url: 'https://example.test', transport: 'http' });
    const multi = new MultiBackendClient({ baseUrl: 'https://example.test', backends: { docs: { path: '/api' } }, defaultBackend: 'docs' });
    try {
      expect(await browser.invoke(CatalogService, 'read', ['direct'])).toBe('direct');
      expect(await browser.service(CatalogService).read('browser')).toBe('browser');
      expect(await multi.backend('docs').service(CatalogService).read('multi')).toBe('multi');
      expect(calls.every((call) => call.service === 'Catalog@2.0.0')).toBe(true);
    } finally { await browser.disconnect(); await multi.destroy(); }
  });
});
