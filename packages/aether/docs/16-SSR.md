# 16. Server-Side Rendering (SSR)

> **Status**: Architecture Specification
> **Implementation Status**: ❌ Not Implemented
> **Last Updated**: 2025-10-06

---

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Built-in Server](#built-in-server)
- [Basic SSR](#basic-ssr)
- [Streaming SSR](#streaming-ssr)
- [Hydration](#hydration)
- [Data Fetching](#data-fetching)
- [Server Components](#server-components)
- [Selective Hydration](#selective-hydration)
- [Error Handling](#error-handling)
- [Caching](#caching)
- [Performance](#performance)
- [SEO](#seo)
- [Backend Integration](#backend-integration)
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
