# 08. Routing System

> **Status**: Complete Specification
> **Last Updated**: 2025-10-06
> **Part of**: Aether Frontend Framework Specification

---

## Table of Contents

1. [Overview](#overview)
2. [Philosophy](#philosophy)
3. [File-Based Routing](#file-based-routing)
4. [Route Parameters](#route-parameters)
5. [Nested Routes](#nested-routes)
6. [Navigation](#navigation)
7. [Data Loading](#data-loading)
8. [Route Guards](#route-guards)
9. [Layouts](#layouts)
10. [Error Pages](#error-pages)
11. [API Routes](#api-routes)
12. [Route Transitions](#route-transitions)
13. [Prefetching](#prefetching)
14. [Router API](#router-api)
15. [Comparison](#comparison)
16. [Best Practices](#best-practices)
17. [Examples](#examples)

---

## Overview

Aether uses **file-based routing** - routes are automatically generated from the file structure in your `routes/` directory. This eliminates manual route configuration and makes the routing structure immediately visible.

### Key Features

- **File-Based**: Routes defined by file structure
- **Nested Routes**: Support for nested layouts and routes
- **Dynamic Parameters**: URL parameters with TypeScript types
- **Data Loading**: Integrated loaders and actions
- **Code Splitting**: Automatic route-based code splitting
- **SSR/SSG Ready**: Works seamlessly with server rendering
- **Type-Safe**: Full TypeScript support with route types
- **Prefetching**: Automatic link prefetching
- **Transitions**: Smooth page transitions

### Basic Example

```
routes/
├── index.tsx           → /
├── about.tsx           → /about
├── blog/
│   ├── index.tsx       → /blog
│   └── [slug].tsx      → /blog/:slug
└── users/
    ├── index.tsx       → /users
    ├── [id].tsx        → /users/:id
    └── [id]/
        └── edit.tsx    → /users/:id/edit
```

---

## Philosophy

### Convention over Configuration

**Traditional Routing** (manual configuration):
```typescript
// routes.ts
export const routes = [
  { path: '/', component: Home },
  { path: '/about', component: About },
  { path: '/blog', component: Blog },
  { path: '/blog/:slug', component: BlogPost },
  { path: '/users', component: Users },
  { path: '/users/:id', component: UserProfile },
  { path: '/users/:id/edit', component: EditUser },
  // ... manual config for every route
];
```

**Aether File-Based Routing** (automatic):
```
routes/
├── index.tsx           # Just create files
├── about.tsx
├── blog/
│   ├── index.tsx
│   └── [slug].tsx
└── users/
    ├── index.tsx
    ├── [id].tsx
    └── [id]/
        └── edit.tsx
```

**Benefits**:
- No manual route configuration
- Easy to see route structure
- Automatic code splitting
- Can't forget to add routes
- Refactoring is easier (just move files)

### Type Safety

Routes are fully typed:

```typescript
import { useParams, useNavigate } from 'nexus/router';

// In routes/users/[id].tsx
const UserProfile = defineComponent(() => {
  // TypeScript knows params has 'id' property
  const params = useParams<{ id: string }>();

  const navigate = useNavigate();

  // Type-safe navigation
  navigate('/users/:id', { id: params.id });

  return () => <div>User {params.id}</div>;
});
```

### Colocation

Keep related code together:

```
routes/
└── blog/
    ├── [slug].tsx          # Route component
    ├── [slug].loader.ts    # Data loader
    ├── [slug].action.ts    # Form action
    ├── [slug].css          # Route-specific styles
    └── components/         # Route-specific components
        ├── BlogHeader.tsx
        └── BlogFooter.tsx
```

---

## File-Based Routing

### Basic Routes

File paths map to URL paths:

```
routes/
├── index.tsx           → /
├── about.tsx           → /about
├── contact.tsx         → /contact
└── pricing.tsx         → /pricing
```

**Route Component**:

```typescript
// routes/about.tsx
import { defineComponent } from 'aether';

export default defineComponent(() => {
  return () => (
    <div>
      <h1>About Us</h1>
      <p>Welcome to our about page</p>
    </div>
  );
});
```

### Nested Folders

Folders create route segments:

```
routes/
└── blog/
    ├── index.tsx       → /blog
    ├── latest.tsx      → /blog/latest
    └── archive.tsx     → /blog/archive
```

### Index Routes

`index.tsx` files render when the path exactly matches:

```
routes/
├── index.tsx           → /
└── blog/
    ├── index.tsx       → /blog (exact match)
    └── [slug].tsx      → /blog/post-1 (any other path)
```

### File Naming Conventions

```
routes/
├── _layout.tsx         # Layout (not a route)
├── _component.tsx      # Component (not a route)
├── index.tsx           # Index route
├── about.tsx           # Static route
├── [id].tsx            # Dynamic route
├── [...rest].tsx       # Catch-all route
└── (group)/            # Route group (not in URL)
    └── page.tsx
```

### Route Groups

Organize routes without affecting URL:

```
routes/
├── (marketing)/        # Group name not in URL
│   ├── index.tsx       → /
│   ├── about.tsx       → /about
│   └── pricing.tsx     → /pricing
└── (app)/              # Another group
    ├── dashboard.tsx   → /dashboard
    └── settings.tsx    → /settings
```

**Use for**:
- Shared layouts
- Code organization
- Different loading strategies

---

## Route Parameters

### Dynamic Segments

Use `[param]` for dynamic route segments:

```
routes/
└── users/
    └── [id].tsx        → /users/123, /users/alice, etc.
```

**Access Parameters**:

```typescript
// routes/users/[id].tsx
import { useParams } from 'nexus/router';

export default defineComponent(() => {
  const params = useParams<{ id: string }>();

  return () => <div>User ID: {params.id}</div>;
});
```

### Multiple Parameters

```
routes/
└── posts/
    └── [category]/
        └── [slug].tsx  → /posts/tech/intro-to-nexus
```

```typescript
// routes/posts/[category]/[slug].tsx
const params = useParams<{ category: string; slug: string }>();

// URL: /posts/tech/intro-to-nexus
// params.category = 'tech'
// params.slug = 'intro-to-nexus'
```

### Optional Parameters

Use `[[param]]` for optional segments:

```
routes/
└── blog/
    └── [[page]].tsx    → /blog or /blog/2
```

```typescript
// routes/blog/[[page]].tsx
const params = useParams<{ page?: string }>();

const currentPage = computed(() => {
  return parseInt(params.page || '1', 10);
});
```

### Catch-All Routes

Use `[...rest]` to match remaining path segments:

```
routes/
└── docs/
    └── [...path].tsx   → /docs/a, /docs/a/b, /docs/a/b/c, etc.
```

```typescript
// routes/docs/[...path].tsx
const params = useParams<{ path: string[] }>();

// URL: /docs/guide/getting-started
// params.path = ['guide', 'getting-started']
```

### Optional Catch-All

Use `[[...rest]]` for optional catch-all:

```
routes/
└── shop/
    └── [[...categories]].tsx  → /shop, /shop/electronics, /shop/electronics/phones
```

```typescript
const params = useParams<{ categories?: string[] }>();

// URL: /shop
// params.categories = undefined

// URL: /shop/electronics/phones
// params.categories = ['electronics', 'phones']
```

### Parameter Validation

```typescript
// routes/users/[id].tsx
import { defineRoute } from 'nexus/router';

export default defineRoute({
  // Validate params before rendering
  beforeEnter: ({ params }) => {
    // Ensure id is a number
    if (!/^\d+$/.test(params.id)) {
      return { redirect: '/404' };
    }
  },

  component: defineComponent(() => {
    const params = useParams<{ id: string }>();
    const userId = computed(() => parseInt(params.id, 10));

    return () => <div>User {userId()}</div>;
  })
});
```

---

## Nested Routes

### Layout Nesting

Nested routes share parent layouts:

```
routes/
├── _layout.tsx         # Root layout
└── dashboard/
    ├── _layout.tsx     # Dashboard layout
    ├── index.tsx       # /dashboard
    ├── stats.tsx       # /dashboard/stats
    └── settings.tsx    # /dashboard/settings
```

**Root Layout** (`routes/_layout.tsx`):

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <header>Site Header</header>
      <Outlet /> {/* Child routes render here */}
      <footer>Site Footer</footer>
    </div>
  );
});
```

**Dashboard Layout** (`routes/dashboard/_layout.tsx`):

```typescript
export default defineComponent(() => {
  return () => (
    <div class="dashboard">
      <aside>Dashboard Sidebar</aside>
      <main>
        <Outlet /> {/* Dashboard child routes */}
      </main>
    </div>
  );
});
```

**Result**:
```
<RootLayout>          {/* _layout.tsx */}
  <header>...</header>

  <DashboardLayout>   {/* dashboard/_layout.tsx */}
    <aside>...</aside>
    <main>
      <StatsPage />   {/* dashboard/stats.tsx */}
    </main>
  </DashboardLayout>

  <footer>...</footer>
</RootLayout>
```

### Outlet Component

`<Outlet />` renders child routes:

```typescript
import { Outlet } from 'nexus/router';

const Layout = defineComponent(() => {
  return () => (
    <div>
      <nav>Navigation</nav>
      <Outlet /> {/* Child route renders here */}
    </div>
  );
});
```

### Passing Context to Children

```typescript
import { Outlet, provideContext } from 'nexus/router';

const DashboardLayout = defineComponent(() => {
  const user = signal(/* ... */

  // Provide context to all child routes
  provideContext(UserContext, user);

  return () => (
    <div>
      <header>Welcome, {user().name}</header>
      <Outlet />
    </div>
  );
});

// Child routes can access context
const SettingsPage = defineComponent(() => {
  const user = injectContext(UserContext);

  return () => <div>Settings for {user().name}</div>;
});
```

### Layout Groups

Different layouts for different sections:

```
routes/
├── (marketing)/
│   ├── _layout.tsx     # Marketing layout
│   ├── index.tsx
│   └── about.tsx
└── (app)/
    ├── _layout.tsx     # App layout
    ├── dashboard.tsx
    └── settings.tsx
```

---

## Navigation

### Link Component

```typescript
import { Link } from 'nexus/router';

<Link href="/about">About</Link>

<Link href="/users/123">User Profile</Link>

<Link href="/blog/post-1" prefetch>
  Blog Post (prefetched)
</Link>

<Link href="/external" external>
  External Link
</Link>
```

### Link Props

```typescript
<Link
  href="/dashboard"
  activeClass="active"      // Class when route is active
  exactActiveClass="exact"  // Class when exact match
  prefetch={true}           // Prefetch on hover
  replace={false}           // Use history.replace instead of push
  scroll={true}             // Scroll to top on navigation
  state={{ from: 'home' }}  // Pass state to route
>
  Dashboard
</Link>
```

### Programmatic Navigation

```typescript
import { useNavigate } from 'nexus/router';

const Component = defineComponent(() => {
  const navigate = useNavigate();

  const goToProfile = () => {
    navigate('/users/123');
  };

  const goBack = () => {
    navigate(-1); // Go back one page
  };

  const replaceRoute = () => {
    navigate('/new-route', { replace: true });
  };

  const navigateWithState = () => {
    navigate('/dashboard', { state: { from: 'home' } });
  };

  return () => (
    <div>
      <button on:click={goToProfile}>View Profile</button>
      <button on:click={goBack}>Go Back</button>
    </div>
  );
});
```

### Type-Safe Navigation

```typescript
// Define route types
type Routes = {
  '/': {};
  '/users/:id': { id: string };
  '/posts/:category/:slug': { category: string; slug: string };
};

const navigate = useNavigate<Routes>();

// ✅ Type-safe
navigate('/users/:id', { id: '123' });

// ❌ TypeScript error: missing parameter
navigate('/users/:id');

// ❌ TypeScript error: wrong route
navigate('/invalid');
```

### Navigation Guards

```typescript
import { useRouter } from 'nexus/router';

const App = defineComponent(() => {
  const router = useRouter();

  // Global navigation guard
  router.beforeEach((to, from, next) => {
    // Check authentication
    if (to.meta.requiresAuth && !isLoggedIn()) {
      next('/login');
    } else {
      next();
    }
  });

  return () => <RouterView />;
});
```

### Redirects

```typescript
// In route component
import { redirect } from 'nexus/router';

export const loader = async () => {
  const user = await getUser();

  if (!user) {
    throw redirect('/login');
  }

  return user;
};

// Or programmatic
const navigate = useNavigate();
navigate('/login', { replace: true });
```

---

## Data Loading

### Route Loaders

Load data before rendering route:

```typescript
// routes/users/[id].tsx
import { defineRoute, useLoaderData } from 'nexus/router';

interface User {
  id: number;
  name: string;
  email: string;
}

export const loader = async ({ params }: { params: { id: string } }) => {
  const user = await fetch(`/api/users/${params.id}`).then(r => r.json());
  return user as User;
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
```

### Loading States

```typescript
import { useLoaderData, useNavigation } from 'nexus/router';

const Component = defineComponent(() => {
  const user = useLoaderData<User>();
  const navigation = useNavigation();

  return () => (
    <div>
      {#if navigation.state === 'loading'}
        <Spinner />
      {:else}
        <UserProfile user={user()} />
      {/if}
    </div>
  );
});
```

### Parallel Data Loading

```typescript
// Load multiple resources in parallel
export const loader = async ({ params }) => {
  const [user, posts, comments] = await Promise.all([
    fetchUser(params.id),
    fetchUserPosts(params.id),
    fetchUserComments(params.id)
  ]);

  return { user, posts, comments };
};
```

### Deferred Loading

```typescript
import { defer, Await } from 'nexus/router';

export const loader = async () => {
  // Load critical data immediately
  const user = await fetchUser();

  // Defer non-critical data
  const posts = fetchPosts(); // Don't await

  return defer({ user, posts });
};

export default defineComponent(() => {
  const data = useLoaderData();

  return () => (
    <div>
      {/* Renders immediately */}
      <h1>{data().user.name}</h1>

      {/* Renders when promise resolves */}
      <Suspense fallback={<Spinner />}>
        <Await resolve={data().posts}>
          {(posts) => <PostList posts={posts} />}
        </Await>
      </Suspense>
    </div>
  );
});
```

---

## Route Guards

### Authentication Guard

```typescript
// routes/dashboard/_layout.tsx
export const beforeEnter = async ({ params, query }) => {
  const user = await getCurrentUser();

  if (!user) {
    return { redirect: '/login' };
  }

  return { user }; // Available in loader
};

export const loader = async ({ user }) => {
  // user is guaranteed to exist here
  return { stats: await fetchDashboardStats(user.id) };
};
```

### Permission Guard

```typescript
export const beforeEnter = async () => {
  const user = await getCurrentUser();

  if (!user.isAdmin) {
    return { redirect: '/forbidden', status: 403 };
  }
};
```

### Route Meta

```typescript
// routes/admin/users.tsx
export const meta = {
  requiresAuth: true,
  requiresAdmin: true,
  title: 'User Management'
};

// Global guard
router.beforeEach((to, from, next) => {
  if (to.meta.requiresAdmin && !isAdmin()) {
    next('/forbidden');
  } else {
    next();
  }
});
```

---

## Layouts

### Shared Layouts

```
routes/
├── _layout.tsx              # Root layout (all pages)
└── (app)/
    ├── _layout.tsx          # App layout
    ├── dashboard.tsx
    └── settings.tsx
```

**Root Layout**:

```typescript
// routes/_layout.tsx
import { Outlet } from 'nexus/router';

export default defineComponent(() => {
  return () => (
    <html>
      <head>
        <title>My App</title>
      </head>
      <body>
        <Outlet />
      </body>
    </html>
  );
});
```

**App Layout**:

```typescript
// routes/(app)/_layout.tsx
export default defineComponent(() => {
  return () => (
    <div class="app-layout">
      <Sidebar />
      <main>
        <Outlet />
      </main>
    </div>
  );
});
```

### Layout Loading States

```typescript
// routes/(app)/_layout.tsx
import { useNavigation } from 'nexus/router';

export default defineComponent(() => {
  const navigation = useNavigation();

  return () => (
    <div class="app-layout">
      <Sidebar />
      <main>
        {#if navigation.state === 'loading'}
          <TopLoadingBar />
        {/if}
        <Outlet />
      </main>
    </div>
  );
});
```

---

## Error Pages

### 404 Not Found

```typescript
// routes/404.tsx
export default defineComponent(() => {
  return () => (
    <div class="error-page">
      <h1>404</h1>
      <p>Page not found</p>
      <Link href="/">Go Home</Link>
    </div>
  );
});
```

### Error Boundaries

```typescript
// routes/_error.tsx
import { useRouteError } from 'nexus/router';

export default defineComponent(() => {
  const error = useRouteError();

  return () => (
    <div class="error-page">
      <h1>Oops!</h1>
      <p>{error().message}</p>
      <pre>{error().stack}</pre>
    </div>
  );
});
```

### Nested Error Boundaries

```
routes/
├── _error.tsx           # Root error boundary
└── dashboard/
    ├── _error.tsx       # Dashboard error boundary
    └── stats.tsx
```

Errors bubble up to nearest error boundary.

---

## API Routes

### Creating API Routes

```
routes/
└── api/
    ├── users.ts         → /api/users
    ├── users/
    │   └── [id].ts      → /api/users/:id
    └── posts/
        └── [slug].ts    → /api/posts/:slug
```

**API Route**:

```typescript
// routes/api/users.ts
import { defineAPIRoute } from 'nexus/router';

export default defineAPIRoute({
  GET: async ({ request, url }) => {
    const users = await db.users.findMany();
    return Response.json(users);
  },

  POST: async ({ request }) => {
    const body = await request.json();
    const user = await db.users.create({ data: body });
    return Response.json(user, { status: 201 });
  }
});
```

### Dynamic API Routes

```typescript
// routes/api/users/[id].ts
export default defineAPIRoute({
  GET: async ({ params }) => {
    const user = await db.users.findUnique({
      where: { id: params.id }
    });

    if (!user) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return Response.json(user);
  },

  PATCH: async ({ params, request }) => {
    const body = await request.json();
    const user = await db.users.update({
      where: { id: params.id },
      data: body
    });

    return Response.json(user);
  },

  DELETE: async ({ params }) => {
    await db.users.delete({ where: { id: params.id } });
    return new Response(null, { status: 204 });
  }
});
```

### Middleware

```typescript
// routes/api/_middleware.ts
export default defineMiddleware({
  async handler({ request, next }) {
    // CORS headers
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Authentication
    const token = request.headers.get('Authorization');
    if (!token) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return next();
  }
});
```

---

## Route Transitions

### Page Transitions

```typescript
// routes/_layout.tsx
import { useLocation } from 'nexus/router';

export default defineComponent(() => {
  const location = useLocation();

  return () => (
    <div>
      <PageTransition key={location().pathname}>
        <Outlet />
      </PageTransition>
    </div>
  );
});
```

**PageTransition Component**:

```typescript
const PageTransition = defineComponent<{ key: string }>((props) => {
  return () => (
    <div
      key={props.key}
      in:fly={{ y: 20, duration: 300 }}
      out:fade={{ duration: 200 }}
    >
      <slot />
    </div>
  );
});
```

### View Transitions API

```typescript
// Experimental: Use View Transitions API
import { useNavigate } from 'nexus/router';

const navigate = useNavigate();

const navigateWithTransition = async (href: string) => {
  if (!document.startViewTransition) {
    navigate(href);
    return;
  }

  await document.startViewTransition(() => {
    navigate(href);
  }).finished;
};

<button on:click={() => navigateWithTransition('/about')}>
  About (with transition)
</button>
```

---

## Prefetching

### Automatic Prefetching

```typescript
// Prefetch on hover (default)
<Link href="/about" prefetch>About</Link>

// Prefetch on viewport enter
<Link href="/blog" prefetch="viewport">Blog</Link>

// Prefetch immediately
<Link href="/dashboard" prefetch="render">Dashboard</Link>

// No prefetch
<Link href="/contact" prefetch={false}>Contact</Link>
```

### Manual Prefetching

```typescript
import { usePrefetch } from 'nexus/router';

const Component = defineComponent(() => {
  const prefetch = usePrefetch();

  const handleMouseEnter = () => {
    prefetch('/dashboard');
  };

  return () => (
    <div on:mouseenter={handleMouseEnter}>
      Hover to prefetch dashboard
    </div>
  );
});
```

### Prefetch Strategies

```typescript
// Prefetch specific resources
prefetch('/dashboard', {
  strategy: 'component', // Only prefetch component
});

prefetch('/users/123', {
  strategy: 'data', // Only prefetch data
});

prefetch('/about', {
  strategy: 'all', // Prefetch everything (default)
});
```

---

## Router API

### useRouter

```typescript
import { useRouter } from 'nexus/router';

const Component = defineComponent(() => {
  const router = useRouter();

  // Current route
  console.log(router.currentRoute());

  // Navigate
  router.push('/about');
  router.replace('/home');
  router.back();
  router.forward();

  // Guards
  router.beforeEach((to, from, next) => { next(); });
  router.afterEach((to, from) => { /* ... */ });

  return () => <div>Content</div>;
});
```

### useLocation

```typescript
import { useLocation } from 'nexus/router';

const location = useLocation();

// Current pathname
console.log(location().pathname); // '/users/123'

// Search params
console.log(location().search); // '?page=2'

// Hash
console.log(location().hash); // '#section'

// Full URL
console.log(location().href);
```

### useParams

```typescript
import { useParams } from 'nexus/router';

// In routes/users/[id].tsx
const params = useParams<{ id: string }>();

console.log(params.id); // '123'
```

### useSearchParams

```typescript
import { useSearchParams } from 'nexus/router';

const [searchParams, setSearchParams] = useSearchParams();

// Read
const page = computed(() => searchParams().get('page') || '1');

// Update
setSearchParams({ page: '2', sort: 'name' });

// In template
<select
  value={searchParams().get('sort')}
  on:change={(e) => setSearchParams({ sort: e.target.value })}
>
  <option value="name">Name</option>
  <option value="date">Date</option>
</select>
```

### useNavigate

```typescript
import { useNavigate } from 'nexus/router';

const navigate = useNavigate();

// Navigate to route
navigate('/about');

// With options
navigate('/users/123', {
  replace: true,
  state: { from: 'home' },
  scroll: false
});

// Go back/forward
navigate(-1); // Back
navigate(1);  // Forward
navigate(-2); // Back 2 pages
```

---

## Comparison

### vs Next.js

| Feature | Next.js | Aether |
|---------|---------|-------|
| **Routing** | File-based (Pages Router) | File-based |
| **Dynamic Routes** | `[id].js` | `[id].tsx` |
| **Nested Routes** | Limited | Full support |
| **Layouts** | `_app.js` | `_layout.tsx` (nested) |
| **API Routes** | `/api/*` | `/api/*` |
| **Data Loading** | `getServerSideProps` | `loader` function |
| **SSR** | Yes | Yes |

### vs Remix

| Feature | Remix | Aether |
|---------|-------|-------|
| **Routing** | File-based | File-based (similar) |
| **Data Loading** | `loader` | `loader` (similar) |
| **Actions** | `action` | `action` (similar) |
| **Nested Routes** | Yes | Yes |
| **Error Boundaries** | Yes | Yes |

Aether routing is heavily inspired by Remix but integrated with Aether reactivity.

### vs SvelteKit

| Feature | SvelteKit | Aether |
|---------|-----------|-------|
| **Routing** | File-based | File-based (similar) |
| **Layouts** | `+layout.svelte` | `_layout.tsx` |
| **Pages** | `+page.svelte` | `index.tsx` |
| **Data Loading** | `+page.ts` (load) | `loader` |
| **API Routes** | `+server.ts` | `*.ts` in `/api` |

---

## Best Practices

### 1. Colocate Related Files

```
routes/
└── users/
    ├── [id].tsx           # Route component
    ├── [id].loader.ts     # Data loader
    ├── [id].css           # Styles
    └── components/        # Route-specific components
        └── UserCard.tsx
```

### 2. Use Layouts for Shared UI

```typescript
// ❌ Bad - duplicate header/footer
// routes/about.tsx
<div>
  <Header />
  <AboutContent />
  <Footer />
</div>

// routes/contact.tsx
<div>
  <Header />
  <ContactContent />
  <Footer />
</div>

// ✅ Good - shared layout
// routes/_layout.tsx
<div>
  <Header />
  <Outlet />
  <Footer />
</div>
```

### 3. Prefetch Important Routes

```typescript
// Prefetch on hover
<Link href="/dashboard" prefetch>Dashboard</Link>

// Prefetch immediately for critical routes
<Link href="/checkout" prefetch="render">Checkout</Link>
```

### 4. Type Your Routes

```typescript
// ✅ Type params
const params = useParams<{ id: string }>();

// ✅ Type loader data
export const loader = async (): Promise<User> => {
  return fetchUser();
};

const user = useLoaderData<User>();
```

### 5. Handle Loading and Error States

```typescript
export default defineComponent(() => {
  const data = useLoaderData<Data>();
  const navigation = useNavigation();

  return () => (
    <div>
      {#if navigation.state === 'loading'}
        <Spinner />
      {:else if data.error}
        <ErrorMessage error={data.error} />
      {:else}
        <Content data={data()} />
      {/if}
    </div>
  );
});
```

---

## Examples

### Complete Blog Example

```
routes/
├── _layout.tsx
├── index.tsx
└── blog/
    ├── _layout.tsx
    ├── index.tsx
    ├── [slug].tsx
    └── [slug].loader.ts
```

**Root Layout**:

```typescript
// routes/_layout.tsx
export default defineComponent(() => {
  return () => (
    <html>
      <head>
        <title>My Blog</title>
      </head>
      <body>
        <Header />
        <Outlet />
        <Footer />
      </body>
    </html>
  );
});
```

**Blog Layout**:

```typescript
// routes/blog/_layout.tsx
export default defineComponent(() => {
  return () => (
    <div class="blog-layout">
      <aside>
        <BlogSidebar />
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
});
```

**Blog Index**:

```typescript
// routes/blog/index.tsx
export const loader = async () => {
  const posts = await fetchPosts();
  return posts;
};

export default defineComponent(() => {
  const posts = useLoaderData<Post[]>();

  return () => (
    <div class="blog-index">
      <h1>Blog Posts</h1>
      <ul>
        {#each posts() as post}
          <li>
            <Link href={`/blog/${post.slug}`} prefetch>
              <h2>{post.title}</h2>
              <p>{post.excerpt}</p>
            </Link>
          </li>
        {/each}
      </ul>
    </div>
  );
});
```

**Blog Post**:

```typescript
// routes/blog/[slug].tsx
interface BlogPost {
  title: string;
  content: string;
  author: string;
  publishedAt: string;
}

export const loader = async ({ params }: { params: { slug: string } }) => {
  const post = await fetchPost(params.slug);

  if (!post) {
    throw new Response('Not Found', { status: 404 });
  }

  return post as BlogPost;
};

export default defineComponent(() => {
  const post = useLoaderData<BlogPost>();

  return () => (
    <article class="blog-post">
      <h1>{post().title}</h1>
      <div class="meta">
        <span>By {post().author}</span>
        <time>{formatDate(post().publishedAt)}</time>
      </div>
      <div innerHTML={post().content} />
    </article>
  );
});
```

---

**End of Routing Specification**