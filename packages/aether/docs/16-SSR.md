# 16. Server-Side Rendering (SSR)

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Basic SSR](#basic-ssr)
- [Streaming SSR](#streaming-ssr)
- [Hydration](#hydration)
- [Data Fetching](#data-fetching)
- [Server Components](#server-components)
- [Client Components](#client-components)
- [Selective Hydration](#selective-hydration)
- [Error Handling](#error-handling)
- [Caching](#caching)
- [Performance](#performance)
- [SEO](#seo)
- [Titan Integration](#titan-integration)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Aether provides **first-class server-side rendering** with:

- **Streaming SSR**: Stream HTML as it's generated
- **Selective Hydration**: Only hydrate interactive components
- **Server Components**: React Server Components-like architecture
- **Automatic Code Splitting**: Per-route and per-component
- **Data Prefetching**: Load data during SSR
- **SEO Optimized**: Perfect for search engines
- **Titan Integration**: Seamless backend integration

### Why SSR?

**Benefits**:
- ⚡ Faster First Contentful Paint (FCP)
- 🔍 Better SEO (search engines see full HTML)
- 🚀 Improved perceived performance
- 📱 Works on slow networks/devices
- ♿ Better accessibility (works without JS)

**Trade-offs**:
- 🖥️ Server compute cost
- 🔄 More complex caching
- 📦 Larger server bundle

### Quick Example

```typescript
// routes/users/[id].tsx
export const loader = async ({ params }) => {
  const user = await db.users.findUnique({ where: { id: params.id } });
  return user;
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const user = useLoaderData<User>();

    return () => (
      <div>
        <h1>{user().name}</h1>
        <p>{user().email}</p>
      </div>
    );
  })
});

// Server renders:
// <div>
//   <h1>Alice</h1>
//   <p>alice@example.com</p>
// </div>
```

## Philosophy

### SSR by Default

Aether **renders on the server by default**:

```typescript
// This component renders on the server
export default defineComponent(() => {
  return () => <h1>Hello World</h1>;
});

// Server output:
// <h1>Hello World</h1>
```

No configuration needed. SSR just works.

### Progressive Enhancement

Start with **server-rendered HTML**, enhance with **JavaScript**:

```typescript
// Works without JavaScript
export default defineComponent(() => {
  return () => (
    <form action="/api/login" method="post">
      <input name="email" required />
      <button type="submit">Login</button>
    </form>
  );
});

// Enhanced with JavaScript
export default defineComponent(() => {
  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    // Client-side enhancement
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input name="email" required />
      <button type="submit">Login</button>
    </form>
  );
});
```

### Streaming First

**Stream HTML as it's generated**, don't wait for everything:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <Header /> {/* Renders immediately */}

      <Suspense fallback={<Spinner />}>
        <UserData /> {/* Streams when ready */}
      </Suspense>
    </div>
  );
});

// HTML streams:
// 1. <div><Header /></div>
// 2. <div id="suspense-1"><Spinner /></div>
// 3. (later) <script>replace('suspense-1', '<UserData />')</script>
```

### Selective Hydration

**Only hydrate interactive components**:

```typescript
// Server-only (no hydration)
export default defineComponent(() => {
  return () => <p>Static content</p>;
});

// Client-hydrated (interactive)
export default defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      Count: {count()}
    </button>
  );
});
```

Aether **automatically detects** which components need hydration.

## Basic SSR

### Rendering a Component

```typescript
// app.tsx
export default defineComponent(() => {
  return () => (
    <html>
      <head>
        <title>My App</title>
      </head>
      <body>
        <h1>Hello World</h1>
      </body>
    </html>
  );
});

// Server renders to:
// <!DOCTYPE html>
// <html>
//   <head><title>My App</title></head>
//   <body><h1>Hello World</h1></body>
// </html>
```

### Rendering with Data

```typescript
export const loader = async () => {
  const users = await db.users.findMany();
  return { users };
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const data = useLoaderData<{ users: User[] }>();

    return () => (
      <div>
        <h1>Users</h1>
        <ul>
          {#each data().users as user}
            <li>{user.name}</li>
          {/each}
        </ul>
      </div>
    );
  })
});

// Server renders with data:
// <div>
//   <h1>Users</h1>
//   <ul>
//     <li>Alice</li>
//     <li>Bob</li>
//   </ul>
// </div>
```

### Entry Point

Server entry point:

```typescript
// entry-server.ts
import { renderToString } from 'aether/server';
import App from './App';

export async function render(url: string) {
  const html = await renderToString(<App />, {
    url,
    // Optional context
    context: {
      user: await getUser(),
    }
  });

  return html;
}
```

### Titan Integration

Use Titan for SSR:

```typescript
// server.ts
import { Application } from '@omnitron-dev/titan';
import { AetherModule } from 'aether/titan';
import { AppModule } from './app.module';

const app = await Application.create([
  AetherModule.forRoot({
    entry: './src/entry-server.ts'
  }),
  AppModule
]);

await app.start();

// Aether SSR is now running on Titan
```

## Streaming SSR

### Basic Streaming

Stream HTML as components render:

```typescript
import { renderToStream } from 'aether/server';

export async function render(url: string) {
  const stream = renderToStream(<App />, { url });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/html' }
  });
}
```

### Suspense Boundaries

Use Suspense for streaming:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <Header /> {/* Renders immediately */}

      <Suspense fallback={<div>Loading users...</div>}>
        <UserList /> {/* Streams when data loads */}
      </Suspense>

      <Footer /> {/* Renders immediately */}
    </div>
  );
});

const UserList = defineComponent(() => {
  const [users] = resource(() => api.fetchUsers());

  return () => (
    <ul>
      {#each users() as user}
        <li>{user.name}</li>
      {/each}
    </ul>
  );
});
```

**HTML stream**:
```html
<!-- Initial chunk -->
<div>
  <header>Header</header>
  <div id="B:0">Loading users...</div>
  <footer>Footer</footer>
</div>

<!-- Later chunk (when users load) -->
<script>
  $RC('B:0', '<ul><li>Alice</li><li>Bob</li></ul>')
</script>
```

### Nested Suspense

Nest Suspense boundaries:

```typescript
export default defineComponent(() => {
  return () => (
    <Suspense fallback={<PageSkeleton />}>
      <div>
        <Suspense fallback={<Spinner />}>
          <UserProfile />
        </Suspense>

        <Suspense fallback={<Spinner />}>
          <UserPosts />
        </Suspense>
      </div>
    </Suspense>
  );
});

// Streams:
// 1. <div id="B:0">PageSkeleton</div>
// 2. <div>
//      <div id="B:1">Spinner</div>
//      <div id="B:2">Spinner</div>
//    </div>
// 3. <script>$RC('B:1', '<UserProfile />')</script>
// 4. <script>$RC('B:2', '<UserPosts />')</script>
```

### Out-of-Order Streaming

Components stream **as they complete**, not in order:

```typescript
<Suspense fallback={<Spinner />}>
  <SlowComponent /> {/* Takes 2s */}
</Suspense>

<Suspense fallback={<Spinner />}>
  <FastComponent /> {/* Takes 100ms */}
</Suspense>

// FastComponent streams first, even though it's second
```

### Error Boundaries with Streaming

Handle errors during streaming:

```typescript
export default defineComponent(() => {
  return () => (
    <ErrorBoundary fallback={(error) => <div>Error: {error.message}</div>}>
      <Suspense fallback={<Spinner />}>
        <UserData />
      </Suspense>
    </ErrorBoundary>
  );
});

// If UserData throws, error boundary catches it
// Streams: <div>Error: Failed to load user</div>
```

## Hydration

### Automatic Hydration

Components **automatically hydrate** if they have:
- Event handlers (`onClick`, `onInput`, etc.)
- Signals or reactive state
- Effects or lifecycle hooks

```typescript
// Auto-hydrates (has onClick)
export default defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      {count()}
    </button>
  );
});

// No hydration (static)
export default defineComponent(() => {
  return () => <p>Static text</p>;
});
```

### Hydration Script

Aether injects hydration script:

```html
<html>
  <body>
    <!-- Server-rendered content -->
    <div id="app">...</div>

    <!-- Hydration data -->
    <script id="hydration-data" type="application/json">
      {"route": "/users", "data": {...}}
    </script>

    <!-- Hydration script -->
    <script src="/hydrate.js" async></script>
  </body>
</html>
```

### Partial Hydration

Only hydrate specific components:

```typescript
import { clientOnly } from 'aether/hydration';

export default defineComponent(() => {
  return () => (
    <div>
      <Header /> {/* Server-only */}

      {clientOnly(() => <InteractiveWidget />)} {/* Client-only */}

      <Footer /> {/* Server-only */}
    </div>
  );
});
```

### Progressive Hydration

Hydrate in priority order:

```typescript
import { hydrateOnVisible, hydrateOnIdle } from 'aether/hydration';

export default defineComponent(() => {
  return () => (
    <div>
      {/* Hydrate immediately */}
      <SearchBar priority="high" />

      {/* Hydrate when visible */}
      {hydrateOnVisible(() => <ImageCarousel />)}

      {/* Hydrate when idle */}
      {hydrateOnIdle(() => <Newsletter />)}
    </div>
  );
});
```

### Hydration Mismatch

Detect and fix hydration mismatches:

```typescript
// ❌ Mismatch (server vs client render different)
export default defineComponent(() => {
  return () => <div>{Date.now()}</div>;
  // Server: <div>1234567890</div>
  // Client: <div>1234567891</div> (mismatch!)
});

// ✅ Consistent
export default defineComponent(() => {
  const timestamp = useSSRSafeValue(() => Date.now());

  return () => <div>{timestamp()}</div>;
  // Server: <div>1234567890</div>
  // Client: <div>1234567890</div> (uses server value)
});
```

## Data Fetching

### Loader Pattern

Fetch data during SSR:

```typescript
// Route loader
export const loader = async ({ params, request }) => {
  const user = await db.users.findUnique({
    where: { id: params.id }
  });

  return user;
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const user = useLoaderData<User>();

    return () => <div>{user().name}</div>;
  })
});
```

**Server flow**:
1. Request comes in for `/users/123`
2. Loader runs: `loader({ params: { id: '123' } })`
3. Component renders with data
4. HTML sent to client

### Server Functions

Use server functions:

```typescript
// api.server.ts
'use server';

export async function getUser(id: string) {
  return await db.users.findUnique({ where: { id } });
}

// Component
import { getUser } from './api.server';

export default defineComponent((props: { userId: string }) => {
  const [user] = resource(() => props.userId, getUser);

  return () => (
    <div>
      {#if user.loading}
        <Spinner />
      {:else}
        <h1>{user().name}</h1>
      {/if}
    </div>
  );
});
```

**Server flow**:
1. Component renders on server
2. `resource` calls `getUser` directly (no RPC)
3. Data embedded in HTML
4. Client hydrates with data

### Deferred Loading

Defer non-critical data:

```typescript
import { defer, Await } from 'aether/router';

export const loader = async () => {
  const user = await fetchUser(); // Critical (blocks render)
  const posts = fetchPosts(); // Deferred (doesn't block)

  return defer({ user, posts });
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const data = useLoaderData();

    return () => (
      <div>
        <h1>{data().user.name}</h1>

        <Suspense fallback={<Spinner />}>
          <Await resolve={data().posts}>
            {(posts) => (
              <ul>
                {#each posts as post}
                  <li>{post.title}</li>
                {/each}
              </ul>
            )}
          </Await>
        </Suspense>
      </div>
    );
  })
});
```

**Server flow**:
1. Loader starts
2. `fetchUser()` completes (blocks)
3. HTML streams with user data
4. `fetchPosts()` completes (later)
5. Posts stream in Suspense boundary

### Parallel Loaders

Load data in parallel:

```typescript
export const loader = async ({ params }) => {
  const [user, posts, comments] = await Promise.all([
    fetchUser(params.id),
    fetchPosts(params.id),
    fetchComments(params.id)
  ]);

  return { user, posts, comments };
};
```

## Server Components

### Server-Only Components

Components that **only render on the server**:

```typescript
import { serverOnly } from 'aether/server';

export const UserProfile = serverOnly(defineComponent(async (props: { id: string }) => {
  // Direct database access (server-only)
  const user = await db.users.findUnique({
    where: { id: props.id }
  });

  return () => (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}));

// Usage
<UserProfile id="123" />

// Server renders to static HTML:
// <div>
//   <h1>Alice</h1>
//   <p>alice@example.com</p>
// </div>

// No JavaScript sent to client
```

### Async Components

Components can be async on the server:

```typescript
export default defineComponent(async (props: { userId: string }) => {
  const user = await api.getUser(props.userId);

  return () => <div>{user.name}</div>;
});
```

### Server Context

Access server-only context:

```typescript
import { useServerContext } from 'aether/server';

export default serverOnly(defineComponent(() => {
  const ctx = useServerContext();

  // Access request, response, etc.
  const userAgent = ctx.request.headers.get('user-agent');

  return () => <div>User Agent: {userAgent}</div>;
}));
```

### Server-to-Client Data

Pass data from server to client:

```typescript
// Server component
export const ServerData = serverOnly(defineComponent(async () => {
  const data = await db.fetchExpensiveData();

  return () => (
    <ClientComponent data={data} />
  );
}));

// Client component
export const ClientComponent = defineComponent<{ data: any }>((props) => {
  const count = signal(0);

  return () => (
    <div>
      <p>Data: {props.data}</p>
      <button onClick={() => count.set(count() + 1)}>
        {count()}
      </button>
    </div>
  );
});

// Server renders:
// <div>
//   <p>Data: {...}</p>
//   <button>0</button>
// </div>
// + hydration script with data
```

## Client Components

### Client-Only Components

Components that **only render on the client**:

```typescript
import { clientOnly } from 'aether/client';

export const BrowserOnlyWidget = clientOnly(defineComponent(() => {
  // Browser APIs
  const windowWidth = signal(window.innerWidth);

  onMount(() => {
    const handler = () => windowWidth.set(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  });

  return () => <div>Window width: {windowWidth()}px</div>;
}));

// Server renders:
// <div id="client-1"></div>

// Client renders:
// <div>Window width: 1920px</div>
```

### Hybrid Components

Components that render on both server and client:

```typescript
export default defineComponent(() => {
  const count = signal(0);

  // Runs on server and client
  const doubled = computed(() => count() * 2);

  // Only runs on client
  onMount(() => {
    console.log('Mounted on client');
  });

  return () => (
    <div>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count.set(count() + 1)}>Increment</button>
    </div>
  );
});

// Server renders:
// <div>
//   <p>Count: 0</p>
//   <p>Doubled: 0</p>
//   <button>Increment</button>
// </div>

// Client hydrates and becomes interactive
```

### Client Boundaries

Mark client boundaries:

```typescript
import { ClientBoundary } from 'aether/client';

export default defineComponent(() => {
  return () => (
    <div>
      <ServerContent />

      <ClientBoundary>
        <InteractiveContent />
      </ClientBoundary>

      <MoreServerContent />
    </div>
  );
});

// Only <InteractiveContent /> hydrates
```

## Selective Hydration

### Islands Architecture

Hydrate only interactive "islands":

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      {/* Static (no hydration) */}
      <Header />

      {/* Island 1 (hydrates) */}
      <SearchBar />

      {/* Static */}
      <article>
        <h1>Article Title</h1>
        <p>Content...</p>
      </article>

      {/* Island 2 (hydrates) */}
      <CommentSection />

      {/* Static */}
      <Footer />
    </div>
  );
});

// Only SearchBar and CommentSection hydrate
// 80% less JavaScript!
```

### Lazy Hydration

Hydrate when needed:

```typescript
import { lazyHydrate } from 'aether/hydration';

export default defineComponent(() => {
  return () => (
    <div>
      {/* Hydrate on visible */}
      {lazyHydrate(() => <VideoPlayer />, {
        trigger: 'visible',
        rootMargin: '100px'
      })}

      {/* Hydrate on interaction */}
      {lazyHydrate(() => <ChatWidget />, {
        trigger: 'interaction',
        events: ['click', 'focus']
      })}

      {/* Hydrate on idle */}
      {lazyHydrate(() => <Analytics />, {
        trigger: 'idle',
        timeout: 2000
      })}
    </div>
  );
});
```

### Resumability

Resume from server state without re-execution:

```typescript
import { resumable } from 'aether/hydration';

export const Counter = resumable(defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      {count()}
    </button>
  );
}));

// Server serializes state
// Client resumes without re-running setup
```

## Error Handling

### Error Boundaries

Catch errors during SSR:

```typescript
import { ErrorBoundary } from 'aether/error';

export default defineComponent(() => {
  return () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div>
          <h1>Error: {error.message}</h1>
          <button onClick={reset}>Try again</button>
        </div>
      )}
    >
      <UserData />
    </ErrorBoundary>
  );
});

// If UserData throws during SSR:
// <div>
//   <h1>Error: Failed to load user</h1>
//   <button>Try again</button>
// </div>
```

### Streaming Errors

Handle errors during streaming:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <Header />

      <ErrorBoundary fallback={(error) => <ErrorMessage error={error} />}>
        <Suspense fallback={<Spinner />}>
          <UserData />
        </Suspense>
      </ErrorBoundary>

      <Footer />
    </div>
  );
});

// If UserData fails:
// 1. <Header /> streams
// 2. <Spinner /> streams
// 3. (error occurs)
// 4. <ErrorMessage /> streams (replaces Spinner)
// 5. <Footer /> streams
```

### 500 Errors

Handle fatal errors:

```typescript
// entry-server.ts
export async function render(url: string) {
  try {
    const html = await renderToString(<App />, { url });
    return html;
  } catch (error) {
    console.error('SSR Error:', error);

    return `
      <!DOCTYPE html>
      <html>
        <body>
          <h1>500 - Server Error</h1>
          <p>${error.message}</p>
        </body>
      </html>
    `;
  }
}
```

## Caching

### Page Caching

Cache entire pages:

```typescript
import { cache } from 'aether/cache';

export const loader = cache(
  async ({ params }) => {
    const user = await db.users.findUnique({
      where: { id: params.id }
    });
    return user;
  },
  {
    key: (ctx) => `user:${ctx.params.id}`,
    ttl: 60 * 5 // 5 minutes
  }
);
```

### Component Caching

Cache component output:

```typescript
import { cachedComponent } from 'aether/cache';

export const CachedUserCard = cachedComponent(
  defineComponent<{ userId: string }>(async (props) => {
    const user = await db.users.findUnique({
      where: { id: props.userId }
    });

    return () => (
      <div class="card">
        <h2>{user.name}</h2>
        <p>{user.email}</p>
      </div>
    );
  }),
  {
    key: (props) => `user-card:${props.userId}`,
    ttl: 60 * 10
  }
);
```

### CDN Caching

Set cache headers:

```typescript
export const loader = async ({ response }) => {
  // Cache for 1 hour, revalidate in background
  response.headers.set(
    'Cache-Control',
    'public, max-age=3600, stale-while-revalidate=86400'
  );

  const data = await fetchData();
  return data;
};
```

### Invalidation

Invalidate cache:

```typescript
import { invalidateCache } from 'aether/cache';

// Invalidate specific key
await invalidateCache('user:123');

// Invalidate pattern
await invalidateCache('user:*');

// Invalidate on mutation
export const updateUser = async (id: string, data: any) => {
  await db.users.update({ where: { id }, data });

  // Invalidate caches
  await invalidateCache(`user:${id}`);
  await invalidateCache(`user-card:${id}`);
};
```

## Performance

### Bundle Size

Aether optimizes bundle size:

```typescript
// Automatic code splitting by route
routes/
├── index.tsx           → index.[hash].js
├── about.tsx           → about.[hash].js
└── users/
    └── [id].tsx        → users-[id].[hash].js

// Each route loads only what it needs
```

### Tree Shaking

Server-only code is tree-shaken:

```typescript
// server.ts
'use server';
export async function expensiveServerFunction() {
  const hugeLibrary = await import('huge-library');
  return hugeLibrary.process();
}

// component.tsx
import { expensiveServerFunction } from './server';

// Server: expensiveServerFunction runs
// Client bundle: expensiveServerFunction removed (0 bytes)
```

### Streaming Performance

Measure streaming metrics:

```typescript
import { measureSSR } from 'aether/perf';

export async function render(url: string) {
  const { html, metrics } = await measureSSR(<App />, { url });

  console.log('TTFB:', metrics.ttfb); // Time to first byte
  console.log('FCP:', metrics.fcp); // First contentful paint
  console.log('TTI:', metrics.tti); // Time to interactive

  return html;
}
```

## SEO

### Meta Tags

Set meta tags for SEO:

```typescript
import { Head } from 'aether/head';

export default defineComponent(() => {
  return () => (
    <>
      <Head>
        <title>My Page Title</title>
        <meta name="description" content="Page description" />
        <meta property="og:title" content="My Page Title" />
        <meta property="og:description" content="Page description" />
        <meta property="og:image" content="/og-image.jpg" />
        <link rel="canonical" href="https://example.com/page" />
      </Head>

      <div>Content...</div>
    </>
  );
});

// Server renders:
// <head>
//   <title>My Page Title</title>
//   <meta name="description" content="..." />
//   ...
// </head>
```

### Structured Data

Add JSON-LD structured data:

```typescript
import { Head } from 'aether/head';

export default defineComponent(() => {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'Article Title',
    author: {
      '@type': 'Person',
      name: 'Author Name'
    }
  };

  return () => (
    <>
      <Head>
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      </Head>

      <article>...</article>
    </>
  );
});
```

### Sitemap Generation

Generate sitemap:

```typescript
// routes/sitemap.xml.ts
export const loader = async () => {
  const pages = await db.pages.findMany();

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${pages.map(page => `
        <url>
          <loc>https://example.com${page.path}</loc>
          <lastmod>${page.updatedAt.toISOString()}</lastmod>
        </url>
      `).join('')}
    </urlset>
  `;

  return new Response(sitemap, {
    headers: { 'Content-Type': 'application/xml' }
  });
};
```

## Titan Integration

### Aether Module

Use Aether with Titan:

```typescript
// app.module.ts
import { defineModule } from '@omnitron-dev/titan';
import { AetherModule } from 'aether/titan';

export const AppModule = defineModule({
  imports: [
    AetherModule.forRoot({
      entry: './src/entry-server.ts',
      port: 3000
    })
  ]
});

// server.ts
import { Application } from '@omnitron-dev/titan';
import { AppModule } from './app.module';

const app = await Application.create(AppModule);
await app.start();

// SSR server running on port 3000
```

### Service Injection

Inject Titan services in components:

```typescript
import { inject } from 'aether/di';
import { UserService } from '@/services/user.service';

export default defineComponent(async () => {
  const userService = inject(UserService);

  const users = await userService.findAll();

  return () => (
    <ul>
      {#each users as user}
        <li>{user.name}</li>
      {/each}
    </ul>
  );
});
```

### RPC Integration

Call Titan services via RPC:

```typescript
import { useRPC } from 'aether/titan';
import { UserService } from '@/services/user.service';

export default defineComponent(() => {
  const userService = useRPC(UserService);

  const [users] = resource(() => userService.findAll());

  return () => (
    <ul>
      {#each users() as user}
        <li>{user.name}</li>
      {/each}
    </ul>
  );
});

// Server: Direct service call (no RPC)
// Client: RPC call via Netron
```

## Best Practices

### 1. Stream by Default

```typescript
// ✅ Use streaming
import { renderToStream } from 'aether/server';

export async function render(url: string) {
  return renderToStream(<App />, { url });
}

// ❌ Don't wait for everything
import { renderToString } from 'aether/server';

export async function render(url: string) {
  return await renderToString(<App />, { url }); // Blocks!
}
```

### 2. Defer Non-Critical Data

```typescript
// ✅ Defer comments (not critical)
export const loader = async () => {
  const post = await fetchPost(); // Critical
  const comments = fetchComments(); // Deferred

  return defer({ post, comments });
};

// ❌ Block on comments
export const loader = async () => {
  const post = await fetchPost();
  const comments = await fetchComments(); // Blocks!

  return { post, comments };
};
```

### 3. Use Server Components

```typescript
// ✅ Server component for data fetching
export const UserList = serverOnly(defineComponent(async () => {
  const users = await db.users.findMany();

  return () => (
    <ul>
      {#each users as user}
        <li>{user.name}</li>
      {/each}
    </ul>
  );
}));

// ❌ Client component with useEffect
export const UserList = defineComponent(() => {
  const users = signal([]);

  onMount(async () => {
    const data = await api.fetchUsers();
    users.set(data);
  });

  return () => (
    <ul>
      {#each users() as user}
        <li>{user.name}</li>
      {/each}
    </ul>
  );
});
```

### 4. Selective Hydration

```typescript
// ✅ Only hydrate interactive components
<div>
  <StaticHeader />
  <InteractiveSearch />
  <StaticContent />
  <InteractiveComments />
</div>

// ❌ Hydrate everything
<ClientBoundary>
  <StaticHeader />
  <InteractiveSearch />
  <StaticContent />
  <InteractiveComments />
</ClientBoundary>
```

## Advanced Patterns

### Custom Streaming

Implement custom streaming:

```typescript
import { createStreamRenderer } from 'aether/server';

const renderer = createStreamRenderer({
  onShellReady: (stream) => {
    response.setHeader('Content-Type', 'text/html');
    stream.pipe(response);
  },
  onAllReady: () => {
    console.log('All content streamed');
  },
  onError: (error) => {
    console.error('Stream error:', error);
  }
});

const stream = renderer.render(<App />);
```

### Server-Only APIs

Expose server-only APIs:

```typescript
// api/users.server.ts
'use server';

import { db } from '@/lib/db';

export async function getUsers() {
  return await db.users.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      // Don't expose password!
    }
  });
}

// Component
import { getUsers } from '@/api/users.server';

const users = await getUsers();
// Works on server, auto-RPC on client
```

## API Reference

### renderToString

```typescript
function renderToString(
  component: JSX.Element,
  options?: {
    url?: string;
    context?: any;
  }
): Promise<string>;
```

### renderToStream

```typescript
function renderToStream(
  component: JSX.Element,
  options?: {
    url?: string;
    context?: any;
    onShellReady?: (stream: ReadableStream) => void;
    onAllReady?: () => void;
    onError?: (error: Error) => void;
  }
): ReadableStream;
```

### serverOnly

```typescript
function serverOnly<T>(
  component: Component<T>
): Component<T>;
```

### clientOnly

```typescript
function clientOnly<T>(
  component: Component<T>,
  options?: {
    fallback?: JSX.Element;
  }
): Component<T>;
```

### lazyHydrate

```typescript
function lazyHydrate(
  component: () => Component,
  options: {
    trigger: 'visible' | 'interaction' | 'idle';
    rootMargin?: string;
    events?: string[];
    timeout?: number;
  }
): JSX.Element;
```

## Examples

### Blog Post with Streaming

```typescript
// routes/posts/[slug].tsx
export const loader = async ({ params }) => {
  const post = await db.posts.findUnique({
    where: { slug: params.slug }
  });

  const comments = db.comments.findMany({
    where: { postId: post.id }
  });

  return defer({ post, comments });
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const data = useLoaderData();

    return () => (
      <article>
        <Head>
          <title>{data().post.title}</title>
          <meta name="description" content={data().post.excerpt} />
        </Head>

        <h1>{data().post.title}</h1>
        <div innerHTML={data().post.content} />

        <Suspense fallback={<div>Loading comments...</div>}>
          <Await resolve={data().comments}>
            {(comments) => (
              <div>
                <h2>Comments</h2>
                {#each comments as comment}
                  <Comment data={comment} />
                {/each}
              </div>
            )}
          </Await>
        </Suspense>
      </article>
    );
  })
});
```

### E-commerce Product Page

```typescript
// routes/products/[id].tsx
export const loader = async ({ params }) => {
  const product = await db.products.findUnique({
    where: { id: params.id },
    include: { images: true, variants: true }
  });

  const reviews = db.reviews.findMany({
    where: { productId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  const recommendations = db.products.findMany({
    where: { categoryId: product.categoryId },
    take: 4
  });

  return defer({ product, reviews, recommendations });
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const data = useLoaderData();

    return () => (
      <div>
        <Head>
          <title>{data().product.name} | Store</title>
          <meta name="description" content={data().product.description} />
          <meta property="og:image" content={data().product.images[0].url} />
          <script type="application/ld+json">
            {JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: data().product.name,
              description: data().product.description,
              image: data().product.images[0].url,
              offers: {
                '@type': 'Offer',
                price: data().product.price,
                priceCurrency: 'USD'
              }
            })}
          </script>
        </Head>

        <ProductGallery images={data().product.images} />
        <ProductInfo product={data().product} />

        <Suspense fallback={<Skeleton />}>
          <Await resolve={data().reviews}>
            {(reviews) => <ReviewList reviews={reviews} />}
          </Await>
        </Suspense>

        <Suspense fallback={<Skeleton />}>
          <Await resolve={data().recommendations}>
            {(products) => <ProductCarousel products={products} />}
          </Await>
        </Suspense>
      </div>
    );
  })
});
```

---

**Aether SSR is designed for performance and user experience.** Streaming, selective hydration, and server components ensure fast page loads and optimal JavaScript delivery. Deep Titan integration makes it easy to build full-stack applications with type-safe data fetching.

**Next**: [17. Islands Architecture →](./17-ISLANDS.md)
