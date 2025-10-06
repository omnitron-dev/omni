# 09. Data Loading

> **Status**: Complete Specification
> **Last Updated**: 2025-10-06
> **Part of**: Nexus Frontend Framework Specification

---

## Table of Contents

1. [Overview](#overview)
2. [Philosophy](#philosophy)
3. [Resources](#resources)
4. [Server Functions](#server-functions)
5. [Route Loaders](#route-loaders)
6. [Mutations](#mutations)
7. [Caching](#caching)
8. [Revalidation](#revalidation)
9. [Optimistic Updates](#optimistic-updates)
10. [Parallel Loading](#parallel-loading)
11. [Error Handling](#error-handling)
12. [TypeScript Support](#typescript-support)
13. [Best Practices](#best-practices)
14. [Examples](#examples)

---

## Overview

Nexus provides powerful data loading primitives that work seamlessly with SSR, routing, and reactivity. Data loading is **declarative**, **type-safe**, and **automatically managed**.

### Key Features

- **Resources**: Reactive async data with loading/error states
- **Server Functions**: Type-safe RPC calls to server
- **Route Loaders**: Load data before rendering routes
- **Mutations**: Handle form submissions and data updates
- **Automatic Caching**: Smart caching with revalidation
- **Optimistic Updates**: Instant UI feedback
- **Suspense Integration**: Works with React Suspense patterns
- **TypeScript**: Full type safety for data flows

### Simple Example

```typescript
import { resource } from 'nexus';

const UserProfile = defineComponent(() => {
  const userId = signal(1);

  // Create resource
  const [user] = resource(
    userId,  // Source signal
    (id) => fetch(`/api/users/${id}`).then(r => r.json())  // Fetcher
  );

  return () => (
    <div>
      {#if user.loading}
        <Spinner />
      {:else if user.error}
        <Error message={user.error.message} />
      {:else}
        <div>
          <h1>{user().name}</h1>
          <p>{user().email}</p>
        </div>
      {/if}
    </div>
  );
});
```

---

## Philosophy

### Declarative Data Loading

**Imperative** (manual state management):
```typescript
const Component = defineComponent(() => {
  const data = signal(null);
  const loading = signal(false);
  const error = signal(null);

  onMount(async () => {
    loading.set(true);
    try {
      const res = await fetch('/api/data');
      data.set(await res.json());
    } catch (err) {
      error.set(err);
    } finally {
      loading.set(false);
    }
  });

  return () => (
    <div>
      {#if loading()}
        <Spinner />
      {:else if error()}
        <Error />
      {:else}
        <Data value={data()} />
      {/if}
    </div>
  );
});
```

**Declarative** (with Resource):
```typescript
const Component = defineComponent(() => {
  const [data] = resource(() => fetch('/api/data').then(r => r.json()));

  return () => (
    <div>
      {#if data.loading}
        <Spinner />
      {:else if data.error}
        <Error />
      {:else}
        <Data value={data()} />
      {/if}
    </div>
  );
});
```

### Server-First

Data loading prioritizes server rendering:
- Loaders run on server during SSR
- Data is serialized and sent to client
- Client hydrates with server data
- No waterfall requests

### Type Safety

Full TypeScript support:
```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const [user] = resource<User>(() => fetchUser());
// user() is typed as User | undefined
```

---

## Resources

### Basic Resource

```typescript
import { defineComponent, resource } from 'nexus';

const DataComponent = defineComponent(() => {
  const data = resource(() => {
    return fetch('/api/data').then(r => r.json());
  });

  return () => (
    <div>
      {/* Access data */}
      {data() && <div>{data().title}</div>}

      {/* Check loading state */}
      {#if data.loading}
        <Spinner />
      {/if}

      {/* Check error state */}
      {#if data.error}
        <Error message={data.error.message} />
      {/if}
    </div>
  );
});
```

### Resource with Source

Resource refetches when source changes:

```typescript
import { defineComponent, signal, resource } from 'nexus';

const UserComponent = defineComponent(() => {
  const userId = signal(1);

  const user = resource(() =>
    fetch(`/api/users/${userId()}`).then(r => r.json())
  );

  return () => (
    <div>
      {/* Change userId triggers refetch */}
      <button on:click={() => userId.set(2)}>
        Load User 2
      </button>

      {#if user()}
        <div>{user().name}</div>
      {/if}
    </div>
  );
});
```

### Multiple Dependencies

```typescript
import { defineComponent, signal, resource } from 'nexus';

const UserDetailsComponent = defineComponent(() => {
  const userId = signal(1);
  const includeRoles = signal(false);

  // Resource automatically tracks all signal dependencies
  const user = resource(() => {
    const id = userId();
    const roles = includeRoles();
    const url = `/api/users/${id}${roles ? '?include=roles' : ''}`;
    return fetch(url).then(r => r.json());
  });

  return () => (
    <div>
      <button on:click={() => includeRoles.set(!includeRoles())}>
        Toggle Roles
      </button>
      {user() && <UserCard user={user()} />}
    </div>
  );
});
```

### Resource Methods

```typescript
import { defineComponent, resource } from 'nexus';

const DataComponent = defineComponent(() => {
  const data = resource(() => fetchData());

  const handleRefresh = () => {
    data.refetch(); // Manually trigger refetch
  };

  const handleOptimisticUpdate = () => {
    // Optimistic update (mutate local data)
    data.mutate({ ...data(), likes: data().likes + 1 });

    // Then sync with server
    api.incrementLikes(data().id);
  };

  return () => (
    <div>
      <button on:click={handleRefresh}>Refresh</button>
      <button on:click={handleOptimisticUpdate}>Like</button>
      {data() && <DataView data={data()} />}
    </div>
  );
});
```

### Resource States

```typescript
import { defineComponent, resource } from 'nexus';

const DataComponent = defineComponent(() => {
  const data = resource(() => fetchData());

  return () => (
    <div>
      {/* State values */}
      {/* data.state: 'unresolved' | 'pending' | 'ready' | 'refreshing' | 'errored' */}
      {/* data.loading: boolean */}
      {/* data.error: Error | undefined */}
      {/* data(): Data | undefined */}

      {/* Check states */}
      {#if data.state === 'pending'}
        <InitialLoading />
      {:else if data.state === 'refreshing'}
        <RefreshingIndicator />
      {:else if data.state === 'errored'}
        <Error message={data.error.message} />
      {:else if data.state === 'ready'}
        <Content data={data()} />
      {/if}
    </div>
  );
});
```

### Resource Options

```typescript
const data = resource(
  source,
  fetcher,
  {
    // Initial value before first fetch
    initialValue: null,

    // Custom name for debugging
    name: 'user-data',

    // Defer fetching until source is defined
    deferStream: false,

    // Error handler
    onError: (error) => {
      console.error('Fetch failed:', error);
      trackError(error);
    },

    // Custom storage (default: signal)
    storage: (init) => signal(init)
  }
);
```

---

## Server Functions

### Creating Server Functions

Server functions run **only on the server**, but can be called from client code:

```typescript
// lib/api.server.ts
'use server';

import { db } from './db';

export async function getUser(id: number) {
  return db.users.findUnique({ where: { id } });
}

export async function updateUser(id: number, data: Partial<User>) {
  return db.users.update({ where: { id }, data });
}
```

**Usage**:

```typescript
import { getUser, updateUser } from '@/lib/api.server';

const UserProfile = defineComponent(() => {
  const userId = signal(1);

  // Call server function from client
  const [user] = resource(userId, getUser);

  const handleUpdate = async (name: string) => {
    await updateUser(userId(), { name });
    refetch(); // Refresh data
  };

  return () => (
    <div>
      <h1>{user().name}</h1>
      <button on:click={() => handleUpdate('New Name')}>
        Update
      </button>
    </div>
  );
});
```

### Server Function Features

**Type Safety**: Full TypeScript support across client/server boundary

**Automatic Serialization**: Arguments and return values are automatically serialized

**Security**: Server-only code never sent to client

**Performance**: No client-side bundle bloat

### Titan RPC Integration

Server functions can use Titan services:

```typescript
// services/user.service.ts
import { Injectable } from '@omnitron-dev/titan';
import { Service, Public } from '@omnitron-dev/titan/netron';

@Injectable()
@Service('users@1.0.0')
export class UserService {
  @Public()
  async findById(id: number) {
    return this.db.users.findUnique({ where: { id } });
  }

  @Public()
  async update(id: number, data: Partial<User>) {
    return this.db.users.update({ where: { id }, data });
  }
}
```

**Usage** (automatic RPC):

```typescript
import { inject } from 'nexus/di';
import { UserService } from '@/services/user.service';

const Component = defineComponent(() => {
  const userService = inject(UserService);

  // Automatic RPC call to server
  const [user] = resource(
    () => 1,
    (id) => userService.findById(id)
  );

  return () => <div>{user().name}</div>;
});
```

---

## Route Loaders

### Basic Loader

Load data before rendering route:

```typescript
// routes/users/[id].tsx
import { defineRoute, useLoaderData } from 'nexus/router';

interface User {
  id: number;
  name: string;
}

export const loader = async ({ params }: { params: { id: string } }) => {
  const user = await fetch(`/api/users/${params.id}`).then(r => r.json());
  return user as User;
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const user = useLoaderData<User>();

    return () => <div>{user().name}</div>;
  })
});
```

### Loader Context

```typescript
export const loader = async ({
  params,  // Route parameters
  request, // Request object
  url,     // URL object
  query    // Query parameters
}) => {
  const userId = params.id;
  const page = query.get('page') || '1';

  const [user, posts] = await Promise.all([
    fetchUser(userId),
    fetchUserPosts(userId, parseInt(page))
  ]);

  return { user, posts };
};
```

### Deferred Data

Load critical data immediately, defer non-critical:

```typescript
import { defer } from 'nexus/router';

export const loader = async ({ params }) => {
  // Load immediately (blocks render)
  const user = await fetchUser(params.id);

  // Defer (doesn't block render)
  const posts = fetchUserPosts(params.id); // Don't await!

  return defer({ user, posts });
};

export default defineComponent(() => {
  const data = useLoaderData();

  return () => (
    <div>
      {/* Available immediately */}
      <h1>{data().user.name}</h1>

      {/* Loads in background */}
      <Suspense fallback={<PostsSkeleton />}>
        <Await resolve={data().posts}>
          {(posts) => <PostList posts={posts} />}
        </Await>
      </Suspense>
    </div>
  );
});
```

### Loader Errors

```typescript
export const loader = async ({ params }) => {
  const user = await fetchUser(params.id);

  if (!user) {
    throw new Response('User not found', { status: 404 });
  }

  if (!canViewUser(user)) {
    throw new Response('Forbidden', { status: 403 });
  }

  return user;
};

// Handle in error boundary
// routes/_error.tsx
const ErrorBoundary = defineComponent(() => {
  const error = useRouteError();

  return () => (
    <div>
      <h1>{error().status}</h1>
      <p>{error().statusText}</p>
    </div>
  );
});
```

---

## Mutations

### Form Actions

```typescript
// routes/users/[id]/edit.tsx
export const action = async ({ request, params }) => {
  const formData = await request.formData();

  const name = formData.get('name');
  const email = formData.get('email');

  await updateUser(params.id, { name, email });

  return { success: true };
};

export default defineComponent(() => {
  const user = useLoaderData<User>();
  const actionData = useActionData();
  const navigation = useNavigation();

  const isSubmitting = computed(() => navigation.state === 'submitting');

  return () => (
    <form method="post">
      <input name="name" value={user().name} />
      <input name="email" value={user().email} />

      <button type="submit" disabled={isSubmitting()}>
        {isSubmitting() ? 'Saving...' : 'Save'}
      </button>

      {#if actionData()?.success}
        <div class="success">Saved!</div>
      {/if}
    </form>
  );
});
```

### Programmatic Mutations

```typescript
import { useFetcher } from 'nexus/router';

const Component = defineComponent(() => {
  const fetcher = useFetcher();

  const handleLike = async () => {
    fetcher.submit(
      { action: 'like', postId: '123' },
      { method: 'post', action: '/api/like' }
    );
  };

  return () => (
    <button
      on:click={handleLike}
      disabled={fetcher.state === 'submitting'}
    >
      Like {fetcher.state === 'submitting' && '...'}
    </button>
  );
});
```

### Revalidation After Mutations

```typescript
export const action = async ({ request }) => {
  await updateUser(/* ... */);

  // Revalidate routes
  return { revalidate: ['/users', '/profile'] };
};
```

---

## Caching

### Automatic Caching

Resources are automatically cached:

```typescript
const [user] = resource(
  () => userId(),
  fetchUser
);

// First call: fetches from server
userId(1);

// Second call: returns cached data
userId(1);

// Different ID: fetches again
userId(2);
```

### Cache Keys

```typescript
import { cache } from 'nexus/data';

const fetchUser = cache(
  async (id: number) => {
    return fetch(`/api/users/${id}`).then(r => r.json());
  },
  {
    // Custom cache key
    key: (id) => `user-${id}`,

    // Cache duration (ms)
    ttl: 60000, // 1 minute

    // Max cache size
    maxSize: 100
  }
);
```

### Cache Invalidation

```typescript
import { invalidateCache } from 'nexus/data';

// Invalidate specific key
invalidateCache('user-1');

// Invalidate pattern
invalidateCache(/^user-/);

// Clear all cache
invalidateCache();
```

### Stale-While-Revalidate

```typescript
const [data] = resource(
  source,
  fetcher,
  {
    // Return stale data immediately, revalidate in background
    staleWhileRevalidate: true
  }
);
```

---

## Revalidation

### Manual Revalidation

```typescript
const [data, { refetch }] = resource(fetchData);

// Manually refetch
<button on:click={refetch}>Refresh</button>
```

### Automatic Revalidation

```typescript
import { resource } from 'nexus';

const [data] = resource(
  fetchData,
  {
    // Revalidate on focus
    revalidateOnFocus: true,

    // Revalidate on reconnect
    revalidateOnReconnect: true,

    // Polling interval (ms)
    refreshInterval: 5000
  }
);
```

### Conditional Revalidation

```typescript
const isActive = signal(true);

const [data] = resource(
  fetchData,
  {
    // Only revalidate when active
    refreshInterval: computed(() => isActive() ? 5000 : 0)
  }
);
```

---

## Optimistic Updates

### Basic Optimistic Update

```typescript
const [todos, { mutate }] = resource(fetchTodos);

const addTodo = async (text: string) => {
  const newTodo = { id: Date.now(), text, done: false };

  // Optimistic update (instant UI)
  mutate([...todos(), newTodo]);

  try {
    // Actual API call
    await saveTodo(newTodo);
  } catch (error) {
    // Rollback on error
    mutate(todos());
    alert('Failed to save todo');
  }
};
```

### Optimistic Update with Rollback

```typescript
const [data, { mutate }] = resource(fetchData);

const updateItem = async (id: number, updates: Partial<Item>) => {
  const previousData = data();

  // Optimistic update
  mutate(previousData.map(item =>
    item.id === id ? { ...item, ...updates } : item
  ));

  try {
    await api.updateItem(id, updates);
  } catch (error) {
    // Automatic rollback
    mutate(previousData);
    throw error;
  }
};
```

### Reconciliation

```typescript
const [data, { mutate }] = resource(fetchData);

const handleUpdate = async (updates: Partial<Data>) => {
  // Optimistic update
  mutate({ ...data(), ...updates });

  // Server update
  const serverData = await api.update(updates);

  // Reconcile with server response
  mutate(serverData);
};
```

---

## Parallel Loading

### Promise.all

```typescript
export const loader = async () => {
  const [users, posts, comments] = await Promise.all([
    fetchUsers(),
    fetchPosts(),
    fetchComments()
  ]);

  return { users, posts, comments };
};
```

### Multiple Resources

```typescript
const Component = defineComponent(() => {
  const [users] = resource(fetchUsers);
  const [posts] = resource(fetchPosts);
  const [comments] = resource(fetchComments);

  // All load in parallel

  return () => (
    <div>
      {#if users.loading || posts.loading || comments.loading}
        <Spinner />
      {:else}
        <Dashboard
          users={users()}
          posts={posts()}
          comments={comments()}
        />
      {/if}
    </div>
  );
});
```

### Suspense Coordination

```typescript
const Component = defineComponent(() => {
  return () => (
    <Suspense fallback={<PageSkeleton />}>
      {/* All resources load in parallel, page waits for all */}
      <Users />
      <Posts />
      <Comments />
    </Suspense>
  );
});

const Users = defineComponent(() => {
  const [users] = resource(fetchUsers);
  return () => <UserList users={users()} />;
});
```

---

## Error Handling

### Try/Catch in Loaders

```typescript
export const loader = async ({ params }) => {
  try {
    const user = await fetchUser(params.id);
    return { user };
  } catch (error) {
    return { error: error.message };
  }
};

export default defineComponent(() => {
  const data = useLoaderData();

  return () => (
    <div>
      {#if data().error}
        <Error message={data().error} />
      {:else}
        <UserProfile user={data().user} />
      {/if}
    </div>
  );
});
```

### Resource Error Handling

```typescript
const [data] = resource(
  fetchData,
  {
    onError: (error) => {
      console.error('Failed to load:', error);
      trackError(error);
    }
  }
);

// In template
{#if data.error}
  <div class="error">
    Error: {data.error.message}
    <button on:click={refetch}>Retry</button>
  </div>
{/if}
```

### Error Boundaries

```typescript
import { ErrorBoundary } from 'nexus';

const App = defineComponent(() => {
  return () => (
    <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
      <DataDependentComponent />
    </ErrorBoundary>
  );
});
```

---

## TypeScript Support

### Typed Resources

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const [user] = resource<User>(
  () => userId(),
  (id) => fetch(`/api/users/${id}`).then(r => r.json())
);

// user() is typed as User | undefined
```

### Typed Loaders

```typescript
interface LoaderData {
  user: User;
  posts: Post[];
}

export const loader = async (): Promise<LoaderData> => {
  const [user, posts] = await Promise.all([
    fetchUser(),
    fetchPosts()
  ]);

  return { user, posts };
};

export default defineComponent(() => {
  const data = useLoaderData<LoaderData>();

  // data() is typed as LoaderData
  return () => <div>{data().user.name}</div>;
});
```

### Typed Server Functions

```typescript
// Server function with types
export async function getUser(id: number): Promise<User> {
  return db.users.findUnique({ where: { id } });
}

// Client usage - fully typed
const [user] = resource(() => 1, getUser);
// user() is typed as User | undefined
```

---

## Best Practices

### 1. Use Resources for Async Data

```typescript
// ✅ Good - declarative
const [user] = resource(fetchUser);

// ❌ Bad - imperative
const user = signal(null);
onMount(async () => {
  user.set(await fetchUser());
});
```

### 2. Colocate Loaders with Routes

```
routes/
└── users/
    ├── [id].tsx        # Component
    └── [id].loader.ts  # Loader
```

### 3. Handle Loading States

```typescript
// ✅ Good - handles all states
{#if data.loading}
  <Spinner />
{:else if data.error}
  <Error />
{:else}
  <Content data={data()} />
{/if}

// ❌ Bad - assumes data is always present
<Content data={data()} />
```

### 4. Use Parallel Loading

```typescript
// ✅ Good - parallel
const [users, posts] = await Promise.all([
  fetchUsers(),
  fetchPosts()
]);

// ❌ Bad - waterfall
const users = await fetchUsers();
const posts = await fetchPosts();
```

### 5. Invalidate Cache After Mutations

```typescript
const handleUpdate = async () => {
  await updateUser(userId(), data);

  // Invalidate cache
  refetch();
};
```

---

## Examples

See routing examples for complete integration examples.

---

**End of Data Loading Specification**