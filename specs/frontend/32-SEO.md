# 32. SEO (Search Engine Optimization)

## Table of Contents
- [Overview](#overview)
- [Meta Tags](#meta-tags)
- [Structured Data](#structured-data)
- [Sitemaps](#sitemaps)
- [Robots.txt](#robotstxt)
- [Open Graph](#open-graph)
- [Performance](#performance)
- [Mobile Optimization](#mobile-optimization)
- [Accessibility](#accessibility)
- [Content Optimization](#content-optimization)
- [URL Structure](#url-structure)
- [Canonical URLs](#canonical-urls)
- [Image Optimization](#image-optimization)
- [SSR for SEO](#ssr-for-seo)
- [Indexing](#indexing)
- [Analytics](#analytics)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

SEO ensures your app is discoverable and ranks well in search engines.

### SEO Fundamentals

```typescript
/**
 * SEO Core Principles:
 *
 * 1. Technical SEO
 *    - Site structure and navigation
 *    - Page speed and performance
 *    - Mobile-friendliness
 *    - HTTPS and security
 *
 * 2. On-Page SEO
 *    - Meta tags (title, description)
 *    - Headings hierarchy
 *    - Content quality
 *    - Internal linking
 *
 * 3. Off-Page SEO
 *    - Backlinks
 *    - Social signals
 *    - Brand mentions
 *
 * 4. Content SEO
 *    - Keyword research
 *    - Quality content
 *    - User intent
 *    - Freshness
 *
 * 5. Local SEO (if applicable)
 *    - Google Business Profile
 *    - Local citations
 *    - Reviews
 */
```

### SEO Checklist

```typescript
/**
 * Essential SEO Checklist:
 *
 * [ ] Unique title and description for each page
 * [ ] Proper heading hierarchy (h1-h6)
 * [ ] Semantic HTML structure
 * [ ] Fast page load (< 3s)
 * [ ] Mobile-friendly design
 * [ ] HTTPS enabled
 * [ ] XML sitemap
 * [ ] Robots.txt
 * [ ] Structured data (Schema.org)
 * [ ] Open Graph tags
 * [ ] Canonical URLs
 * [ ] Optimized images (alt text, compression)
 * [ ] Internal linking
 * [ ] 404 error pages
 * [ ] Redirect management
 */
```

## Meta Tags

Essential meta tags for SEO.

### Title Tag

```html
<!-- Unique, descriptive, under 60 characters -->
<title>Aether Framework - Build Fast, Modern Web Apps</title>
```

```typescript
// Dynamic title in component
export default defineComponent(() => {
  const { title } = usePageData();

  return () => (
    <>
      <Head>
        <title>{title()}</title>
      </Head>
      <App />
    </>
  );
});

// SEO title helper
export const SEOTitle = defineComponent((props: {
  title: string;
  siteName?: string;
}) => {
  const fullTitle = props.siteName
    ? `${props.title} | ${props.siteName}`
    : props.title;

  return () => (
    <Head>
      <title>{fullTitle}</title>
    </Head>
  );
});

// Usage
<SEOTitle title="About Us" siteName="Aether" />
// Renders: "About Us | (Aether)"
```

### Meta Description

```html
<!-- Compelling, under 160 characters -->
<meta name="description" content="Aether is a modern framework for building fast, scalable web applications with TypeScript and fine-grained reactivity.">
```

```typescript
export const SEODescription = defineComponent((props: {
  description: string;
}) => {
  return () => (
    <Head>
      <meta name="description" content={props.description} />
    </Head>
  );
});
```

### Other Meta Tags

```html
<!-- Charset -->
<meta charset="UTF-8">

<!-- Viewport (mobile) -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<!-- Language -->
<meta http-equiv="content-language" content="en-US">

<!-- Author -->
<meta name="author" content="Your Name">

<!-- Keywords (less important now) -->
<meta name="keywords" content="web framework, typescript, react alternative">

<!-- Robots -->
<meta name="robots" content="index, follow">

<!-- Googlebot specific -->
<meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">

<!-- Theme color -->
<meta name="theme-color" content="#3b82f6">
```

## Structured Data

Use Schema.org structured data for rich snippets.

### JSON-LD Format

```typescript
// Article structured data
export const ArticleSchema = defineComponent((props: {
  article: {
    title: string;
    description: string;
    author: string;
    datePublished: string;
    dateModified?: string;
    image: string;
    url: string;
  };
}) => {
  const schema = () => ({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: props.article.title,
    description: props.article.description,
    author: {
      '@type': 'Person',
      name: props.article.author
    },
    datePublished: props.article.datePublished,
    dateModified: props.article.dateModified || props.article.datePublished,
    image: props.article.image,
    url: props.article.url
  });

  return () => (
    <Head>
      <script type="application/ld+json">
        {JSON.stringify(schema())}
      </script>
    </Head>
  );
});
```

### Common Schema Types

```typescript
// Organization
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: '(Aether)',
  url: 'https://nexus.dev',
  logo: 'https://nexus.dev/logo.png',
  sameAs: [
    'https://twitter.com/nexus',
    'https://github.com/nexus'
  ],
  contactPoint: {
    '@type': 'ContactPoint',
    telephone: '+1-555-1234',
    contactType: 'customer service'
  }
};

// Product
const productSchema = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Aether Pro',
  description: 'Premium web framework',
  brand: {
    '@type': 'Brand',
    name: '(Aether)'
  },
  offers: {
    '@type': 'Offer',
    price: '99.00',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock'
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.8',
    reviewCount: '127'
  }
};

// BreadcrumbList
const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://nexus.dev'
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Docs',
      item: 'https://nexus.dev/docs'
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: 'Getting Started'
    }
  ]
};

// FAQ
const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Aether?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Aether is a modern web framework...'
      }
    }
  ]
};
```

## Sitemaps

Generate XML sitemaps for search engines.

### Basic Sitemap

```xml
<!-- public/sitemap.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2024-01-15</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://example.com/about</loc>
    <lastmod>2024-01-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://example.com/blog/post-1</loc>
    <lastmod>2024-01-14</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>
```

### Dynamic Sitemap Generation

```typescript
// server/sitemap.ts
import { SitemapStream, streamToPromise } from 'sitemap';

export const generateSitemap = async (): Promise<string> => {
  const stream = new SitemapStream({ hostname: 'https://example.com' });

  // Static pages
  stream.write({
    url: '/',
    changefreq: 'daily',
    priority: 1.0
  });

  stream.write({
    url: '/about',
    changefreq: 'monthly',
    priority: 0.8
  });

  // Dynamic pages from database
  const posts = await db.post.findMany({
    select: { slug: true, updatedAt: true }
  });

  posts.forEach((post) => {
    stream.write({
      url: `/blog/${post.slug}`,
      lastmod: post.updatedAt.toISOString(),
      changefreq: 'weekly',
      priority: 0.6
    });
  });

  stream.end();

  const xml = await streamToPromise(stream);
  return xml.toString();
};

// API endpoint
app.get('/sitemap.xml', async (req, res) => {
  res.header('Content-Type', 'application/xml');
  const sitemap = await generateSitemap();
  res.send(sitemap);
});
```

### Sitemap Index

```xml
<!-- For large sites with multiple sitemaps -->
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-pages.xml</loc>
    <lastmod>2024-01-15</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-blog.xml</loc>
    <lastmod>2024-01-15</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-products.xml</loc>
    <lastmod>2024-01-15</lastmod>
  </sitemap>
</sitemapindex>
```

## Robots.txt

Control search engine crawling.

### Basic Robots.txt

```txt
# public/robots.txt
User-agent: *
Allow: /

# Disallow specific paths
Disallow: /admin/
Disallow: /api/
Disallow: /private/

# Sitemap location
Sitemap: https://example.com/sitemap.xml
```

### Advanced Robots.txt

```txt
# Allow all bots except specific ones
User-agent: *
Allow: /

# Block specific bot
User-agent: BadBot
Disallow: /

# Google-specific
User-agent: Googlebot
Allow: /
Crawl-delay: 10

# Sitemap
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap-blog.xml
```

## Open Graph

Optimize for social media sharing.

### Basic Open Graph

```html
<!-- Open Graph meta tags -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://example.com/page">
<meta property="og:title" content="Page Title">
<meta property="og:description" content="Page description">
<meta property="og:image" content="https://example.com/image.jpg">
<meta property="og:site_name" content="Aether">
<meta property="og:locale" content="en_US">
```

```typescript
export const OpenGraph = defineComponent((props: {
  type?: string;
  url: string;
  title: string;
  description: string;
  image: string;
  siteName?: string;
}) => {
  return () => (
    <Head>
      <meta property="og:type" content={props.type || 'website'} />
      <meta property="og:url" content={props.url} />
      <meta property="og:title" content={props.title} />
      <meta property="og:description" content={props.description} />
      <meta property="og:image" content={props.image} />
      {props.siteName && (
        <meta property="og:site_name" content={props.siteName} />
      )}
    </Head>
  );
});
```

### Twitter Cards

```html
<!-- Twitter Card meta tags -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@nexus">
<meta name="twitter:creator" content="@author">
<meta name="twitter:title" content="Page Title">
<meta name="twitter:description" content="Page description">
<meta name="twitter:image" content="https://example.com/image.jpg">
```

```typescript
export const TwitterCard = defineComponent((props: {
  card?: 'summary' | 'summary_large_image' | 'app' | 'player';
  site?: string;
  creator?: string;
  title: string;
  description: string;
  image: string;
}) => {
  return () => (
    <Head>
      <meta name="twitter:card" content={props.card || 'summary_large_image'} />
      {props.site && <meta name="twitter:site" content={props.site} />}
      {props.creator && <meta name="twitter:creator" content={props.creator} />}
      <meta name="twitter:title" content={props.title} />
      <meta name="twitter:description" content={props.description} />
      <meta name="twitter:image" content={props.image} />
    </Head>
  );
});
```

## Performance

Page speed is a ranking factor.

### Core Web Vitals

```typescript
/**
 * Core Web Vitals Targets:
 *
 * LCP (Largest Contentful Paint): < 2.5s
 * FID (First Input Delay): < 100ms
 * CLS (Cumulative Layout Shift): < 0.1
 * INP (Interaction to Next Paint): < 200ms
 * TTFB (Time to First Byte): < 600ms
 */

// Track Core Web Vitals
import { onLCP, onFID, onCLS } from 'web-vitals';

onLCP((metric) => {
  // Send to analytics
  sendToAnalytics({ name: 'LCP', value: metric.value });
});

onFID((metric) => {
  sendToAnalytics({ name: 'FID', value: metric.value });
});

onCLS((metric) => {
  sendToAnalytics({ name: 'CLS', value: metric.value });
});
```

### Optimization Techniques

```typescript
// 1. Code splitting
const Dashboard = lazy(() => import('./routes/Dashboard'));

// 2. Image optimization
<img
  src="/hero.jpg"
  alt="Hero image"
  loading="lazy"
  width="1200"
  height="630"
/>

// 3. Preload critical resources
<link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin />

// 4. Prefetch next page
<link rel="prefetch" href="/about" />

// 5. CDN for static assets
const cdnUrl = 'https://cdn.example.com';

// 6. Minimize render-blocking resources
<link rel="stylesheet" href="/styles.css" media="print" onload="this.media='all'" />
```

## Mobile Optimization

Mobile-first is essential for SEO.

### Responsive Meta Tag

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

### Mobile-Friendly Design

```typescript
// Responsive layout
const styles = css({
  '.container': {
    padding: '1rem',

    '@media (min-width: 768px)': {
      padding: '2rem'
    }
  },

  '.grid': {
    display: 'grid',
    gridTemplateColumns: '1fr',

    '@media (min-width: 768px)': {
      gridTemplateColumns: 'repeat(2, 1fr)'
    },

    '@media (min-width: 1024px)': {
      gridTemplateColumns: 'repeat(3, 1fr)'
    }
  }
});

// Touch-friendly buttons
const buttonStyles = css({
  button: {
    minHeight: '44px', // Minimum touch target size
    minWidth: '44px',
    padding: '0.75rem 1.5rem'
  }
});
```

### Mobile Performance

```typescript
// Reduce JavaScript for mobile
if (window.innerWidth < 768) {
  // Load minimal version
} else {
  // Load full version
}

// Adaptive loading
import { useNetworkStatus } from '@aether/hooks';

const { effectiveType } = useNetworkStatus();

// Load lower quality images on slow connections
const imageQuality = effectiveType === '4g' ? 'high' : 'low';
```

## Accessibility

Accessibility improves SEO.

### Semantic HTML

```html
<!-- ✅ Good - Semantic -->
<header>
  <nav>
    <ul>
      <li><a href="/">Home</a></li>
    </ul>
  </nav>
</header>

<main>
  <article>
    <h1>Article Title</h1>
    <p>Content...</p>
  </article>
</main>

<footer>
  <p>&copy; 2024</p>
</footer>

<!-- ❌ Bad - Non-semantic -->
<div class="header">
  <div class="nav">
    <div class="link"><a href="/">Home</a></div>
  </div>
</div>
```

### Alt Text

```html
<!-- ✅ Good - Descriptive alt text -->
<img src="/product.jpg" alt="Blue running shoes with white sole">

<!-- ❌ Bad - Generic alt text -->
<img src="/product.jpg" alt="image">
<img src="/product.jpg" alt="">
```

## Content Optimization

Quality content ranks better.

### Heading Hierarchy

```html
<!-- ✅ Good - Proper hierarchy -->
<h1>Main Page Title</h1>
<h2>Section 1</h2>
<h3>Subsection 1.1</h3>
<h3>Subsection 1.2</h3>
<h2>Section 2</h2>

<!-- ❌ Bad - Skipping levels -->
<h1>Main Page Title</h1>
<h3>Section 1</h3> <!-- Skipped h2 -->
```

### Content Length

```typescript
/**
 * Content Guidelines:
 *
 * - Minimum 300 words for blog posts
 * - 1000+ words for cornerstone content
 * - Focus on quality over quantity
 * - Answer user intent
 * - Use natural language
 * - Include keywords naturally
 */
```

### Internal Linking

```typescript
// Link to related content
<article>
  <h1>Getting Started with Aether</h1>
  <p>
    Before you begin, check out our
    <a href="/docs/installation">installation guide</a> and
    <a href="/docs/concepts">core concepts</a>.
  </p>
</article>
```

## URL Structure

Clean, descriptive URLs are better.

### URL Best Practices

```typescript
/**
 * URL Guidelines:
 *
 * ✅ Good:
 * - /blog/getting-started-with-nexus
 * - /products/running-shoes
 * - /docs/components/button
 *
 * ❌ Bad:
 * - /page?id=123
 * - /p/abc123xyz
 * - /blog/2024/01/15/post-123
 *
 * Rules:
 * - Use hyphens, not underscores
 * - Lowercase letters
 * - No special characters
 * - Descriptive and concise
 * - Include keywords
 * - Logical hierarchy
 */
```

### URL Parameters

```typescript
// Avoid URLs with many parameters
// ❌ Bad
/search?q=shoes&color=blue&size=10&sort=price&order=asc

// ✅ Better - use path segments
/search/shoes/blue/size-10/price-asc

// Or use URL-friendly structure
/shoes?filter=blue,size-10&sort=price
```

## Canonical URLs

Prevent duplicate content issues.

### Canonical Tag

```html
<!-- Self-referencing canonical -->
<link rel="canonical" href="https://example.com/page">

<!-- Canonical to different URL (if duplicates exist) -->
<link rel="canonical" href="https://example.com/original-page">
```

```typescript
export const CanonicalURL = defineComponent((props: {
  url: string;
}) => {
  return () => (
    <Head>
      <link rel="canonical" href={props.url} />
    </Head>
  );
});

// Usage
<CanonicalURL url="https://example.com/blog/post" />
```

### Pagination

```html
<!-- For paginated content -->
<link rel="canonical" href="https://example.com/blog">
<link rel="prev" href="https://example.com/blog?page=1">
<link rel="next" href="https://example.com/blog?page=3">
```

## Image Optimization

Optimize images for SEO and performance.

### Image Best Practices

```html
<!-- Descriptive filename -->
<!-- ✅ --> <img src="/blue-running-shoes.jpg" alt="Blue running shoes">
<!-- ❌ --> <img src="/img_1234.jpg" alt="Shoes">

<!-- Alt text -->
<img src="/product.jpg" alt="Blue Nike Air Max running shoes size 10">

<!-- Dimensions to prevent CLS -->
<img src="/hero.jpg" alt="Hero" width="1200" height="630">

<!-- Lazy loading -->
<img src="/below-fold.jpg" alt="Content" loading="lazy">

<!-- Responsive images -->
<img
  src="/image-800.jpg"
  srcset="
    /image-400.jpg 400w,
    /image-800.jpg 800w,
    /image-1200.jpg 1200w
  "
  sizes="(max-width: 600px) 400px, (max-width: 900px) 800px, 1200px"
  alt="Responsive image"
>

<!-- Modern formats -->
<picture>
  <source srcset="/image.avif" type="image/avif">
  <source srcset="/image.webp" type="image/webp">
  <img src="/image.jpg" alt="Fallback image">
</picture>
```

### Image Sitemap

```xml
<!-- Image sitemap for better indexing -->
<url>
  <loc>https://example.com/page</loc>
  <image:image>
    <image:loc>https://example.com/image.jpg</image:loc>
    <image:caption>Image caption</image:caption>
    <image:title>Image title</image:title>
  </image:image>
</url>
```

## SSR for SEO

Server-side rendering is crucial for SEO.

### SSR Benefits

```typescript
/**
 * Why SSR is important for SEO:
 *
 * 1. Content is immediately available
 *    - No JavaScript execution needed
 *    - Search engines can read content
 *
 * 2. Faster initial page load
 *    - Better Core Web Vitals
 *    - Improved user experience
 *
 * 3. Social media previews
 *    - OG tags are rendered
 *    - Proper preview cards
 *
 * 4. Accessibility
 *    - Works without JavaScript
 *    - Progressive enhancement
 */
```

### SSR Implementation

```typescript
// server.ts
export const render = async (url: string) => {
  // Fetch data
  const data = await fetchData(url);

  // Render with data
  const html = renderToString(() => (
    <App initialData={data} />
  ));

  // Include meta tags
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.title}</title>
  <meta name="description" content="${data.description}">
  <meta property="og:title" content="${data.title}">
  <meta property="og:description" content="${data.description}">
  <meta property="og:image" content="${data.image}">
  <link rel="canonical" href="${data.url}">
</head>
<body>
  <div id="app">${html}</div>
  <script>window.__INITIAL_DATA__ = ${JSON.stringify(data)}</script>
  <script src="/client.js"></script>
</body>
</html>
  `;
};
```

## Indexing

Control what gets indexed.

### Meta Robots

```html
<!-- Index and follow links -->
<meta name="robots" content="index, follow">

<!-- Don't index this page -->
<meta name="robots" content="noindex, nofollow">

<!-- Index but don't follow links -->
<meta name="robots" content="index, nofollow">

<!-- Index but don't show cached version -->
<meta name="robots" content="index, noarchive">

<!-- Google-specific -->
<meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large">
```

### X-Robots-Tag Header

```typescript
// Server-side robots control
app.get('/private/*', (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
```

## Analytics

Track SEO performance.

### Google Search Console

```html
<!-- Verify ownership -->
<meta name="google-site-verification" content="your-verification-code">
```

```typescript
// Submit sitemap via API
import { google } from 'googleapis';

const webmasters = google.webmasters('v3');

await webmasters.sitemaps.submit({
  siteUrl: 'https://example.com',
  feedpath: 'https://example.com/sitemap.xml'
});
```

### Track Rankings

```typescript
// Monitor keyword rankings
export const trackRankings = async () => {
  const keywords = ['nexus framework', 'typescript framework'];

  for (const keyword of keywords) {
    const position = await getSearchPosition(keyword, 'example.com');
    await db.ranking.create({
      data: {
        keyword,
        position,
        date: new Date()
      }
    });
  }
};
```

## Best Practices

### SEO Checklist

```typescript
/**
 * Pre-Launch SEO Checklist:
 *
 * Technical:
 * [ ] HTTPS enabled
 * [ ] Mobile-friendly
 * [ ] Fast page speed (< 3s)
 * [ ] No broken links
 * [ ] Clean URL structure
 * [ ] XML sitemap
 * [ ] Robots.txt
 * [ ] 301 redirects for moved pages
 *
 * On-Page:
 * [ ] Unique titles (< 60 chars)
 * [ ] Unique descriptions (< 160 chars)
 * [ ] H1 on every page
 * [ ] Proper heading hierarchy
 * [ ] Alt text on images
 * [ ] Internal linking
 * [ ] Canonical URLs
 *
 * Content:
 * [ ] Quality, original content
 * [ ] Target keywords
 * [ ] Answer user intent
 * [ ] Regular updates
 *
 * Social:
 * [ ] Open Graph tags
 * [ ] Twitter Card tags
 * [ ] Social sharing buttons
 *
 * Analytics:
 * [ ] Google Analytics installed
 * [ ] Search Console verified
 * [ ] Tracking conversions
 */
```

## Examples

### Complete SEO Component

```typescript
// SEO.tsx - Reusable SEO component
export const SEO = defineComponent((props: {
  title: string;
  description: string;
  keywords?: string;
  image?: string;
  url: string;
  type?: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
}) => {
  const siteName = '(Aether)';
  const twitterHandle = '@nexus';

  const fullTitle = `${props.title} | ${siteName}`;
  const imageUrl = props.image || 'https://example.com/default-og.jpg';

  return () => (
    <Head>
      {/* Basic meta tags */}
      <title>{fullTitle}</title>
      <meta name="description" content={props.description} />
      {props.keywords && <meta name="keywords" content={props.keywords} />}
      {props.author && <meta name="author" content={props.author} />}

      {/* Canonical URL */}
      <link rel="canonical" href={props.url} />

      {/* Open Graph */}
      <meta property="og:type" content={props.type || 'website'} />
      <meta property="og:url" content={props.url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={props.description} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:site_name" content={siteName} />
      {props.publishedTime && (
        <meta property="article:published_time" content={props.publishedTime} />
      )}
      {props.modifiedTime && (
        <meta property="article:modified_time" content={props.modifiedTime} />
      )}

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={twitterHandle} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={props.description} />
      <meta name="twitter:image" content={imageUrl} />
    </Head>
  );
});

// Usage
export default defineComponent(() => {
  return () => (
    <>
      <SEO
        title="Getting Started"
        description="Learn how to build amazing apps with Aether framework"
        keywords="nexus, tutorial, guide"
        url="https://example.com/docs/getting-started"
        type="article"
        publishedTime="2024-01-15T00:00:00Z"
      />
      <Article />
    </>
  );
});
```

### Blog Post with Full SEO

```typescript
export const BlogPost = defineComponent((props: { slug: string }) => {
  const [post] = resource(() => props.slug, fetchPost);

  return () => (
    <Show when={post()}>
      {/* SEO */}
      <SEO
        title={post()!.title}
        description={post()!.excerpt}
        url={`https://example.com/blog/${post()!.slug}`}
        type="article"
        image={post()!.coverImage}
        publishedTime={post()!.publishedAt}
        modifiedTime={post()!.updatedAt}
      />

      {/* Structured data */}
      <Head>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: post()!.title,
            description: post()!.excerpt,
            image: post()!.coverImage,
            author: {
              '@type': 'Person',
              name: post()!.author.name
            },
            datePublished: post()!.publishedAt,
            dateModified: post()!.updatedAt
          })}
        </script>
      </Head>

      {/* Content */}
      <article>
        <h1>{post()!.title}</h1>
        <div innerHTML={post()!.content} />
      </article>
    </Show>
  );
});
```

## Summary

SEO is essential for discoverability:

1. **Meta Tags**: Unique titles and descriptions
2. **Structured Data**: Schema.org for rich snippets
3. **Sitemaps**: XML sitemaps for indexing
4. **Robots.txt**: Control crawling
5. **Open Graph**: Optimize social sharing
6. **Performance**: Core Web Vitals matter
7. **Mobile**: Mobile-first is essential
8. **Accessibility**: Improves SEO
9. **Content**: Quality content ranks better
10. **URLs**: Clean, descriptive URLs
11. **Images**: Optimize and add alt text
12. **SSR**: Critical for crawlability
13. **Analytics**: Track and improve

Build discoverable apps with Aether SEO.
