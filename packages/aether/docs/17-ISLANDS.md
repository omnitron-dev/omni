# 17. Islands Architecture

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Island Boundaries](#island-boundaries)
- [Hydration Strategies](#hydration-strategies)
- [Static vs Interactive](#static-vs-interactive)
- [Partial Hydration](#partial-hydration)
- [Island Communication](#island-communication)
- [Performance](#performance)
- [SEO](#seo)
- [Best Practices](#best-practices)
- [Comparisons](#comparisons)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Aether implements **Islands Architecture** - a pattern where:

- 🏝️ **Islands of interactivity** in a sea of static HTML
- ⚡ **Minimal JavaScript** sent to the client
- 🎯 **Selective hydration** - only interactive components hydrate
- 📦 **Automatic detection** - Aether detects islands automatically
- 🚀 **Better performance** - less JS = faster pages

### What are Islands?

**Islands** are interactive components surrounded by static content:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      {/* Static (no JS) */}
      <header>
        <h1>My Blog</h1>
        <nav>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </nav>
      </header>

      {/* Island 1: Interactive search */}
      <SearchBar />

      {/* Static content */}
      <article>
        <h2>Article Title</h2>
        <p>Lorem ipsum dolor sit amet...</p>
      </article>

      {/* Island 2: Interactive comments */}
      <CommentSection />

      {/* Static footer */}
      <footer>
        <p>© 2024 My Blog</p>
      </footer>
    </div>
  );
});

// Result:
// - Header, article, footer: Static HTML (0 KB JS)
// - SearchBar: ~5 KB JS
// - CommentSection: ~8 KB JS
// Total: 13 KB JS (vs 100+ KB for full hydration)
```

### Benefits

| **Traditional SPA** | **Islands** |
|---------------------|-------------|
| Hydrate entire page | Hydrate only interactive parts |
| 100+ KB JavaScript | 10-20 KB JavaScript |
| High Time to Interactive (TTI) | Low TTI |
| All components = interactive | Most content = static |

### Quick Example

```typescript
import { island } from 'nexus/islands';

// Static component (no hydration)
export const StaticHeader = defineComponent(() => {
  return () => (
    <header>
      <h1>My Site</h1>
    </header>
  );
});

// Island (hydrates)
export const SearchBar = island(defineComponent(() => {
  const query = signal('')

  return () => (
    <input
      value={query()}
      onInput={e => query.set(e.target.value)}
      placeholder="Search..."
    />
  );
}));

// Usage
<div>
  <StaticHeader /> {/* No JS */}
  <SearchBar /> {/* ~5 KB JS */}
</div>
```

## Philosophy

### JavaScript as Enhancement

**Start with HTML, add JavaScript only where needed**:

```typescript
// ✅ Progressive enhancement
export default defineComponent(() => {
  return () => (
    <div>
      {/* Works without JS */}
      <a href="/products">View Products</a>

      {/* Enhanced with JS */}
      <ProductSearch />
    </div>
  );
});

// ❌ Requires JS for everything
export default defineComponent(() => {
  const products = signal([]);

  onMount(async () => {
    products.set(await api.fetchProducts());
  });

  return () => (
    <div>
      {#each products() as product}
        <a href={`/products/${product.id}`}>{product.name}</a>
      {/each}
    </div>
  );
});
```

### Automatic Island Detection

Aether **automatically detects** islands:

```typescript
// Automatic island (has event handler)
export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      {count()}
    </button>
  );
});

// Static (no event handlers, no signals)
export const StaticText = defineComponent(() => {
  return () => <p>Static text</p>;
});
```

**Detection criteria**:
- Has event handlers (`onClick`, `onInput`, etc.)
- Has reactive state (signals, stores)
- Has lifecycle hooks (`onMount`, `onCleanup`)
- Uses browser APIs (`window`, `document`)

### Minimal JavaScript

**Only ship JavaScript for interactive parts**:

```typescript
// Page with 1 island
export default defineComponent(() => {
  return () => (
    <div>
      <StaticHeader /> {/* 0 KB */}
      <StaticArticle /> {/* 0 KB */}
      <InteractiveLike /> {/* 2 KB */}
      <StaticFooter /> {/* 0 KB */}
    </div>
  );
});

// Total JS: 2 KB + runtime (5 KB) = 7 KB
// vs Full hydration: 50+ KB
```

## Island Boundaries

### Explicit Islands

Mark components as islands:

```typescript
import { island } from 'nexus/islands';

export const SearchBar = island(defineComponent(() => {
  const query = signal('')

  return () => (
    <input
      value={query()}
      onInput={e => query.set(e.target.value)}
    />
  );
}));
```

### Implicit Islands

Aether detects islands automatically:

```typescript
// Automatically an island (has onClick)
export const LikeButton = defineComponent(() => {
  const liked = signal(false);

  return () => (
    <button onClick={() => liked.set(!liked())}>
      {liked() ? '❤️' : '🤍'}
    </button>
  );
});

// Automatically static (no interactivity)
export const ArticleText = defineComponent(() => {
  return () => (
    <article>
      <h1>Title</h1>
      <p>Content...</p>
    </article>
  );
});
```

### Island Props

Pass data to islands:

```typescript
export const CommentIsland = island(defineComponent<{
  postId: string;
  initialComments: Comment[];
}>((props) => {
  const comments = signal(props.initialComments);

  const addComment = async (text: string) => {
    const comment = await api.addComment(props.postId, text);
    comments.set([...comments(), comment]);
  };

  return () => (
    <div>
      {#each comments() as comment}
        <Comment data={comment} />
      {/each}

      <CommentForm onSubmit={addComment} />
    </div>
  );
}));

// Usage
<CommentIsland
  postId="123"
  initialComments={serverComments}
/>
```

### Nested Islands

Islands can contain islands:

```typescript
export const Sidebar = island(defineComponent(() => {
  return () => (
    <aside>
      <SearchWidget /> {/* Island within island */}
      <CategoryFilter /> {/* Another island */}
      <RecentPosts /> {/* Static */}
    </aside>
  );
}));
```

### Island Slots

Islands can have static children:

```typescript
export const Accordion = island(defineComponent<{ children: any }>((props) => {
  const open = signal(false);

  return () => (
    <div>
      <button onClick={() => open.set(!open())}>
        Toggle
      </button>

      {#if open()}
        <div>
          {props.children} {/* Can be static */}
        </div>
      {/if}
    </div>
  );
}));

// Usage
<Accordion>
  <p>This content is static!</p>
  <p>No JavaScript needed for this text.</p>
</Accordion>
```

## Hydration Strategies

### Immediate Hydration

Hydrate island immediately:

```typescript
import { island } from 'nexus/islands';

export const CriticalWidget = island(defineComponent(() => {
  // ... component code
}), {
  hydrate: 'immediate' // Default
});
```

### Lazy Hydration

Hydrate when visible:

```typescript
export const VideoPlayer = island(defineComponent(() => {
  // ... component code
}), {
  hydrate: 'visible',
  rootMargin: '100px' // Preload 100px before visible
});
```

### Interaction Hydration

Hydrate on interaction:

```typescript
export const ChatWidget = island(defineComponent(() => {
  // ... component code
}), {
  hydrate: 'interaction',
  events: ['click', 'focus'] // Trigger events
});
```

### Idle Hydration

Hydrate when browser is idle:

```typescript
export const Analytics = island(defineComponent(() => {
  // ... component code
}), {
  hydrate: 'idle',
  timeout: 2000 // Or timeout after 2s
});
```

### Media Query Hydration

Hydrate based on media query:

```typescript
export const MobileMenu = island(defineComponent(() => {
  // ... component code
}), {
  hydrate: 'media',
  query: '(max-width: 768px)' // Only on mobile
});
```

### Custom Hydration

Custom hydration logic:

```typescript
export const CustomIsland = island(defineComponent(() => {
  // ... component code
}), {
  hydrate: 'custom',
  shouldHydrate: () => {
    // Custom logic
    return window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  }
});
```

## Static vs Interactive

### Static Components

Components with **no interactivity**:

```typescript
// ✅ Static (no JS shipped)
export const Header = defineComponent(() => {
  return () => (
    <header>
      <h1>My Site</h1>
      <nav>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </nav>
    </header>
  );
});

// ✅ Static (server-rendered data)
export const UserList = defineComponent<{ users: User[] }>((props) => {
  return () => (
    <ul>
      {#each props.users as user}
        <li>{user.name}</li>
      {/each}
    </ul>
  );
});
```

### Interactive Components (Islands)

Components with **interactivity**:

```typescript
// ✅ Island (has state + event handler)
export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      Count: {count()}
    </button>
  );
});

// ✅ Island (fetches data on client)
export const LiveUpdates = defineComponent(() => {
  const updates = signal([]);

  onMount(() => {
    const ws = new WebSocket('wss://api.example.com/updates');
    ws.onmessage = (e) => updates.set([...updates(), e.data]);
  });

  return () => (
    <ul>
      {#each updates() as update}
        <li>{update}</li>
      {/each}
    </ul>
  );
});
```

### Hybrid Components

Components that are **static on server, interactive on client**:

```typescript
export const Article = defineComponent<{ content: string }>((props) => {
  // Static rendering
  if (import.meta.env.SSR) {
    return () => (
      <article innerHTML={props.content} />
    );
  }

  // Interactive (with reading progress)
  const progress = signal(0);

  onMount(() => {
    const handler = () => {
      const scrolled = window.scrollY;
      const height = document.body.scrollHeight - window.innerHeight;
      progress.set((scrolled / height) * 100);
    };

    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  });

  return () => (
    <div>
      <div class="progress" style={{ width: `${progress()}%` }} />
      <article innerHTML={props.content} />
    </div>
  );
});
```

## Partial Hydration

### Component-Level Hydration

Hydrate specific components:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <Header /> {/* Static */}

      <main>
        <Article /> {/* Static */}

        {/* Only this hydrates */}
        <LikeButton />
      </main>

      <Footer /> {/* Static */}
    </div>
  );
});

// Result: Only LikeButton gets JavaScript
```

### Element-Level Hydration

Hydrate parts of a component:

```typescript
import { hydrateOn } from 'nexus/islands';

export const ProductCard = defineComponent<{ product: Product }>((props) => {
  return () => (
    <div class="card">
      {/* Static */}
      <img src={props.product.image} alt={props.product.name} />
      <h3>{props.product.name}</h3>
      <p>{props.product.price}</p>

      {/* Hydrate only the button */}
      {hydrateOn('click', () => (
        <button onClick={() => addToCart(props.product)}>
          Add to Cart
        </button>
      ))}
    </div>
  );
});
```

### Progressive Hydration

Hydrate in stages:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      {/* Stage 1: Immediate */}
      <CriticalSearch />

      {/* Stage 2: When idle */}
      <LazyComments hydrate="idle" />

      {/* Stage 3: When visible */}
      <RelatedProducts hydrate="visible" />
    </div>
  );
});

// Hydration order:
// 1. CriticalSearch (0ms)
// 2. LazyComments (when browser idle)
// 3. RelatedProducts (when scrolled into view)
```

## Island Communication

### Props (Parent → Island)

Pass data via props:

```typescript
export const Parent = defineComponent(() => {
  const user = signal({ name: 'Alice' })

  return () => (
    <div>
      <UserIsland user={user()} />
    </div>
  );
});

export const UserIsland = island(defineComponent<{ user: User }>((props) => {
  return () => <div>{props.user.name}</div>;
}));
```

### Events (Island → Parent)

Use callbacks:

```typescript
export const Parent = defineComponent(() => {
  const handleLike = (postId: string) => {
    console.log('Liked:', postId);
  };

  return () => (
    <PostIsland postId="123" onLike={handleLike} />
  );
});

export const PostIsland = island(defineComponent<{
  postId: string;
  onLike: (id: string) => void;
}>((props) => {
  return () => (
    <button onClick={() => props.onLike(props.postId)}>
      Like
    </button>
  );
}));
```

### Shared State (Island ↔ Island)

Use stores for shared state:

```typescript
// store.ts
export const [cartState, setCartState] = createStore({
  items: [] as CartItem[]
});

// ProductIsland.tsx
export const ProductIsland = island(defineComponent(() => {
  const addToCart = (product: Product) => {
    setCartState('items', [...cartState.items, product]);
  };

  return () => (
    <button onClick={() => addToCart(product)}>
      Add to Cart
    </button>
  );
}));

// CartIsland.tsx
export const CartIsland = island(defineComponent(() => {
  return () => (
    <div>
      Cart: {cartState.items.length} items
    </div>
  );
}));
```

### Custom Events

Use custom events:

```typescript
// Island A (emits)
export const IslandA = island(defineComponent(() => {
  const emit = () => {
    window.dispatchEvent(new CustomEvent('product-added', {
      detail: { productId: '123' }
    }));
  };

  return () => <button onClick={emit}>Add</button>;
}));

// Island B (listens)
export const IslandB = island(defineComponent(() => {
  const count = signal(0);

  onMount(() => {
    const handler = () => count.set(count() + 1);
    window.addEventListener('product-added', handler);
    return () => window.removeEventListener('product-added', handler);
  });

  return () => <div>Added: {count()}</div>;
}));
```

## Performance

### JavaScript Bundle Size

Islands dramatically reduce JavaScript:

```typescript
// Traditional SPA
export default defineComponent(() => {
  // Everything hydrates
  return () => (
    <div>
      <Header /> {/* +10 KB */}
      <Navigation /> {/* +15 KB */}
      <Article /> {/* +20 KB */}
      <Sidebar /> {/* +25 KB */}
      <Footer /> {/* +10 KB */}
    </div>
  );
});

// Total: 80 KB JavaScript

// Islands
export default defineComponent(() => {
  return () => (
    <div>
      <Header /> {/* 0 KB - static */}
      <Navigation /> {/* 0 KB - static */}
      <Article /> {/* 0 KB - static */}
      <SidebarIsland /> {/* 25 KB - interactive */}
      <Footer /> {/* 0 KB - static */}
    </div>
  );
});

// Total: 25 KB JavaScript (69% reduction!)
```

### Time to Interactive (TTI)

Islands improve TTI:

| Metric | Traditional | Islands | Improvement |
|--------|-------------|---------|-------------|
| JavaScript | 100 KB | 20 KB | 80% less |
| Parse time | 200ms | 40ms | 80% faster |
| TTI | 3.5s | 1.2s | 66% faster |

### Lazy Loading

Islands lazy load automatically:

```typescript
export const HeavyWidget = island(defineComponent(() => {
  // Heavy component
}), {
  hydrate: 'visible' // Only loads when visible
});

// Widget code is in separate chunk:
// heavy-widget.[hash].js (50 KB)
// Only downloaded when widget becomes visible
```

### Code Splitting

Each island is a separate chunk:

```typescript
// Automatic code splitting
<SearchIsland /> // → search-island.[hash].js
<CommentIsland /> // → comment-island.[hash].js
<CartIsland /> // → cart-island.[hash].js

// Browser only downloads what's needed
```

## SEO

### Fully Rendered HTML

Islands preserve SEO:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <h1>Blog Post Title</h1>
      <article>
        <p>Content that search engines see...</p>
      </article>

      <LikeButton /> {/* Island (still renders to HTML) */}
    </div>
  );
});

// Server HTML:
// <div>
//   <h1>Blog Post Title</h1>
//   <article>
//     <p>Content that search engines see...</p>
//   </article>
//   <button>Like</button> <!-- ✅ Search engines see this -->
// </div>
```

### Structured Data

Static structured data:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <script type="application/ld+json">
        {JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Article Title',
          author: 'Author Name'
        })}
      </script>

      <article>...</article>

      <CommentIsland /> {/* Interactive */}
    </div>
  );
});

// Structured data is static (good for SEO)
// Comments are interactive (good for UX)
```

## Best Practices

### 1. Minimize Island Count

```typescript
// ❌ Too many islands
<div>
  <LikeButton /> {/* Island */}
  <ShareButton /> {/* Island */}
  <BookmarkButton /> {/* Island */}
  <CommentButton /> {/* Island */}
</div>

// ✅ Single island
<ActionButtons /> {/* One island with all buttons */}
```

### 2. Keep Islands Small

```typescript
// ❌ Large island
export const Sidebar = island(defineComponent(() => {
  return () => (
    <aside>
      <Categories /> {/* Static, but in island */}
      <RecentPosts /> {/* Static, but in island */}
      <Search /> {/* Interactive */}
      <Newsletter /> {/* Static, but in island */}
    </aside>
  );
}));

// ✅ Small islands
export const Sidebar = defineComponent(() => {
  return () => (
    <aside>
      <Categories /> {/* Static */}
      <RecentPosts /> {/* Static */}
      <Search /> {/* Island (only this hydrates) */}
      <Newsletter /> {/* Static */}
    </aside>
  );
});
```

### 3. Static by Default

```typescript
// ✅ Start static
export const Header = defineComponent(() => {
  return () => (
    <header>
      <Logo />
      <Nav />
    </header>
  );
});

// ✅ Add interactivity only when needed
export const Header = defineComponent(() => {
  return () => (
    <header>
      <Logo />
      <Nav />
      <MobileMenuToggle /> {/* Island */}
    </header>
  );
});
```

### 4. Lazy Load Heavy Islands

```typescript
// ✅ Lazy load heavy components
export const VideoPlayer = island(defineComponent(() => {
  // 50 KB component
}), {
  hydrate: 'visible' // Only load when visible
});

export const Chart = island(defineComponent(() => {
  // Chart.js (100 KB)
}), {
  hydrate: 'idle' // Load when browser idle
});
```

## Comparisons

### vs Traditional SPA

| Feature | SPA | Islands |
|---------|-----|---------|
| JavaScript | 100+ KB | 10-20 KB |
| Hydration | Full page | Selective |
| TTI | 3-5s | 1-2s |
| SEO | Poor (without SSR) | Excellent |
| Complexity | High | Low |

### vs Astro Islands

Aether Islands vs Astro:

**Similarities**:
- Both use islands pattern
- Both have selective hydration
- Both optimize JavaScript

**Differences**:

| Feature | Aether | Astro |
|---------|-------|-------|
| Detection | Automatic | Manual (`client:*` directives) |
| Framework | Aether only | Multi-framework |
| Hydration | Multiple strategies | Basic strategies |
| DI | Built-in | N/A |

### vs Qwik Resumability

Aether Islands vs Qwik:

**Aether**:
- Traditional hydration (fast, but some JS)
- Explicit islands
- Fine-grained reactivity

**Qwik**:
- Resumability (no hydration)
- Everything is lazy
- Event-based loading

## Advanced Patterns

### Island Preloading

Preload islands before hydration:

```typescript
export const HeavyIsland = island(defineComponent(() => {
  // ... component code
}), {
  hydrate: 'visible',
  preload: 'intent' // Preload on hover/focus
});

// Preloads JavaScript when user hovers
// Hydrates when visible
// = Instant interactivity
```

### Island Prefetching

Prefetch island data:

```typescript
export const UserIsland = island(defineComponent(() => {
  const [user] = resource(() => api.fetchUser());

  return () => <div>{user()?.name}</div>;
}), {
  hydrate: 'visible',
  prefetch: async () => {
    // Prefetch data before hydration
    return await api.fetchUser();
  }
});
```

### Dynamic Islands

Load islands dynamically:

```typescript
export default defineComponent(() => {
  const showWidget = signal(false);

  const Widget = lazy(() => import('./Widget'));

  return () => (
    <div>
      <button onClick={() => showWidget.set(true)}>
        Show Widget
      </button>

      {#if showWidget()}
        <Suspense fallback={<Spinner />}>
          <Widget />
        </Suspense>
      {/if}
    </div>
  );
});
```

### Conditional Islands

Islands based on conditions:

```typescript
export default defineComponent(() => {
  const isMobile = useMediaQuery('(max-width: 768px)');

  return () => (
    <div>
      {#if isMobile()}
        <MobileMenuIsland />
      {:else}
        <DesktopNav /> {/* Static */}
      {/if}
    </div>
  );
});
```

## API Reference

### island

```typescript
function island<T>(
  component: Component<T>,
  options?: {
    hydrate?: 'immediate' | 'visible' | 'interaction' | 'idle' | 'media' | 'custom';
    rootMargin?: string;
    events?: string[];
    timeout?: number;
    query?: string;
    shouldHydrate?: () => boolean;
    preload?: 'intent' | 'viewport';
    prefetch?: () => Promise<any>;
  }
): Component<T>;
```

### hydrateOn

```typescript
function hydrateOn(
  trigger: 'click' | 'focus' | 'visible',
  component: () => JSX.Element
): JSX.Element;
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

### serverOnly

```typescript
function serverOnly<T>(
  component: Component<T>
): Component<T>;
```

## Examples

### Blog with Islands

```typescript
// routes/posts/[slug].tsx
export const loader = async ({ params }) => {
  const post = await db.posts.findUnique({
    where: { slug: params.slug },
    include: { author: true }
  });

  return post;
};

export default defineRoute({
  loader,
  component: defineComponent(() => {
    const post = useLoaderData<Post>();

    return () => (
      <div>
        {/* Static header */}
        <header>
          <h1>{post().title}</h1>
          <p>By {post().author.name}</p>
        </header>

        {/* Static article */}
        <article innerHTML={post().content} />

        {/* Island: Like button */}
        <LikeButton postId={post().id} />

        {/* Island: Comments (lazy) */}
        <CommentSection
          postId={post().id}
          hydrate="visible"
        />

        {/* Static footer */}
        <footer>
          <RelatedPosts posts={post().related} />
        </footer>
      </div>
    );
  })
});

// JavaScript shipped:
// - LikeButton: 2 KB
// - CommentSection: 8 KB (when visible)
// Total: 10 KB (vs 50+ KB full hydration)
```

### E-commerce with Islands

```typescript
// routes/products/[id].tsx
export default defineRoute({
  loader: async ({ params }) => {
    return await db.products.findUnique({
      where: { id: params.id },
      include: { images: true, reviews: true }
    });
  },

  component: defineComponent(() => {
    const product = useLoaderData<Product>();

    return () => (
      <div class="product-page">
        {/* Static gallery */}
        <ProductGallery images={product().images} />

        {/* Static info */}
        <div class="product-info">
          <h1>{product().title}</h1>
          <p class="price">${product().price}</p>
          <div innerHTML={product().description} />
        </div>

        {/* Island: Add to cart */}
        <AddToCartButton
          product={product()}
          hydrate="interaction"
        />

        {/* Static reviews */}
        <ReviewList reviews={product().reviews} />

        {/* Island: Review form (lazy) */}
        <ReviewForm
          productId={product().id}
          hydrate="visible"
        />

        {/* Island: Recommendations (idle) */}
        <RecommendedProducts
          categoryId={product().categoryId}
          hydrate="idle"
        />
      </div>
    );
  })
});

// JavaScript shipped:
// - AddToCartButton: 3 KB (on interaction)
// - ReviewForm: 5 KB (when visible)
// - RecommendedProducts: 10 KB (when idle)
// Total: 18 KB (on-demand)
```

---

**Islands Architecture in Aether provides the best of both worlds**: the SEO and performance benefits of static HTML with the interactivity of modern web apps. By shipping minimal JavaScript and hydrating selectively, you get fast, accessible, SEO-friendly applications.

**Next**: [19. Titan Integration →](./19-TITAN-INTEGRATION.md)
