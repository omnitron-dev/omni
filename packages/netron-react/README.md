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

## Related

- `@omnitron-dev/netron-browser` — Transport layer
- `@omnitron-dev/prism` — Design system for UI components

## License

MIT
