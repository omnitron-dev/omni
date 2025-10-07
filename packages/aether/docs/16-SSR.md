# 16. Server-Side Rendering (SSR)

> **Status**: ✅ Fully Implemented
> **Implementation Files**:
> - `src/server/server.ts` - Runtime-agnostic HTTP server (Node.js, Bun, Deno)
> - `src/server/renderer.ts` - SSR rendering engine with JSX-to-HTML conversion
> - `src/server/types.ts` - Type definitions for server configuration
> **Last Updated**: 2025-10-07

---

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Built-in Server](#built-in-server)
- [Basic SSR](#basic-ssr)
- [Streaming SSR](#streaming-ssr)
- [Server Components](#server-components)
- [Selective Hydration](#selective-hydration)
- [Data Fetching](#data-fetching)
- [Backend Integration](#backend-integration)
- [SSR + Islands + SSG Integration](#ssr-islands-ssg-integration)
- [Error Handling](#error-handling)
- [Caching](#caching)
- [Performance](#performance)
- [SEO](#seo)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)

---

## Overview

Aether provides **first-class server-side rendering** with a **built-in high-performance web server** optimized for all runtimes (Node.js, Bun, Deno).

### Key Features

- ✅ **Self-Contained**: Built-in HTTP server, no external dependencies
- ⚡ **Runtime Agnostic**: Works on Node.js 22+, Bun 1.2+, Deno 2.0+
- 🌊 **Streaming SSR**: Stream HTML as it's generated
- 🎯 **Selective Hydration**: Only hydrate interactive components
- 🧩 **Server Components**: Zero-JS server-only components
- 📦 **Automatic Code Splitting**: Per-route and per-component
- 🔗 **Integrated Router**: Works seamlessly with Aether router
- 🎨 **Integrated DI**: Uses Aether's own dependency injection
- 🔌 **Optional Backend**: Works standalone or with Titan via Netron RPC

### Why SSR?

**Benefits**:
- ⚡ Faster First Contentful Paint (FCP)
- 🔍 Better SEO (search engines see full HTML)
- 🚀 Improved perceived performance
- 📱 Works on slow networks/devices
- ♿ Better accessibility (works without JS)

---

## Philosophy

### Self-Contained by Design

Aether is a **complete frontend framework** with built-in SSR capabilities:

```typescript
// No external server needed
import { createApp } from '@omnitron-dev/aether/server';
import { routes } from './routes';

const app = createApp({
  routes,
  port: 3000
});

await app.listen();
// ✨ SSR server running on port 3000
```

**Not dependent on**:
- ❌ Titan (backend framework)
- ❌ Express/Fastify/Hono
- ❌ External HTTP frameworks

**Built on**:
- ✅ Native Web APIs (Request/Response)
- ✅ Runtime-agnostic HTTP server
- ✅ Aether's own DI and router

### Runtime Agnostic

One codebase, all runtimes:

```typescript
// Works identically on Node.js, Bun, Deno
import { createApp } from '@omnitron-dev/aether/server';

const app = createApp({ routes });
await app.listen({ port: 3000 });

// Node.js: Uses native http module
// Bun: Uses Bun.serve()
// Deno: Uses Deno.serve()
```

### Progressive Enhancement

Start with server-rendered HTML, enhance with JavaScript:

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
```

---

## Built-in Server

### Creating the Server

```typescript
// server.ts
import { createApp } from '@omnitron-dev/aether/server';
import { routes } from './routes';

const app = createApp({
  routes,
  port: 3000,

  // Optional: Custom error handler
  onError: (error, request) => {
    console.error('Server error:', error);
    return new Response('Internal Server Error', { status: 500 });
  },

  // Optional: Request middleware
  middleware: [
    async (request, next) => {
      console.log(`${request.method} ${request.url}`);
      return next();
    }
  ]
});

await app.listen();
```

### Server Configuration

```typescript
interface AppConfig {
  // Routes configuration
  routes: RouteDefinition[];

  // Server options
  port?: number;
  hostname?: string;

  // SSL/TLS (for https)
  cert?: string;
  key?: string;

  // Static files
  static?: {
    dir: string;
    prefix?: string;
    maxAge?: number;
  };

  // Middleware
  middleware?: Middleware[];

  // Error handling
  onError?: (error: Error, request: Request) => Response | Promise<Response>;

  // Development mode
  dev?: boolean;
}
```

### Static Files

```typescript
const app = createApp({
  routes,
  static: {
    dir: './public',
    prefix: '/static',
    maxAge: 3600 // 1 hour cache
  }
});

// Files in ./public are served at /static/*
// /public/logo.png → http://localhost:3000/static/logo.png
```

### Middleware

```typescript
import { createApp, type Middleware } from '@omnitron-dev/aether/server';

const logger: Middleware = async (request, next) => {
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;

  console.log(`${request.method} ${request.url} - ${duration}ms`);
  return response;
};

const cors: Middleware = async (request, next) => {
  const response = await next();

  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

  return response;
};

const app = createApp({
  routes,
  middleware: [logger, cors]
});
```

### Runtime Detection

```typescript
// Automatic runtime detection
import { getRuntime } from '@omnitron-dev/aether/server';

const runtime = getRuntime();
// 'node' | 'bun' | 'deno'

// Runtime-specific optimizations automatically applied
const app = createApp({ routes });
// Node: Uses http.createServer
// Bun: Uses Bun.serve (fastest)
// Deno: Uses Deno.serve
```

---

## Basic SSR

### Rendering a Route

```typescript
// routes/index.tsx
import { defineRoute } from '@omnitron-dev/aether/router';

export default defineRoute({
  component: defineComponent(() => {
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
  })
});

// Server automatically renders to HTML:
// <!DOCTYPE html>
// <html>
//   <head><title>My App</title></head>
//   <body><h1>Hello World</h1></body>
// </html>
```

### Rendering with Data

```typescript
// routes/users/index.tsx
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
          {data().users.map(user => (
            <li key={user.id}>{user.name}</li>
          ))}
        </ul>
      </div>
    );
  })
});

// Server flow:
// 1. Request: GET /users
// 2. Execute loader()
// 3. Render component with data
// 4. Return HTML
```

### Server Entry Point

```typescript
// server.ts
import { createApp, renderToString } from '@omnitron-dev/aether/server';
import { routes } from './routes';

// Simple setup (recommended)
const app = createApp({ routes });
await app.listen({ port: 3000 });

// Advanced setup (custom handler)
const app = createApp({
  routes,
  handler: async (request, context) => {
    const html = await renderToString(context.route.component, {
      url: request.url,
      data: context.loaderData
    });

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
});
```

---

## Streaming SSR

### Basic Streaming

```typescript
import { renderToStream } from '@omnitron-dev/aether/server';

export default defineRoute({
  handler: async (request) => {
    const stream = renderToStream(<App />, {
      url: request.url
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
});
```

### Suspense Boundaries

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
  const users = resource(() => api.fetchUsers());

  return () => (
    <ul>
      {users().map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
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
<template id="B:0-c">
  <ul><li>Alice</li><li>Bob</li></ul>
</template>
<script>$RC('B:0','B:0-c')</script>
```

### Progressive Hydration

Hydrate components progressively based on priority:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      {/* Critical: Hydrate immediately */}
      <SearchBar />

      {/* Less critical: Hydrate when idle */}
      <RecommendedProducts hydrate="idle" />

      {/* Below fold: Hydrate when visible */}
      <Comments hydrate="visible" />
    </div>
  );
});

// Hydration order:
// 1. SearchBar (0ms - immediate)
// 2. RecommendedProducts (~100ms - when browser idle)
// 3. Comments (when scrolled into view)
```

---

## Server Components

### Pure Server Components

Components that run **only on the server**, never hydrate:

```typescript
import { serverOnly } from '@omnitron-dev/aether/server';

// This component NEVER ships JavaScript to client
export const ServerStats = serverOnly(defineComponent(async () => {
  // Direct database access (server-only)
  const stats = await db.stats.aggregate({
    _count: true,
    _sum: { views: true }
  });

  return () => (
    <div class="stats">
      <p>Total Posts: {stats._count}</p>
      <p>Total Views: {stats._sum.views}</p>
    </div>
  );
}));

// Usage
<ServerStats /> {/* Renders to static HTML, 0 KB JavaScript */}
```

**Benefits**:
- ✅ **Zero JavaScript**: No hydration, no client bundle
- ✅ **Direct DB Access**: Query database directly
- ✅ **Secret Access**: Use API keys, secrets safely
- ✅ **Heavy Dependencies**: Use server-only packages

### Client Components (Islands)

Components that hydrate on client:

```typescript
import { clientOnly } from '@omnitron-dev/aether';

// This component ONLY runs on client
export const ClientWidget = clientOnly(defineComponent(() => {
  const data = signal(null);

  onMount(async () => {
    // Browser APIs
    data.set(localStorage.getItem('widget-data'));
  });

  return () => <div>{data()}</div>;
}));

// Server: Renders placeholder
// Client: Hydrates with actual component
```

### Hybrid Components

Components that work on both server and client:

```typescript
export const SmartComponent = defineComponent(() => {
  // Server-only code
  if (import.meta.env.SSR) {
    const dbData = await db.getData();
    return () => <div>{dbData.value}</div>;
  }

  // Client-side code
  const data = resource(() => api.getData());

  return () => (
    <div>
      {data.loading() ? <Spinner /> : <div>{data().value}</div>}
    </div>
  );
});
```

### Server/Client Composition

Mix server and client components:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      {/* Server Component (0 KB JS) */}
      <ServerHeader />

      <main>
        {/* Server Component (0 KB JS) */}
        <ArticleContent />

        {/* Client Component / Island (~5 KB JS) */}
        <LikeButton />

        {/* Server Component (0 KB JS) */}
        <RelatedArticles />

        {/* Client Component / Island (~8 KB JS) */}
        <CommentSection hydrate="visible" />
      </main>

      {/* Server Component (0 KB JS) */}
      <ServerFooter />
    </div>
  );
});

// Total JavaScript: ~13 KB (only interactive parts)
// vs Traditional SPA: ~100+ KB (everything)
```

### Server Actions

Execute code on server from client:

```typescript
// actions/user.ts
'use server';

export async function updateProfile(userId: string, data: ProfileData) {
  // Runs only on server
  const result = await db.users.update({
    where: { id: userId },
    data
  });

  return result;
}

// Component (client)
import { updateProfile } from './actions/user';

export const ProfileForm = defineComponent(() => {
  const userId = signal('123');

  const handleSubmit = async (formData: FormData) => {
    const data = Object.fromEntries(formData);

    // Calls server action
    await updateProfile(userId(), data);
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
});
```

---

## Selective Hydration

> **See [17. Islands Architecture](./17-ISLANDS.md) for complete hydration strategies**

### Automatic Island Detection

Aether automatically detects which components need hydration:

```typescript
// Automatically an island (has event handler)
export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      {count()}
    </button>
  );
});

// Automatically static (no interactivity)
export const Article = defineComponent(() => {
  return () => (
    <article>
      <h1>Title</h1>
      <p>Content...</p>
    </article>
  );
});
```

**Detection criteria**:
- Event handlers (`onClick`, `onInput`, etc.)
- Reactive state (signals, stores)
- Lifecycle hooks (`onMount`, `onCleanup`)
- Browser APIs (`window`, `document`)

### Hydration Strategies

Choose when to hydrate each island:

```typescript
import { island } from '@omnitron-dev/aether/islands';

// Immediate: Hydrate right away (default)
export const SearchBar = island(defineComponent(() => {
  // ... component
}), { hydrate: 'immediate' });

// Visible: Hydrate when scrolled into view
export const Comments = island(defineComponent(() => {
  // ... component
}), { hydrate: 'visible' });

// Interaction: Hydrate on first interaction
export const ChatWidget = island(defineComponent(() => {
  // ... component
}), {
  hydrate: 'interaction',
  events: ['click', 'focus']
});

// Idle: Hydrate when browser is idle
export const Analytics = island(defineComponent(() => {
  // ... component
}), { hydrate: 'idle' });

// Media: Hydrate based on media query
export const MobileMenu = island(defineComponent(() => {
  // ... component
}), {
  hydrate: 'media',
  query: '(max-width: 768px)'
});
```

### Streaming with Islands

Stream HTML, hydrate islands selectively:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <Header /> {/* Static, streamed immediately */}

      <Suspense fallback={<div>Loading...</div>}>
        <AsyncData /> {/* Streamed when data loads */}
      </Suspense>

      <LikeButton /> {/* Island, hydrates immediately */}

      <Suspense fallback={<Skeleton />}>
        <HeavyWidget /> {/* Island, streamed + hydrated when ready */}
      </Suspense>

      <Footer /> {/* Static, streamed immediately */}
    </div>
  );
});

// HTML Stream:
// 1. <div><header>...</header><div id="B:0">Loading...</div>...
// 2. <template id="B:0-c"><data>...</data></template><script>$RC('B:0','B:0-c')</script>
// 3. <script>$H('like-button')</script> // Hydrate island
// 4. <template id="B:1-c"><widget>...</widget></template><script>$RC('B:1','B:1-c');$H('heavy-widget')</script>
```

### Islands + SSR Integration

Perfect integration between SSR and Islands:

```typescript
// Server renders everything to HTML
// Client selectively hydrates islands

export default defineComponent(() => {
  return () => (
    <html>
      <head>
        <title>My App</title>
      </head>
      <body>
        {/* 100% of page is server-rendered HTML */}
        <ServerHeader />
        <StaticNav />
        <ArticleContent />

        {/* Only these 2 components hydrate */}
        <LikeButton /> {/* Island: 2 KB JS */}
        <CommentSection /> {/* Island: 8 KB JS */}

        <StaticFooter />
      </body>
    </html>
  );
});

// Result:
// - SEO: Perfect (100% HTML)
// - Performance: Excellent (only 10 KB JS)
// - Interactivity: Full (where needed)
```

---

## Data Fetching

### Loader Pattern

```typescript
// Route loader (runs on server)
export const loader = async ({ params, request }) => {
  const user = await db.users.findUnique({
    where: { id: params.id }
  });

  if (!user) {
    throw new Response('Not Found', { status: 404 });
  }

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

### Server-Only Functions

```typescript
// api/users.server.ts
'use server';

export async function getUser(id: string) {
  // Direct database access (server-only)
  return await db.users.findUnique({ where: { id } });
}

// Component (can use in both server and client)
import { getUser } from './api/users.server';

export default defineComponent((props: { userId: string }) => {
  const user = resource(() => getUser(props.userId));

  return () => (
    <div>
      {user.loading() ? (
        <Spinner />
      ) : (
        <h1>{user().name}</h1>
      )}
    </div>
  );
});

// Server: Calls getUser directly (no RPC)
// Client: Calls via generated RPC endpoint
```

---

## Backend Integration

### Standalone Mode (Default)

Aether works completely standalone:

```typescript
// No backend required
import { createApp } from '@omnitron-dev/aether/server';
import { routes } from './routes';

const app = createApp({ routes });
await app.listen({ port: 3000 });

// ✅ Fully functional SSR app
// ✅ Built-in HTTP server
// ✅ No external dependencies
```

### With Titan Backend (Optional)

When you need a full backend, integrate with Titan via Netron RPC:

```typescript
// aether-app/server.ts
import { createApp } from '@omnitron-dev/aether/server';
import { createNetronClient } from '@omnitron-dev/netron/client';
import { routes } from './routes';

// Connect to Titan backend
const backend = createNetronClient({
  url: 'ws://localhost:4000',
  services: {
    UserService: {} // Type-safe service proxy
  }
});

const app = createApp({
  routes,
  providers: [
    // Inject backend services
    { provide: 'Backend', useValue: backend }
  ]
});

await app.listen({ port: 3000 });
```

**Component usage**:

```typescript
import { inject } from '@omnitron-dev/aether/di';

export default defineComponent(async () => {
  // Inject Titan services via Netron RPC
  const backend = inject<NetronClient>('Backend');

  const users = await backend.UserService.findAll();

  return () => (
    <ul>
      {users.map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  );
});
```

### Separation of Concerns

```
┌─────────────────────────────────────┐
│   Aether Frontend (Port 3000)      │
│   ┌─────────────────────────────┐  │
│   │  Built-in HTTP Server       │  │
│   │  - SSR/SSG                  │  │
│   │  - Routing                  │  │
│   │  - Hydration                │  │
│   │  - Static files             │  │
│   └─────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │ Optional
               │ Netron RPC
               │
┌──────────────▼──────────────────────┐
│   Titan Backend (Port 4000)        │
│   ┌─────────────────────────────┐  │
│   │  Microservices              │  │
│   │  - Business logic           │  │
│   │  - Database access          │  │
│   │  - Authentication           │  │
│   │  - Background jobs          │  │
│   └─────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Key Points**:
- Aether = Standalone frontend with SSR
- Titan = Optional backend for business logic
- Netron = Optional RPC bridge between them
- Each can be deployed independently

---

## SSR + Islands + SSG Integration

> **The Complete Picture**: How SSR, Islands, and SSG work together in Aether

### Unified Architecture

Aether provides **three rendering strategies** that work seamlessly together:

```
┌─────────────────────────────────────────────────────┐
│              Aether Framework                        │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │         Built-in HTTP Server                 │  │
│  │   (Node 22+, Bun 1.2+, Deno 2.0+)          │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │            Rendering Engine                  │  │
│  │                                              │  │
│  │  ┌────────────┐ ┌────────────┐ ┌─────────┐ │  │
│  │  │    SSR     │ │  Islands   │ │   SSG   │ │  │
│  │  │  (Dynamic) │ │ (Selective)│ │ (Static)│ │  │
│  │  └────────────┘ └────────────┘ └─────────┘ │  │
│  │       │              │              │       │  │
│  │       └──────────────┼──────────────┘       │  │
│  │                      │                      │  │
│  │              Unified Component               │  │
│  │              & Router System                │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │          Hydration System                    │  │
│  │  - Automatic island detection                │  │
│  │  - Selective hydration                       │  │
│  │  - Progressive enhancement                   │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Per-Route Strategy

Each route chooses its rendering strategy:

```typescript
// routes/
// ├── index.tsx                → SSG (Static homepage)
export const getStaticProps = async () => {
  return { props: { hero: await fetchHero() } };
};

// ├── blog/
// │   ├── index.tsx           → SSG with ISR (Blog list)
export const getStaticProps = async () => {
  return {
    props: { posts: await fetchPosts() },
    revalidate: 3600 // Revalidate every hour
  };
};

// │   └── [slug].tsx          → SSG with ISR (Blog posts)
export const getStaticPaths = async () => {
  const posts = await fetchPosts();
  return {
    paths: posts.map(p => ({ params: { slug: p.slug } })),
    fallback: 'blocking'
  };
};

export const getStaticProps = async ({ params }) => {
  return {
    props: { post: await fetchPost(params.slug) },
    revalidate: 60
  };
};

// ├── dashboard/
// │   └── index.tsx           → SSR (User-specific, dynamic)
export const loader = async ({ request }) => {
  const user = await getUserFromRequest(request);
  return { user };
};

// ├── search.tsx              → SSR + CSR Hybrid
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || '';

  // Server-side initial search
  const results = query ? await search(query) : [];

  return { initialResults: results, query };
};

// └── about.tsx               → SSG (Static page)
export const getStaticProps = async () => {
  return { props: { content: await fetchAboutPage() } };
};
```

### Islands in All Strategies

Islands work with **all rendering strategies**:

#### SSG + Islands

```typescript
// Build time: Generate static HTML
export const getStaticProps = async () => {
  const post = await fetchPost();
  return { props: { post } };
};

export default defineRoute({
  component: defineComponent<{ post: Post }>((props) => {
    return () => (
      <article>
        {/* Static content (prerendered at build time) */}
        <h1>{props.post.title}</h1>
        <div innerHTML={props.post.content} />

        {/* Island: Hydrates on client */}
        <LikeButton postId={props.post.id} />

        {/* Island: Lazy hydration when visible */}
        <CommentSection postId={props.post.id} hydrate="visible" />
      </article>
    );
  })
});

// Build output:
// - HTML: Fully prerendered (SSG)
// - JavaScript: Only islands (~10 KB)
// - Result: Static HTML + selective interactivity
```

#### SSR + Islands

```typescript
// Runtime: Render HTML per request
export const loader = async ({ request }) => {
  const user = await getUserFromRequest(request);
  const feed = await fetchUserFeed(user.id);

  return { user, feed };
};

export default defineRoute({
  component: defineComponent<{ user: User; feed: Post[] }>((props) => {
    return () => (
      <div>
        {/* Server-rendered, static on client */}
        <UserHeader user={props.user} />

        {/* Server-rendered list */}
        <ul>
          {props.feed.map(post => (
            <li key={post.id}>
              {/* Static content */}
              <h3>{post.title}</h3>
              <p>{post.excerpt}</p>

              {/* Island: Hydrates immediately */}
              <LikeButton postId={post.id} />
            </li>
          ))}
        </ul>

        {/* Island: Hydrates when visible */}
        <RecommendedPosts hydrate="visible" />
      </div>
    );
  })
});

// Server: Renders entire page to HTML (SSR)
// Client: Selectively hydrates islands
```

#### Hybrid SSG/SSR + Islands

```typescript
export const getStaticProps = async () => {
  // Static data (prerendered)
  const categories = await fetchCategories();

  return {
    props: { categories },
    revalidate: 3600
  };
};

export default defineRoute({
  component: defineComponent<{ categories: Category[] }>((props) => {
    return () => (
      <div>
        {/* Static categories (SSG) */}
        <CategoryNav categories={props.categories} />

        {/* Dynamic user content (SSR via Suspense) */}
        <Suspense fallback={<Skeleton />}>
          <UserWidget /> {/* Server-rendered per request */}
        </Suspense>

        {/* Island: Client-side search */}
        <SearchBar />

        {/* Static content (SSG) */}
        <FeaturedProducts />

        {/* Island: Hydrates when visible */}
        <NewsletterForm hydrate="visible" />
      </div>
    );
  })
});

// Build time: Prerender static parts
// Request time: Render dynamic parts (Suspense)
// Client time: Hydrate islands
```

### Progressive Enhancement Stack

The complete progressive enhancement story:

```typescript
export default defineComponent(() => {
  return () => (
    <html>
      <head>
        <title>My App</title>
        <meta name="description" content="..." />
        {/* Critical CSS inlined */}
        <style>{criticalCSS}</style>
      </head>
      <body>
        {/* Layer 1: Static HTML (SSG/SSR) - Works without JS */}
        <header>
          <h1>My Site</h1>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
          </nav>
        </header>

        <main>
          {/* Layer 2: Server-rendered content */}
          <article>
            <h2>Article Title</h2>
            <p>Server-rendered content that works without JavaScript...</p>
          </article>

          {/* Layer 3: Islands - Enhanced interactivity */}
          <LikeButton /> {/* 2 KB JS, hydrates immediately */}

          {/* Layer 4: Lazy Islands - Load on demand */}
          <CommentSection hydrate="visible" /> {/* 8 KB JS, loads when visible */}

          {/* Layer 5: Client-only enhancements */}
          <AnalyticsTracker hydrate="idle" /> {/* 3 KB JS, loads when idle */}
        </main>

        {/* Layer 1: Static footer */}
        <footer>
          <p>© 2025 My Site</p>
        </footer>

        {/* Deferred CSS */}
        <link rel="stylesheet" href="/styles.css" media="print" onload="this.media='all'" />
      </body>
    </html>
  );
});

// Progressive enhancement layers:
// 1. HTML (SSG/SSR)    → Works immediately, no JS needed
// 2. Critical CSS      → Inline, instant styling
// 3. Islands (eager)   → 2 KB JS, interactive immediately
// 4. Islands (lazy)    → 8 KB JS, loads on visibility
// 5. Islands (idle)    → 3 KB JS, loads when browser idle
// 6. Non-critical CSS  → Deferred, doesn't block render
//
// Total JavaScript: 13 KB (loaded progressively)
// vs Traditional SPA: 100+ KB (all upfront)
```

### Performance Characteristics

| Strategy | TTFB | FCP | LCP | TTI | JavaScript | SEO |
|----------|------|-----|-----|-----|------------|-----|
| **SSG** | < 100ms | < 0.5s | < 1s | < 1.5s | 0-20 KB | ★★★★★ |
| **SSG + Islands** | < 100ms | < 0.5s | < 1s | < 2s | 5-30 KB | ★★★★★ |
| **SSR** | < 300ms | < 1s | < 2s | < 3s | 10-40 KB | ★★★★★ |
| **SSR + Islands** | < 300ms | < 1s | < 2s | < 3s | 10-40 KB | ★★★★★ |
| **Traditional SPA** | < 100ms | > 2s | > 3s | > 4s | 100+ KB | ★★☆☆☆ |

### Real-World Examples

#### Content Site (Blog/News)

```typescript
// Perfect strategy: SSG + Islands + ISR

// Most pages: SSG (instant load)
// - Homepage
// - About, Contact
// - Blog posts (with ISR)

// Some pages: SSR (user-specific)
// - User dashboard
// - Search results

// All pages: Islands (selective interactivity)
// - Like buttons (~2 KB)
// - Comment sections (~8 KB, lazy)
// - Share buttons (~1 KB)
// - Newsletter forms (~3 KB, lazy)

// Result:
// - 100% SEO-friendly
// - Sub-second page loads
// - 5-15 KB JavaScript (instead of 100+ KB)
// - Perfect Lighthouse scores
```

#### E-commerce Site

```typescript
// Perfect strategy: Hybrid SSG/SSR + Islands

// Static pages: SSG
// - Homepage, category pages
// - Product pages (with ISR)
// - Help, FAQ, policies

// Dynamic pages: SSR
// - User cart, checkout
// - User account, orders
// - Search results

// Islands everywhere:
// - Add to cart button (~3 KB, interaction)
// - Product gallery (~5 KB, immediate)
// - Reviews (~8 KB, visible)
// - Related products (~10 KB, idle)

// Result:
// - Static product pages (instant load, great SEO)
// - Dynamic cart/checkout (personalized)
// - 15-25 KB JavaScript (highly optimized)
// - Fast, interactive, SEO-friendly
```

#### Dashboard Application

```typescript
// Perfect strategy: SSR + Islands + Smart Caching

// All pages: SSR (user-specific data)
// - Dashboard homepage
// - Reports, analytics
// - User settings

// Islands for interactivity:
// - Charts (~20 KB, immediate)
// - Filters (~5 KB, immediate)
// - Live updates (~8 KB, immediate)
// - Export tools (~3 KB, visible)

// Smart caching:
// - Stale-while-revalidate for data
// - Aggressive caching for assets
// - Selective cache invalidation

// Result:
// - Personalized for each user
// - Fast initial load (SSR)
// - Instant interactivity (Islands)
// - 30-50 KB JavaScript (feature-rich)
```

### Migration Path

Incrementally adopt advanced features:

```typescript
// Stage 1: Start with SSR only
export const loader = async () => {
  return { data: await fetchData() };
};

// Stage 2: Add Islands for interactivity
export default defineComponent(() => {
  return () => (
    <div>
      <StaticContent />
      <LikeButton /> {/* Island */}
    </div>
  );
});

// Stage 3: Add SSG for static pages
export const getStaticProps = async () => {
  return { props: { data: await fetchData() } };
};

// Stage 4: Add ISR for dynamic updates
export const getStaticProps = async () => {
  return {
    props: { data: await fetchData() },
    revalidate: 60 // ISR
  };
};

// Stage 5: Optimize Islands (lazy loading)
<CommentSection hydrate="visible" />
<Analytics hydrate="idle" />

// Stage 6: Add Server Components
<ServerStats /> {/* 0 KB JS */}
```

### Best Strategy Selection

Choose based on your needs:

```typescript
// Static content, rare updates → SSG
// - Blogs, documentation, marketing pages
export const getStaticProps = async () => { /* ... */ };

// Static with frequent updates → SSG + ISR
// - E-commerce products, news articles
export const getStaticProps = async () => {
  return { props: { /* ... */ }, revalidate: 60 };
};

// User-specific content → SSR
// - Dashboards, user profiles, feeds
export const loader = async ({ request }) => { /* ... */ };

// Mix of static and dynamic → SSR + Suspense
// - Homepage with user widget
export default defineComponent(() => {
  return () => (
    <div>
      <StaticHero />
      <Suspense fallback={<Skeleton />}>
        <UserWidget />
      </Suspense>
    </div>
  );
});

// Add interactivity anywhere → Islands
// - Like buttons, comments, forms
<LikeButton /> {/* Works with SSG, SSR, or CSR */}
```

---

## Best Practices

### 1. Use Built-in Server

```typescript
// ✅ Use Aether's built-in server
import { createApp } from '@omnitron-dev/aether/server';

const app = createApp({ routes });
await app.listen();

// ❌ Don't wrap in Express/Fastify
import express from 'express';
const app = express();
app.use(aetherMiddleware); // Unnecessary complexity
```

### 2. Leverage Runtime Optimizations

```typescript
// ✅ Let Aether detect runtime
const app = createApp({ routes });
// Automatically uses Bun.serve on Bun, http on Node

// ❌ Don't force specific runtime code
if (process.versions.bun) {
  // Bun-specific code
} else {
  // Node-specific code
}
```

### 3. Use Server Functions for Data

```typescript
// ✅ Server functions
'use server';
export async function getUsers() {
  return db.users.findMany();
}

// ❌ Client-side fetching in SSR components
export default defineComponent(() => {
  const users = resource(() => fetch('/api/users'));
  // Extra network hop during SSR
});
```

---

## API Reference

### createApp

```typescript
function createApp(config: AppConfig): AetherApp;

interface AppConfig {
  routes: RouteDefinition[];
  port?: number;
  hostname?: string;
  static?: { dir: string; prefix?: string; maxAge?: number };
  middleware?: Middleware[];
  providers?: Provider[]; // DI providers
  onError?: (error: Error, request: Request) => Response;
  dev?: boolean;
}
```

### renderToString

```typescript
function renderToString(
  component: Component,
  options?: {
    url?: string;
    data?: any;
    context?: any;
  }
): Promise<string>;
```

### renderToStream

```typescript
function renderToStream(
  component: Component,
  options?: {
    url?: string;
    data?: any;
    context?: any;
  }
): ReadableStream<Uint8Array>;
```

### getRuntime

```typescript
function getRuntime(): 'node' | 'bun' | 'deno';
```

---

## Future Enhancements

### Planned Features

- [ ] **Islands Architecture**: Automatic island detection
- [ ] **Resumability**: Qwik-style resumability
- [ ] **Progressive Hydration**: Viewport-based hydration
- [ ] **Edge Deployment**: Cloudflare Workers, Deno Deploy support
- [ ] **Build-time Prerendering**: Static site generation
- [ ] **Incremental Static Regeneration**: ISR support

### Not Planned

- ❌ Express/Fastify adapters (use built-in server)
- ❌ Tight coupling with Titan (keep independent)
- ❌ Framework-specific integrations (stay universal)

---

**Aether SSR is designed to be self-contained, runtime-agnostic, and optionally integrated with Titan for full-stack applications.**

**Next**: [17. Islands Architecture →](./17-ISLANDS.md)
