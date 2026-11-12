# @omnitron-dev/netron-react

React providers and hooks for Netron services. Queries, mutations and subscriptions share the connection and cache owned by the provider.

## Capabilities

- Typed service hooks, queries, infinite queries and mutations.
- Cache invalidation, prefetching, hydration and optimistic updates.
- Connection-aware components and routing across multiple backends.
- Authentication bindings through the dedicated `auth` entry.

## Quick start

```sh
pnpm add @omnitron-dev/netron-react @omnitron-dev/netron-browser react react-dom
```

```tsx
'use client';

import { NetronProvider, NetronReactClient, useService } from '@omnitron-dev/netron-react';

interface Users {
  getUser(id: string): Promise<{ name: string }>;
}

const client = new NetronReactClient({
  url: 'https://api.example.com',
  transport: 'http',
});

function UserName() {
  const users = useService<Users>('Users');
  const { data, error, isLoading } = users.getUser.useQuery(['123']);
  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Could not load this user.</p>;
  return <p>{data?.name ?? 'No user'}</p>;
}

export function App() {
  return <NetronProvider client={client}><UserName /></NetronProvider>;
}
```

The endpoint must publish the `Users` service. Keep the client stable across renders. In a React Server Component application, create the client and render the provider within a client component; use `@omnitron-dev/netron-react/cache` for server-side cache operations.

`MultiBackendProvider` uses a shared query and mutation cache across routed backends. Pass query cancellation signals to RPC calls. Mutations are not automatically cancelled on unmount, and local cancellation does not roll back server work.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Transport client](../netron-browser/README.md) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
