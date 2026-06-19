/**
 * useQuery advanced options: keepPreviousData, suspense, useErrorBoundary.
 *
 * These three were either missing (keepPreviousData) or declared-but-unused
 * (suspense, useErrorBoundary) before. Each is gated on its option (default
 * off), so the existing behaviour is unchanged — these tests pin the new paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, render, screen } from '@testing-library/react';
import React, { Component, Suspense, type ReactNode } from 'react';
import { useQuery } from '../../src/hooks/useQuery.js';
import { useInfiniteQuery } from '../../src/hooks/useInfiniteQuery.js';
import { useQueries, type QueryObserverResult } from '../../src/hooks/useQueries.js';
import { NetronProvider } from '../../src/core/provider.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

describe('useQuery advanced options', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    client = createMockedClient([
      {
        service: 'user',
        method: 'getUser',
        delay: 80, // a window wide enough to observe the in-flight transition
        response: (id: string) => {
          const users: Record<string, { id: string; name: string }> = {
            '1': { id: '1', name: 'Alice' },
            '2': { id: '2', name: 'Bob' },
          };
          if (!users[id]) throw new Error(`User not found: ${id}`);
          return users[id];
        },
      },
      { service: 'data', method: 'failing', error: new Error('boom') },
      {
        // An infinite-query page source keyed by (category, cursor).
        service: 'feed',
        method: 'page',
        delay: 80,
        response: (category: string, cursor: number) => ({
          items: [`${category}:${cursor}`],
          next: null as number | null,
        }),
      },
    ]);
    wrapper = ({ children }) =>
      React.createElement(NetronProvider, { client, autoConnect: false, children });
  });

  afterEach(() => {
    client.clear();
  });

  describe('keepPreviousData', () => {
    it('carries over the previous key data while the new key loads, then swaps', async () => {
      const { result, rerender } = renderHook(
        ({ id }: { id: string }) =>
          useQuery<{ id: string; name: string }>({
            queryKey: ['user', id],
            queryFn: () => client.invoke('user', 'getUser', [id]),
            keepPreviousData: true,
            staleTime: Infinity,
          }),
        { wrapper, initialProps: { id: '1' } }
      );

      await waitFor(() => expect(result.current.data).toEqual({ id: '1', name: 'Alice' }));
      expect(result.current.isPreviousData).toBe(false);

      // Switch keys: while Bob loads, the hook keeps showing Alice + flags it.
      rerender({ id: '2' });
      await waitFor(() => expect(result.current.isPreviousData).toBe(true));
      expect(result.current.data).toEqual({ id: '1', name: 'Alice' });
      expect(result.current.isFetching).toBe(true);

      // Once Bob resolves, swap and clear the flag.
      await waitFor(() => expect(result.current.data).toEqual({ id: '2', name: 'Bob' }));
      expect(result.current.isPreviousData).toBe(false);
    });

    it('control: WITHOUT keepPreviousData, the isPreviousData flag is never set', async () => {
      const { result, rerender } = renderHook(
        ({ id }: { id: string }) =>
          useQuery<{ id: string; name: string }>({
            queryKey: ['user', id],
            queryFn: () => client.invoke('user', 'getUser', [id]),
            staleTime: Infinity,
          }),
        { wrapper, initialProps: { id: '1' } }
      );

      await waitFor(() => expect(result.current.data).toEqual({ id: '1', name: 'Alice' }));

      rerender({ id: '2' });
      // While the new key is in flight, the carry-over flag stays false — it is
      // gated on keepPreviousData ...
      await waitFor(() => expect(result.current.isFetching).toBe(true));
      expect(result.current.isPreviousData).toBe(false);
      // ... and the flag is still false once Bob resolves.
      await waitFor(() => expect(result.current.data).toEqual({ id: '2', name: 'Bob' }));
      expect(result.current.isPreviousData).toBe(false);
    });
  });

  describe('suspense', () => {
    it('suspends on the in-flight fetch, then renders the resolved data', async () => {
      function UserName() {
        const { data } = useQuery<{ id: string; name: string }>({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          suspense: true,
        });
        return <div>name:{data?.name}</div>;
      }

      render(
        <NetronProvider client={client} autoConnect={false}>
          <Suspense fallback={<div>loading-fallback</div>}>
            <UserName />
          </Suspense>
        </NetronProvider>
      );

      // First commit shows the Suspense fallback (the hook threw the promise).
      expect(screen.getByText('loading-fallback')).toBeTruthy();
      // After the fetch resolves, the data renders.
      await waitFor(() => expect(screen.getByText('name:Alice')).toBeTruthy());
    });
  });

  describe('useErrorBoundary', () => {
    it('throws a query error to the nearest error boundary', async () => {
      class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
        state: { error: Error | null } = { error: null };
        static getDerivedStateFromError(error: Error) {
          return { error };
        }
        render() {
          return this.state.error ? (
            <div>boundary-caught</div>
          ) : (
            (this.props.children as React.ReactElement)
          );
        }
      }

      function Failing() {
        useQuery({
          queryKey: ['data', 'failing'],
          queryFn: () => client.invoke('data', 'failing', []),
          retry: false,
          useErrorBoundary: true,
        });
        return <div>no-error</div>;
      }

      render(
        <NetronProvider client={client} autoConnect={false}>
          <Boundary>
            <Failing />
          </Boundary>
        </NetronProvider>
      );

      await waitFor(() => expect(screen.getByText('boundary-caught')).toBeTruthy());
    });
  });

  describe('useInfiniteQuery useErrorBoundary', () => {
    it('throws an infinite-query error to the nearest error boundary', async () => {
      class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
        state: { error: Error | null } = { error: null };
        static getDerivedStateFromError(error: Error) {
          return { error };
        }
        render() {
          return this.state.error ? (
            <div>infinite-boundary-caught</div>
          ) : (
            (this.props.children as React.ReactElement)
          );
        }
      }

      function Failing() {
        useInfiniteQuery({
          queryKey: ['data', 'failing-infinite'],
          queryFn: () => client.invoke('data', 'failing', []),
          getNextPageParam: () => undefined,
          initialPageParam: 0,
          retry: false,
          useErrorBoundary: true,
        });
        return <div>no-error</div>;
      }

      render(
        <NetronProvider client={client} autoConnect={false}>
          <Boundary>
            <Failing />
          </Boundary>
        </NetronProvider>
      );

      await waitFor(() => expect(screen.getByText('infinite-boundary-caught')).toBeTruthy());
    });
  });

  type Page = { items: string[]; next: number | null };

  describe('useInfiniteQuery keepPreviousData', () => {
    it('carries over the previous key pages while the new key loads, then swaps', async () => {
      const { result, rerender } = renderHook(
        ({ cat }: { cat: string }) =>
          useInfiniteQuery<Page, Error, number>({
            queryKey: ['feed', cat],
            queryFn: ({ pageParam }) => client.invoke('feed', 'page', [cat, pageParam]),
            getNextPageParam: (last) => last.next ?? undefined,
            initialPageParam: 0,
            keepPreviousData: true,
            staleTime: Infinity,
          }),
        { wrapper, initialProps: { cat: 'a' } }
      );

      await waitFor(() => expect(result.current.data?.pages[0]?.items).toEqual(['a:0']));
      expect(result.current.isPreviousData).toBe(false);

      // Switch keys: the previous category's pages stay visible + flagged while
      // the new category loads.
      rerender({ cat: 'b' });
      await waitFor(() => expect(result.current.isPreviousData).toBe(true));
      expect(result.current.data?.pages[0]?.items).toEqual(['a:0']);
      expect(result.current.isFetching).toBe(true);

      // Once the new category resolves, swap and clear the flag.
      await waitFor(() => expect(result.current.data?.pages[0]?.items).toEqual(['b:0']));
      expect(result.current.isPreviousData).toBe(false);
    });
  });

  describe('useInfiniteQuery suspense', () => {
    it('suspends on the initial page, then renders the resolved data', async () => {
      function Feed() {
        const { data } = useInfiniteQuery<Page, Error, number>({
          queryKey: ['feed', 'suspense'],
          queryFn: ({ pageParam }) => client.invoke('feed', 'page', ['s', pageParam]),
          getNextPageParam: (last) => last.next ?? undefined,
          initialPageParam: 0,
          suspense: true,
        });
        return <div>feed:{data?.pages[0]?.items[0]}</div>;
      }

      render(
        <NetronProvider client={client} autoConnect={false}>
          <Suspense fallback={<div>infinite-loading</div>}>
            <Feed />
          </Suspense>
        </NetronProvider>
      );

      expect(screen.getByText('infinite-loading')).toBeTruthy();
      await waitFor(() => expect(screen.getByText('feed:s:0')).toBeTruthy());
    });
  });

  describe('useQueries keepPreviousData', () => {
    it('flags isPreviousData per query while a key change is in flight', async () => {
      const { result, rerender } = renderHook(
        ({ id }: { id: string }) =>
          useQueries({
            queries: [
              {
                queryKey: ['user', id],
                queryFn: () => client.invoke('user', 'getUser', [id]),
                keepPreviousData: true,
                staleTime: Infinity,
              },
            ],
          }) as unknown as QueryObserverResult<{ id: string; name: string }>[],
        { wrapper, initialProps: { id: '1' } }
      );

      await waitFor(() => expect(result.current[0]?.data).toEqual({ id: '1', name: 'Alice' }));
      expect(result.current[0]?.isPreviousData).toBe(false);

      rerender({ id: '2' });
      await waitFor(() => expect(result.current[0]?.isPreviousData).toBe(true));
      expect(result.current[0]?.data).toEqual({ id: '1', name: 'Alice' });

      await waitFor(() => expect(result.current[0]?.data).toEqual({ id: '2', name: 'Bob' }));
      expect(result.current[0]?.isPreviousData).toBe(false);
    });
  });

  describe('useQueries suspense', () => {
    it('suspends until all suspense queries resolve, then renders', async () => {
      function Pair() {
        const results = useQueries({
          queries: [
            { queryKey: ['user', '1'], queryFn: () => client.invoke('user', 'getUser', ['1']), suspense: true },
            { queryKey: ['user', '2'], queryFn: () => client.invoke('user', 'getUser', ['2']), suspense: true },
          ],
        }) as unknown as QueryObserverResult<{ id: string; name: string }>[];
        return (
          <div>
            pair:{results[0]?.data?.name},{results[1]?.data?.name}
          </div>
        );
      }

      render(
        <NetronProvider client={client} autoConnect={false}>
          <Suspense fallback={<div>queries-loading</div>}>
            <Pair />
          </Suspense>
        </NetronProvider>
      );

      expect(screen.getByText('queries-loading')).toBeTruthy();
      await waitFor(() => expect(screen.getByText('pair:Alice,Bob')).toBeTruthy());
    });
  });
});
