---
module: netron-react
title: "React Hooks for Netron RPC"
tags: [react, hooks, rpc, state, zustand, cache]
summary: "Production React library: useQuery/useMutation/useSubscription for Netron RPC with caching and auth"
depends_on: [netron-browser]
---

## Architecture

```
NetronProvider (context)
  └── NetronReactClient (manages connections)
       ├── useQuery()        — declarative data fetching
       ├── useMutation()     — imperative RPC calls
       ├── useSubscription() — real-time WebSocket events
       └── Cache layer       — stale-while-revalidate
```

## Key Hooks

- **useQuery(service, method, args)** — Auto-fetching with loading/error states, refetch, cache
- **useMutation(service, method)** — Returns `[mutate, { loading, error, data }]`
- **useSubscription(event)** — WebSocket event listener with auto-cleanup
- **useNetronClient()** — Direct client access for imperative calls

## State Management
Zustand-based internal state for connection status, auth context, and cache.

## Conditional Rendering
- `<ConnectionAware>` — Shows children only when connected
- `<RequireConnection>` — Renders fallback when disconnected

## Used Via Prism
```typescript
// In portal code, use through @omnitron/prism/netron
import { MultiBackendProvider, useBackendService } from '@omnitron/prism/netron';

function UserList() {
  const { data, loading } = useBackendService('Auth', 'listUsers', { page: 1 });
  if (loading) return <Spinner />;
  return <DataGrid rows={data.users} />;
}
```
