# 18. Static Site Generation (SSG)

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Basic SSG](#basic-ssg)
- [Dynamic Routes](#dynamic-routes)
- [Incremental Static Regeneration](#incremental-static-regeneration)
- [Hybrid Rendering](#hybrid-rendering)
- [Data Fetching](#data-fetching)
- [Asset Optimization](#asset-optimization)
- [Deployment](#deployment)
- [Performance](#performance)
- [SEO](#seo)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Aether provides **powerful Static Site Generation (SSG)** that:

- 📄 **Pre-renders pages at build time**
- ⚡ **Blazing fast performance** - serve static HTML
- 🔄 **Incremental regeneration** - update pages without full rebuild
- 🎯 **Hybrid rendering** - Mix SSG, SSR, and CSR
- 📦 **Asset optimization** - Auto-optimize images, fonts, CSS
- 🌐 **Global CDN ready** - Deploy anywhere
- 🔍 **Perfect SEO** - Fully crawlable content

### How It Works

```
Build Time:
1. Fetch data from APIs/DB
2. Render components to HTML
3. Generate static files
4. Optimize assets

Runtime:
1. Serve pre-generated HTML (instant)
2. Hydrate for interactivity
3. Optional: Revalidate in background
```

### Quick Example

```typescript
// routes/blog/[slug].tsx
export const getStaticPaths = async () => {
  const posts = await db.posts.findMany();

  return posts.map(post => ({
    params: { slug: post.slug }
  }));
};

export const getStaticProps = async ({ params }) => {
  const post = await db.posts.findUnique({
    where: { slug: params.slug }
  });

  return { props: { post } };
};

export default defineRoute({
  component: defineComponent<{ post: Post }>((props) => {
    return () => (
      <article>
        <h1>{props.post.title}</h1>
        <div innerHTML={props.post.content} />
      </article>
    );
  })
});

// Build output:
// dist/blog/my-first-post/index.html
// dist/blog/my-second-post/index.html
// ...
```

## Philosophy

### Static by Default

**Generate static HTML when possible**:

```typescript
// ✅ Static (best performance)
export const getStaticProps = async () => {
  return { props: { data: await fetchData() } };
};

// ⚠️ SSR (when needed)
export const loader = async () => {
  return await fetchUserSpecificData();
};

// ⚠️ CSR (last resort)
onMount(async () => {
  data.set(await fetchData());
});
```

### Incremental Adoption

**Mix rendering strategies**:

```typescript
// routes/
// ├── index.tsx              → SSG (static homepage)
// ├── about.tsx              → SSG (static about page)
// ├── blog/
// │   ├── index.tsx          → SSG (blog list)
// │   └── [slug].tsx         → SSG (individual posts)
// ├── dashboard/
// │   └── index.tsx          → SSR (user-specific)
// └── api/
//     └── users.ts           → API route

// Each route can have different rendering strategy
```

### Content-First

**Optimize for content delivery**:

```typescript
// ✅ Content rendered at build time
export const getStaticProps = async () => {
  const content = await cms.getContent();
  return { props: { content } };
};

// HTML is ready immediately, no loading spinners
```

### Developer Experience

**Simple API, powerful features**:

```typescript
// Simple: Just export getStaticProps
export const getStaticProps = async () => {
  return { props: { data: await fetchData() } };
};

// Powerful: ISR, caching, revalidation
export const getStaticProps = async () => {
  return {
    props: { data: await fetchData() },
    revalidate: 60 // Revalidate every 60 seconds
  };
};
```

## Basic SSG

### Static Page

Generate static page:

```typescript
// routes/about.tsx
export const getStaticProps = async () => {
  return {
    props: {
      title: 'About Us',
      content: 'We are a team of developers...'
    }
  };
};

export default defineRoute({
  component: defineComponent<{ title: string; content: string }>((props) => {
    return () => (
      <div>
        <h1>{props.title}</h1>
        <p>{props.content}</p>
      </div>
    );
  })
});

// Build: aether build
// Output: dist/about/index.html
```

### Data Fetching

Fetch data at build time:

```typescript
// routes/products.tsx
export const getStaticProps = async () => {
  const products = await db.products.findMany();

  return {
    props: { products }
  };
};

export default defineRoute({
  component: defineComponent<{ products: Product[] }>((props) => {
    return () => (
      <div>
        <h1>Products</h1>
        <ul>
          {#each props.products as product}
            <li>{product.name} - ${product.price}</li>
          {/each}
        </ul>
      </div>
    );
  })
});
```

### External APIs

Fetch from external APIs:

```typescript
export const getStaticProps = async () => {
  const response = await fetch('https://api.example.com/posts');
  const posts = await response.json();

  return {
    props: { posts }
  };
};
```

### Build Configuration

Configure build behavior:

```typescript
// nexus.config.ts
export default {
  ssg: {
    // Enable SSG
    enabled: true,

    // Output directory
    outDir: 'dist',

    // Trailing slashes
    trailingSlash: true,

    // 404 page
    notFound: 'routes/404.tsx'
  }
};
```

## Dynamic Routes

### Static Paths

Generate pages for dynamic routes:

```typescript
// routes/users/[id].tsx
export const getStaticPaths = async () => {
  const users = await db.users.findMany();

  return users.map(user => ({
    params: { id: user.id }
  }));
};

export const getStaticProps = async ({ params }) => {
  const user = await db.users.findUnique({
    where: { id: params.id }
  });

  return {
    props: { user }
  };
};

export default defineRoute({
  component: defineComponent<{ user: User }>((props) => {
    return () => (
      <div>
        <h1>{props.user.name}</h1>
        <p>{props.user.email}</p>
      </div>
    );
  })
});

// Build output:
// dist/users/1/index.html
// dist/users/2/index.html
// dist/users/3/index.html
```

### Nested Dynamic Routes

Multiple dynamic segments:

```typescript
// routes/[category]/[product].tsx
export const getStaticPaths = async () => {
  const products = await db.products.findMany({
    include: { category: true }
  });

  return products.map(product => ({
    params: {
      category: product.category.slug,
      product: product.slug
    }
  }));
};

export const getStaticProps = async ({ params }) => {
  const product = await db.products.findFirst({
    where: {
      slug: params.product,
      category: { slug: params.category }
    }
  });

  return { props: { product } };
};

// Output:
// dist/electronics/laptop/index.html
// dist/electronics/phone/index.html
// dist/books/novel/index.html
```

### Fallback Behavior

Handle missing paths:

```typescript
export const getStaticPaths = async () => {
  // Only pre-render popular posts
  const popularPosts = await db.posts.findMany({
    where: { views: { gt: 1000 } },
    take: 10
  });

  return {
    paths: popularPosts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: 'blocking' // Generate on-demand
  };
};

// Fallback options:
// - false: 404 for missing paths
// - true: Show loading, generate in background
// - 'blocking': Wait for generation (SSR-like)
```

### Catch-All Routes

Generate for catch-all routes:

```typescript
// routes/docs/[...slug].tsx
export const getStaticPaths = async () => {
  const docs = await fetchAllDocs();

  return docs.map(doc => ({
    params: { slug: doc.path.split('/') }
  }));
};

export const getStaticProps = async ({ params }) => {
  const path = params.slug.join('/');
  const doc = await fetchDoc(path);

  return { props: { doc } };
};

// Output:
// dist/docs/getting-started/index.html
// dist/docs/api/reference/index.html
// dist/docs/guides/tutorial/basics/index.html
```

## Incremental Static Regeneration

### Time-Based Revalidation

Revalidate after time period:

```typescript
export const getStaticProps = async () => {
  const posts = await db.posts.findMany();

  return {
    props: { posts },
    revalidate: 60 // Revalidate every 60 seconds
  };
};

// How it works:
// 1. First request: Serve stale page (instant)
// 2. Background: Regenerate page
// 3. Next request: Serve fresh page
```

### On-Demand Revalidation

Revalidate on demand:

```typescript
// API route
export const POST = async ({ request }) => {
  const { secret, path } = await request.json();

  // Verify secret
  if (secret !== process.env.REVALIDATE_SECRET) {
    return new Response('Invalid secret', { status: 401 });
  }

  // Revalidate path
  await revalidatePath(path);

  return new Response('Revalidated', { status: 200 });
};

// Webhook from CMS:
// POST /api/revalidate
// { "secret": "...", "path": "/blog/my-post" }
```

### Stale-While-Revalidate

Serve stale content while regenerating:

```typescript
export const getStaticProps = async () => {
  const data = await fetchData();

  return {
    props: { data },
    revalidate: 10,
    staleWhileRevalidate: 60 // Serve stale for up to 60s
  };
};

// Timeline:
// 0s: Request 1 → Serve cached (fresh)
// 11s: Request 2 → Serve cached (stale), trigger regeneration
// 12s: Regeneration complete
// 13s: Request 3 → Serve new cached (fresh)
```

### Tag-Based Revalidation

Revalidate by tags:

```typescript
export const getStaticProps = async () => {
  const post = await db.posts.findUnique({ where: { id: '1' } });

  return {
    props: { post },
    tags: ['posts', `post:${post.id}`] // Cache tags
  };
};

// Revalidate all pages with tag
await revalidateTag('posts');

// Revalidate specific post
await revalidateTag('post:1');
```

## Hybrid Rendering

### Per-Route Strategy

Different strategies per route:

```typescript
// routes/
// ├── index.tsx              → SSG
export const getStaticProps = async () => {
  return { props: { data: await fetchHomeData() } };
};

// ├── blog/[slug].tsx        → SSG with ISR
export const getStaticProps = async ({ params }) => {
  return {
    props: { post: await fetchPost(params.slug) },
    revalidate: 60
  };
};

// ├── dashboard.tsx          → SSR
export const loader = async ({ request }) => {
  const user = await getUser(request);
  return { props: { user } };
};

// └── search.tsx             → CSR
export default defineComponent(() => {
  const results = signal([]);

  onMount(async () => {
    results.set(await search());
  });

  return () => <Results data={results()} />;
});
```

### Partial Prerendering

Mix static and dynamic:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      {/* Static (prerendered) */}
      <Header />
      <Nav />

      {/* Dynamic (server-rendered) */}
      <Suspense fallback={<Skeleton />}>
        <UserWidget />
      </Suspense>

      {/* Static (prerendered) */}
      <Article />
      <Footer />
    </div>
  );
});

// Header, Nav, Article, Footer: Static HTML
// UserWidget: Server-rendered on request
```

### Client-Side Enhancement

Enhance static pages on client:

```typescript
export const getStaticProps = async () => {
  const products = await db.products.findMany();
  return { props: { products } };
};

export default defineRoute({
  component: defineComponent<{ products: Product[] }>((props) => {
    const filtered = signal(props.products);

    // Client-side filtering (enhances static content)
    const filter = (query: string) => {
      filtered.set(
        props.products.filter(p =>
          p.name.toLowerCase().includes(query.toLowerCase())
        )
      );
    };

    return () => (
      <div>
        {/* Client-side search (not prerendered) */}
        <input onInput={e => filter(e.target.value)} />

        {/* Static content (prerendered) */}
        <ul>
          {#each filtered() as product}
            <li>{product.name}</li>
          {/each}
        </ul>
      </div>
    );
  })
});
```

## Data Fetching

### Parallel Fetching

Fetch data in parallel:

```typescript
export const getStaticProps = async () => {
  const [posts, categories, tags] = await Promise.all([
    db.posts.findMany(),
    db.categories.findMany(),
    db.tags.findMany()
  ]);

  return {
    props: { posts, categories, tags }
  };
};
```

### Dependent Fetching

Fetch data sequentially when dependent:

```typescript
export const getStaticProps = async ({ params }) => {
  // First, get the user
  const user = await db.users.findUnique({
    where: { id: params.id }
  });

  // Then, get user's posts
  const posts = await db.posts.findMany({
    where: { authorId: user.id }
  });

  return {
    props: { user, posts }
  };
};
```

### External Data Sources

Fetch from CMS, APIs:

```typescript
export const getStaticProps = async () => {
  // Contentful
  const contentfulPosts = await contentful.getEntries({
    content_type: 'blogPost'
  });

  // Strapi
  const strapiPosts = await fetch('https://strapi.example.com/posts')
    .then(r => r.json());

  // Sanity
  const sanityPosts = await sanity.fetch(`
    *[_type == "post"] {
      title,
      slug,
      publishedAt
    }
  `);

  return {
    props: {
      contentfulPosts,
      strapiPosts,
      sanityPosts
    }
  };
};
```

### GraphQL

Fetch from GraphQL APIs:

```typescript
import { request, gql } from 'graphql-request';

export const getStaticProps = async () => {
  const query = gql`
    query {
      posts {
        id
        title
        content
        author {
          name
        }
      }
    }
  `;

  const data = await request('https://api.example.com/graphql', query);

  return {
    props: { posts: data.posts }
  };
};
```

## Asset Optimization

### Image Optimization

Automatic image optimization:

```typescript
import { Image } from 'nexus/image';

export default defineComponent(() => {
  return () => (
    <Image
      src="/hero.jpg"
      alt="Hero image"
      width={1200}
      height={600}
      priority // Load immediately
    />
  );
});

// Build output:
// - WebP version: hero.webp
// - AVIF version: hero.avif
// - Responsive sizes: hero-640w.webp, hero-1024w.webp, hero-1920w.webp
// - Lazy loading by default (except priority images)
```

### Font Optimization

Optimize web fonts:

```typescript
// nexus.config.ts
export default {
  fonts: {
    google: {
      families: ['Inter:400,500,700', 'JetBrains Mono:400']
    }
  }
};

// Build output:
// - Fonts downloaded locally
// - Subsetted to used characters
// - Preloaded in <head>
// - font-display: swap
```

### CSS Optimization

Optimize CSS:

```typescript
// Automatic optimizations:
// - Unused CSS purged
// - Critical CSS inlined
// - Non-critical CSS deferred
// - Minified and compressed

// nexus.config.ts
export default {
  css: {
    purge: true,
    inline: true, // Inline critical CSS
    minify: true
  }
};
```

### JavaScript Optimization

Optimize JavaScript:

```typescript
// Automatic optimizations:
// - Tree-shaking
// - Code splitting by route
// - Minification
// - Compression (gzip/brotli)

// nexus.config.ts
export default {
  build: {
    minify: true,
    sourcemap: false,
    splitting: true,
    target: 'es2020'
  }
};
```

## Deployment

### Static Hosting

Deploy to static hosts:

```bash
# Build
aether build

# Deploy to Vercel
vercel deploy

# Deploy to Netlify
netlify deploy --prod

# Deploy to Cloudflare Pages
wrangler pages publish dist

# Deploy to AWS S3
aws s3 sync dist/ s3://my-bucket --delete

# Deploy to GitHub Pages
gh-pages -d dist
```

### CDN Configuration

Configure CDN:

```typescript
// nexus.config.ts
export default {
  cdn: {
    // Custom domain
    domain: 'https://cdn.example.com',

    // Cache headers
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable'
    },

    // Regions
    regions: ['us-east-1', 'eu-west-1', 'ap-southeast-1']
  }
};
```

### Preview Deployments

Preview branches:

```yaml
# .github/workflows/preview.yml
name: Preview
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
```

### Environment Variables

Handle environment variables:

```typescript
// Build-time variables (embedded in bundle)
export const getStaticProps = async () => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  const data = await fetch(`${apiUrl}/posts`).then(r => r.json());

  return { props: { data } };
};

// Runtime variables (edge functions)
export const config = {
  runtime: 'edge'
};

export const loader = async ({ request }) => {
  const secret = process.env.SECRET_KEY; // Runtime variable
  // ...
};
```

## Performance

### Lighthouse Scores

SSG achieves perfect scores:

```
Performance: 100
Accessibility: 100
Best Practices: 100
SEO: 100
```

### Core Web Vitals

Optimal metrics:

| Metric | SSG | SSR | CSR |
|--------|-----|-----|-----|
| **LCP** (Largest Contentful Paint) | < 1s | < 2.5s | > 3s |
| **FID** (First Input Delay) | < 50ms | < 100ms | < 100ms |
| **CLS** (Cumulative Layout Shift) | < 0.1 | < 0.1 | > 0.1 |
| **TTFB** (Time to First Byte) | < 200ms | < 600ms | < 600ms |
| **TTI** (Time to Interactive) | < 2s | < 3.5s | > 4s |

### Bundle Size

Minimal JavaScript:

```typescript
// Page with minimal JS
export const getStaticProps = async () => {
  return { props: { content: await fetchContent() } };
};

export default defineComponent<{ content: string }>((props) => {
  return () => <article innerHTML={props.content} />;
});

// Output:
// HTML: 5 KB
// CSS: 2 KB
// JS: 0 KB (no hydration needed)
```

### Caching

Aggressive caching:

```typescript
// nexus.config.ts
export default {
  headers: [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable'
        }
      ]
    }
  ]
};
```

## SEO

### Meta Tags

Automatic meta tags:

```typescript
export const getStaticProps = async ({ params }) => {
  const post = await db.posts.findUnique({
    where: { slug: params.slug }
  });

  return {
    props: { post },
    meta: {
      title: post.title,
      description: post.excerpt,
      ogImage: post.coverImage,
      ogType: 'article',
      twitterCard: 'summary_large_image'
    }
  };
};

// Generated HTML:
// <head>
//   <title>Post Title</title>
//   <meta name="description" content="Post excerpt..." />
//   <meta property="og:title" content="Post Title" />
//   <meta property="og:image" content="/cover.jpg" />
//   <meta name="twitter:card" content="summary_large_image" />
// </head>
```

### Sitemap Generation

Auto-generate sitemap:

```typescript
// nexus.config.ts
export default {
  sitemap: {
    hostname: 'https://example.com',
    exclude: ['/admin/*', '/api/*'],
    priority: {
      '/': 1.0,
      '/blog/*': 0.8,
      '/docs/*': 0.9
    },
    changefreq: {
      '/blog/*': 'daily',
      '/docs/*': 'weekly'
    }
  }
};

// Build output: dist/sitemap.xml
```

### Robots.txt

Generate robots.txt:

```typescript
// nexus.config.ts
export default {
  robots: {
    userAgent: '*',
    allow: '/',
    disallow: ['/admin', '/api'],
    sitemap: 'https://example.com/sitemap.xml'
  }
};

// Build output: dist/robots.txt
// User-agent: *
// Allow: /
// Disallow: /admin
// Disallow: /api
// Sitemap: https://example.com/sitemap.xml
```

### Structured Data

Add structured data:

```typescript
export const getStaticProps = async ({ params }) => {
  const post = await db.posts.findUnique({
    where: { slug: params.slug }
  });

  return {
    props: { post },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      author: {
        '@type': 'Person',
        name: post.author.name
      },
      datePublished: post.publishedAt,
      image: post.coverImage
    }
  };
};

// Generated HTML:
// <script type="application/ld+json">
//   { "@context": "https://schema.org", ... }
// </script>
```

## Best Practices

### 1. Use SSG When Possible

```typescript
// ✅ Use SSG for content-heavy pages
export const getStaticProps = async () => {
  return { props: { posts: await fetchPosts() } };
};

// ❌ Don't use SSR unnecessarily
export const loader = async () => {
  return { props: { posts: await fetchPosts() } };
};
```

### 2. Implement ISR for Dynamic Content

```typescript
// ✅ Use ISR for content that changes occasionally
export const getStaticProps = async () => {
  return {
    props: { products: await fetchProducts() },
    revalidate: 3600 // Revalidate every hour
  };
};

// ❌ Don't rebuild entire site for every change
// (Use ISR instead)
```

### 3. Optimize Images

```typescript
// ✅ Use Image component
import { Image } from 'nexus/image';

<Image
  src="/photo.jpg"
  alt="Photo"
  width={800}
  height={600}
  loading="lazy"
/>

// ❌ Don't use regular img tags for large images
<img src="/photo.jpg" alt="Photo" />
```

### 4. Prefetch Critical Data

```typescript
// ✅ Prefetch critical data
export const getStaticProps = async () => {
  const [page, menu, footer] = await Promise.all([
    fetchPage(),
    fetchMenu(),
    fetchFooter()
  ]);

  return { props: { page, menu, footer } };
};
```

## Advanced Patterns

### Partial Builds

Build subset of pages:

```bash
# Build only blog pages
aether build --filter "blog/**"

# Build specific paths
aether build --paths "/blog/post-1,/blog/post-2"
```

### Build Plugins

Custom build plugins:

```typescript
// nexus.config.ts
export default {
  plugins: [
    {
      name: 'custom-plugin',
      buildStart() {
        console.log('Build started');
      },
      buildEnd() {
        console.log('Build ended');
      },
      generatePage(page) {
        // Transform page HTML
        return page.html.replace('foo', 'bar');
      }
    }
  ]
};
```

### Custom Static Generation

Custom SSG logic:

```typescript
// scripts/generate.ts
import { generateStaticPages } from 'nexus/ssg';

const pages = await generateStaticPages({
  routes: ['/', '/about', '/contact'],

  getStaticProps: async (route) => {
    // Custom data fetching
    const data = await fetchData(route);
    return { props: { data } };
  },

  outDir: 'dist',

  onPageGenerated: (route, html) => {
    console.log(`Generated ${route}`);
  }
});

console.log(`Generated ${pages.length} pages`);
```

## API Reference

### getStaticProps

```typescript
export const getStaticProps = async (context: {
  params: Record<string, string>;
  locale?: string;
  preview?: boolean;
}) => {
  return {
    props: any;
    revalidate?: number | false;
    notFound?: boolean;
    redirect?: {
      destination: string;
      permanent: boolean;
    };
  };
};
```

### getStaticPaths

```typescript
export const getStaticPaths = async () => {
  return {
    paths: Array<{
      params: Record<string, string | string[]>;
      locale?: string;
    }>;
    fallback: boolean | 'blocking';
  };
};
```

### revalidatePath

```typescript
function revalidatePath(path: string): Promise<void>;
```

### revalidateTag

```typescript
function revalidateTag(tag: string): Promise<void>;
```

## Examples

### Blog

```typescript
// routes/blog/index.tsx
export const getStaticProps = async () => {
  const posts = await db.posts.findMany({
    orderBy: { publishedAt: 'desc' }
  });

  return {
    props: { posts },
    revalidate: 3600 // Revalidate every hour
  };
};

export default defineRoute({
  component: defineComponent<{ posts: Post[] }>((props) => {
    return () => (
      <div>
        <h1>Blog</h1>
        <ul>
          {#each props.posts as post}
            <li>
              <a href={`/blog/${post.slug}`}>{post.title}</a>
            </li>
          {/each}
        </ul>
      </div>
    );
  })
});

// routes/blog/[slug].tsx
export const getStaticPaths = async () => {
  const posts = await db.posts.findMany();

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: 'blocking'
  };
};

export const getStaticProps = async ({ params }) => {
  const post = await db.posts.findUnique({
    where: { slug: params.slug },
    include: { author: true }
  });

  if (!post) {
    return { notFound: true };
  }

  return {
    props: { post },
    revalidate: 3600,
    meta: {
      title: post.title,
      description: post.excerpt,
      ogImage: post.coverImage
    }
  };
};

export default defineRoute({
  component: defineComponent<{ post: Post }>((props) => {
    return () => (
      <article>
        <h1>{props.post.title}</h1>
        <p>By {props.post.author.name}</p>
        <div innerHTML={props.post.content} />
      </article>
    );
  })
});
```

### Documentation Site

```typescript
// routes/docs/[...slug].tsx
export const getStaticPaths = async () => {
  const docs = await fs.readdir('docs', { recursive: true });

  const paths = docs
    .filter(file => file.endsWith('.md'))
    .map(file => ({
      params: {
        slug: file.replace('.md', '').split('/')
      }
    }));

  return { paths, fallback: false };
};

export const getStaticProps = async ({ params }) => {
  const path = params.slug.join('/');
  const content = await fs.readFile(`docs/${path}.md`, 'utf-8');

  const { data, content: markdown } = matter(content);
  const html = await remark().use(remarkHtml).process(markdown);

  return {
    props: {
      frontmatter: data,
      content: html.toString()
    }
  };
};

export default defineRoute({
  component: defineComponent<{
    frontmatter: any;
    content: string;
  }>((props) => {
    return () => (
      <div>
        <h1>{props.frontmatter.title}</h1>
        <article innerHTML={props.content} />
      </div>
    );
  })
});
```

---

**Static Site Generation in Aether combines the performance of static sites with the flexibility of dynamic applications.** With ISR, hybrid rendering, and automatic optimizations, you get the best of both worlds: instant page loads and fresh content.

**Next**: [20. Netron RPC →](./20-NETRON-RPC.md)
