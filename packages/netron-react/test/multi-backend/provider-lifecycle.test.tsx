import React, { StrictMode, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MultiBackendClient } from '@omnitron-dev/netron-browser';
import {
  MultiBackendProvider,
  useBackendQuery,
  useMultiBackend,
  useMultiBackendConnectionState,
  useNetronClient,
} from '../../src/index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pool(name: string) {
  return new MultiBackendClient({
    baseUrl: 'https://' + name + '.example.test',
    backends: { catalog: { path: '/api' } },
  });
}
function RecordView() {
  const query = useBackendQuery<string>('catalog', {
    service: 'Catalog',
    method: 'read',
    queryKey: ['record'],
    staleTime: Infinity,
    retry: false,
  });
  return <output aria-label="record">{query.data}</output>;
}
function Workspace() {
  const { connect, disconnect } = useMultiBackend();
  const { allConnected } = useMultiBackendConnectionState();
  const [open, setOpen] = useState(false);
  return (
    <>
      <output aria-label="connection">{allConnected ? 'online' : 'offline'}</output>
      <button onClick={() => void connect('catalog').catch(() => {})}>Connect</button>
      <button onClick={() => void disconnect('catalog')}>Disconnect</button>
      <button onClick={() => setOpen(!open)}>{open ? 'Back' : 'Open record'}</button>
      {open && <RecordView />}
    </>
  );
}

it('connects once under StrictMode, shares a query across navigation and reads the replacement pool', async () => {
  const original = pool('first'),
    replacement = pool('second');
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      const host = new URL(url).hostname;
      calls.push(host);
      return new Response(JSON.stringify({ id: request.id, success: true, data: host }));
    })
  );
  const connect = vi.spyOn(original, 'connect');
  const onConnect = vi.fn(),
    onDisconnect = vi.fn();
  const tree = (client: typeof original) => (
    <StrictMode>
      <MultiBackendProvider client={client} onConnect={onConnect} onDisconnect={onDisconnect}>
        <Workspace />
      </MultiBackendProvider>
    </StrictMode>
  );
  const view = render(tree(original));
  try {
    await waitFor(() => expect(screen.getByLabelText('connection')).toHaveTextContent('online'));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Disconnect'));
    await waitFor(() => expect(screen.getByLabelText('connection')).toHaveTextContent('offline'));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(screen.getByLabelText('connection')).toHaveTextContent('online'));
    fireEvent.click(screen.getByText('Open record'));
    await waitFor(() => expect(screen.getByLabelText('record')).toHaveTextContent('first.example.test'));
    const before = calls.length;
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText('Open record'));
    expect(screen.getByLabelText('record')).toHaveTextContent('first.example.test');
    expect(calls).toHaveLength(before);
    view.rerender(tree(replacement));
    await waitFor(() => expect(screen.getByLabelText('record')).toHaveTextContent('second.example.test'));
    expect(replacement.isConnected('catalog')).toBe(true);
  } finally {
    view.unmount();
    await original.destroy();
    await replacement.destroy();
  }
});

it('ignores pending connection callbacks from a replaced pool and after unmount', async () => {
  const first = pool('first'),
    second = pool('second');
  let finishFirst!: () => void, failSecond!: (error: Error) => void;
  vi.spyOn(first, 'connect').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      })
  );
  vi.spyOn(second, 'connect').mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        failSecond = reject;
      })
  );
  const onConnect = vi.fn(),
    onError = vi.fn();
  const tree = (client: typeof first) => (
    <StrictMode>
      <MultiBackendProvider client={client} autoConnect={false} onConnect={onConnect} onError={onError}>
        <Workspace />
      </MultiBackendProvider>
    </StrictMode>
  );
  const view = render(tree(first));
  try {
    fireEvent.click(screen.getByText('Connect'));
    view.rerender(tree(second));
    await act(async () => {
      finishFirst();
    });
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByLabelText('connection')).toHaveTextContent('offline');
    fireEvent.click(screen.getByText('Connect'));
    view.unmount();
    await act(async () => {
      failSecond(Error('connection closed'));
    });
    expect(onError).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    await first.destroy();
    await second.destroy();
  }
});

it.each(['success', 'error'] as const)(
  'notifies the current query observer once and ignores a late %s after unmount',
  async (outcome) => {
    const client = pool('observer'),
      onSuccess = vi.fn(),
      onError = vi.fn(),
      onSettled = vi.fn();
    const responses: Array<(success: boolean) => void> = [];
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const { id } = JSON.parse(String(init.body));
          responses.push((success) => {
            if (success) resolve(new Response(JSON.stringify({ id, success: true, data: 'record' })));
            else reject(Error('Late response failure'));
          });
        })
    );
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode>
        <MultiBackendProvider client={client} autoConnect={false}>
          {children}
        </MultiBackendProvider>
      </StrictMode>
    );
    const hook = renderHook(
      () =>
        useBackendQuery<string>('catalog', {
          service: 'Catalog',
          method: 'read',
          queryKey: ['record'],
          retry: false,
          onSuccess,
          onError,
          onSettled,
        }),
      { wrapper }
    );
    try {
      await waitFor(() => expect(responses).toHaveLength(1));
      await act(async () => {
        responses[0]!(true);
      });
      expect(hook.result.current.data).toBe('record');
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledTimes(1);
      let refetch!: Promise<unknown>;
      act(() => {
        refetch = hook.result.current.refetch();
      });
      await waitFor(() => expect(responses).toHaveLength(2));
      hook.unmount();
      await act(async () => {
        responses[1]!(outcome === 'success');
        await refetch;
      });
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(onSettled).toHaveBeenCalledTimes(1);
    } finally {
      hook.unmount();
      await client.destroy();
    }
  }
);

it('subscribes the committed engine to reconnects and detaches the old pool on replacement and unmount', async () => {
  function observePool(name: string) {
    const client = pool(name);
    const live = new Set<Parameters<typeof client.on>[1]>();
    const on = client.on.bind(client);
    vi.spyOn(client, 'on').mockImplementation((event, handler) => {
      const off = on(event, handler);
      live.add(handler);
      return () => {
        live.delete(handler);
        off();
      };
    });
    return {
      client,
      live,
      reconnect: () => {
        for (const listener of live) listener('catalog');
      },
    };
  }
  const first = observePool('first'),
    second = observePool('second'),
    notice = vi.fn();
  function Observer() {
    const engine = useNetronClient();
    useEffect(() => engine.on('reconnect', notice), [engine]);
    return null;
  }
  const tree = (client: typeof first.client) => (
    <StrictMode>
      <MultiBackendProvider client={client} autoConnect={false}>
        <Observer />
      </MultiBackendProvider>
    </StrictMode>
  );
  const view = render(tree(first.client));
  try {
    expect(first.live.size).toBe(1);
    first.reconnect();
    view.rerender(tree(second.client));
    expect(first.live.size).toBe(0);
    expect(second.live.size).toBe(1);
    first.reconnect();
    second.reconnect();
    view.unmount();
    expect(second.live.size).toBe(0);
    second.reconnect();
    expect(notice).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    await first.client.destroy();
    await second.client.destroy();
  }
});
