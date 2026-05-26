# @omnitron-dev/netron-react

> React hooks and providers for type-safe Netron RPC

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/netron-react @omnitron-dev/netron-browser
```

## Overview

Production-grade React bindings for Netron RPC. Provides hooks for queries, mutations, real-time subscriptions, multi-backend routing, and authentication — all with automatic type inference from service contracts.

### Key Features

- **Type-safe hooks** — `useQuery`, `useMutation`, `useService`, `useSubscription`
- **Multi-backend** — `MultiBackendProvider` + `useBackendService` for multiple Netron servers
- **Real-time** — WebSocket subscriptions synced to React state
- **Authentication** — `AuthProvider`, `useAuth`, `AuthGuard` components
- **Caching** — smart invalidation, prefetching, optimistic updates
- **Connection-aware** — `BackendConnectionAware` renders based on connection state

## Quick Start

```tsx
import { NetronReactClient, NetronProvider } from '@omnitron-dev/netron-react';

const client = new NetronReactClient({
  url: 'https://api.example.com',
  transport: 'auto',
});

function App() {
  return (
    <NetronProvider client={client}>
      <UserProfile userId="123" />
    </NetronProvider>
  );
}

function UserProfile({ userId }: { userId: string }) {
  const userService = useService<UserService>('users');
  const { data, isLoading } = userService.getUser.useQuery([userId]);

  if (isLoading) return <Skeleton />;
  return <div>{data.name}</div>;
}
```

## Multi-Backend Setup

For apps that talk to multiple Netron backends through a gateway, use `MultiBackendProvider`. It owns a shared `QueryCache` + `MutationCache` and bridges them into the same `NetronContext` that `useNetronQuery` / `useNetronMutation` / `useInfiniteQuery` read from — so a single cache serves every hook regardless of which backend the call routed to.

```tsx
import { createMultiBackendClient } from '@omnitron-dev/netron-browser';
import { MultiBackendProvider } from '@omnitron-dev/netron-react';

const client = createMultiBackendClient({
  baseUrl: '',
  backends: {
    main: { path: '/api/main' },
    storage: { path: '/api/storage' },
  },
  defaultBackend: 'main',
});

function App() {
  return (
    <MultiBackendProvider
      client={client}
      autoConnect
      defaultOptions={{
        queries: {
          staleTime: 20_000,       // tab-switch / brief side-trip → cache hit
          cacheTime: 5 * 60_000,   // GC after 5 min without observers
          refetchOnWindowFocus: false,
          refetchOnReconnect: true,
          retry: 1,
        },
      }}
    >
      <YourApp />
    </MultiBackendProvider>
  );
}
```

### Per-query overrides

Every `useQuery` / `useInfiniteQuery` accepts its own `staleTime` and `cacheTime`. Per-query `cacheTime` is a per-observer GC hint — the cache uses `max(observers, defaultCacheTime)`, so raising it on one hook doesn't shrink retention on others.

```tsx
const settings = useNetronQuery({
  queryKey: ['platform', 'settings'],
  queryFn: () => contentRpc('getSettings'),
  staleTime: 10 * 60_000,  // settings rarely change
  cacheTime: 30 * 60_000,  // keep around past the platform default
});
```

### Mutate + invalidate

`useMutation` accepts `invalidateQueries`. After a successful mutation, every cache entry whose key matches the listed prefix is flushed.

```tsx
const appeal = useNetronMutation({
  mutationFn: (input: { reason: string }) =>
    contentRpc('fileAppeal', { decisionId, reason: input.reason }),
  invalidateQueries: [
    ['moderation', 'appeals', decisionId],
    ['moderation', 'history'],         // family-prefix invalidate
  ],
  onSuccess: () => toast.success('Filed'),
});
```

### Cross-backend reconnect

`MultiBackendClient.on('reconnect', handler)` aggregates per-backend WS reconnect events. The provider wires this into the cache so `refetchOnReconnect: true` revalidates stale entries when any WebSocket-backed backend recovers from a drop. HTTP-only deployments emit nothing — there's no reconnect semantic to revalidate against.

## Related

- `@omnitron-dev/netron-browser` — Transport layer
- `@omnitron-dev/prism` — Design system for UI components

## License

MIT
