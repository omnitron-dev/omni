/**
 * Head/Meta Tag Management
 *
 * Comprehensive head tag management for SSR/SSG:
 * - Server-side head rendering
 * - Dynamic client-side updates
 * - Open Graph and Twitter Cards
 * - Structured data (JSON-LD)
 * - SEO optimization
 */

import type { HeadContext, MetaTag, LinkTag, ScriptTag, StyleTag, MetaTags } from './types.js';

/**
 * Global head context
 */
let currentHeadContext: HeadContext | null = null;

/**
 * Get current head context
 */
export function getHeadContext(): HeadContext | null {
  return currentHeadContext;
}

/**
 * Create head context
 */
export function createHeadContext(): HeadContext {
  return {
    title: undefined,
    meta: [],
    links: [],
    scripts: [],
    styles: [],
  };
}

/**
 * Set head context
 */
export function setHeadContext(context: HeadContext | null): void {
  currentHeadContext = context;
}

/**
 * Render head tags to HTML
 *
 * Generates complete <head> content from collected meta tags.
 * Use during SSR to inject proper meta tags.
 *
 * @param context - Head context with collected tags
 * @returns HTML string for <head> section
 *
 * @example
 * ```typescript
 * const context = createHeadContext();
 * collectMeta(context, {
 *   title: 'My Page',
 *   description: 'Page description',
 *   ogImage: '/og-image.jpg'
 * });
 *
 * const headHTML = renderHead(context);
 * // <title>My Page</title><meta name="description" content="...">
 * ```
 */
export function renderHead(context: HeadContext = currentHeadContext || createHeadContext()): string {
  const parts: string[] = [];

  // Title
  if (context.title) {
    parts.push(`<title>${escapeHTML(context.title)}</title>`);
  }

  // Meta tags
  for (const meta of context.meta) {
    parts.push(renderMetaTag(meta));
  }

  // Link tags
  for (const link of context.links) {
    parts.push(renderLinkTag(link));
  }

  // Style tags
  for (const style of context.styles) {
    parts.push(renderStyleTag(style));
  }

  // Script tags
  for (const script of context.scripts) {
    parts.push(renderScriptTag(script));
  }

  return parts.join('\n');
}

/**
 * Collect meta tags from component
 *
 * Gathers meta tags during rendering for SSR.
 * Call this from components that need to set meta tags.
 *
 * @param context - Head context
 * @param meta - Meta tags to collect
 *
 * @example
 * ```typescript
 * function BlogPost({ post }) {
 *   const context = getHeadContext();
 *   if (context) {
 *     collectMeta(context, {
 *       title: post.title,
 *       description: post.excerpt,
 *       ogImage: post.coverImage,
 *       ogType: 'article'
 *     });
 *   }
 *
 *   return <article>...</article>;
 * }
 * ```
 */
export function collectMeta(context: HeadContext, meta: MetaTags): void {
  // Set title (allow empty strings)
  if (meta.title !== undefined) {
    context.title = meta.title;
  }

  // Standard meta tags
  if (meta.description) {
    context.meta.push({
      name: 'description',
      content: meta.description,
    });
  }

  // Open Graph tags
  if (meta.ogTitle || meta.title) {
    context.meta.push({
      property: 'og:title',
      content: meta.ogTitle || meta.title!,
    });
  }

  if (meta.ogDescription || meta.description) {
    context.meta.push({
      property: 'og:description',
      content: meta.ogDescription || meta.description!,
    });
  }

  if (meta.ogImage) {
    context.meta.push({
      property: 'og:image',
      content: meta.ogImage,
    });
  }

  // Canonical URL
  if (meta.canonical) {
    context.links.push({
      rel: 'canonical',
      href: meta.canonical,
    });
  }

  // Custom meta tags
  for (const [key, value] of Object.entries(meta)) {
    if (!['title', 'description', 'ogTitle', 'ogDescription', 'ogImage', 'canonical'].includes(key)) {
      if (value) {
        // Twitter and OG tags use property attribute
        if (key.startsWith('og:') || key.startsWith('twitter:')) {
          context.meta.push({
            property: key,
            content: value,
          });
        } else {
          context.meta.push({
            name: key,
            content: value,
          });
        }
      }
    }
  }
}

/**
 * Inject meta tags into HTML document
 *
 * Modifies HTML to include meta tags in <head>.
 * Use after rendering to inject collected meta tags.
 *
 * @param html - HTML document
 * @param context - Head context
 * @returns HTML with injected meta tags
 *
 * @example
 * ```typescript
 * const result = await renderToString(App);
 * const headContext = getHeadContext();
 * const finalHTML = injectMeta(result.html, headContext);
 * ```
 */
export function injectMeta(html: string, context: HeadContext): string {
  const headTags = renderHead(context);

  // Find </head> and inject before it
  const headCloseIndex = html.indexOf('</head>');
  if (headCloseIndex !== -1) {
    return html.slice(0, headCloseIndex) + headTags + html.slice(headCloseIndex);
  }

  // If no </head>, try to inject after <head>
  const headOpenIndex = html.indexOf('<head>');
  if (headOpenIndex !== -1) {
    const insertPos = headOpenIndex + 6; // length of '<head>'
    return html.slice(0, insertPos) + '\n' + headTags + html.slice(insertPos);
  }

  // No <head> found, return as-is
  console.warn('No <head> tag found in HTML');
  return html;
}

/**
 * Update meta tags on client
 *
 * Dynamically updates <head> meta tags in the browser.
 * Use for client-side navigation and dynamic content.
 *
 * @param meta - Meta tags to update
 *
 * @example
 * ```typescript
 * // Update meta tags when navigating
 * router.on('navigate', ({ route }) => {
 *   updateMeta({
 *     title: route.meta?.title || 'Default Title',
 *     description: route.meta?.description
 *   });
 * });
 * ```
 */
export function updateMeta(meta: MetaTags): void {
  if (typeof document === 'undefined') {
    console.warn('updateMeta called in non-browser environment');
    return;
  }

  // Update title
  if (meta.title) {
    document.title = meta.title;
  }

  // Update or create meta tags
  updateMetaTag('name', 'description', meta.description);
  updateMetaTag('property', 'og:title', meta.ogTitle || meta.title);
  updateMetaTag('property', 'og:description', meta.ogDescription || meta.description);
  updateMetaTag('property', 'og:image', meta.ogImage);

  // Update canonical
  if (meta.canonical) {
    updateLinkTag('canonical', meta.canonical);
  }

  // Update custom tags
  for (const [key, value] of Object.entries(meta)) {
    if (!['title', 'description', 'ogTitle', 'ogDescription', 'ogImage', 'canonical'].includes(key) && value) {
      if (key.startsWith('og:') || key.startsWith('twitter:')) {
        updateMetaTag('property', key, value);
      } else {
        updateMetaTag('name', key, value);
      }
    }
  }
}

/**
 * Update or create meta tag
 */
function updateMetaTag(attr: 'name' | 'property', key: string, value?: string): void {
  if (!value) return;

  const selector = `meta[${attr}="${key}"]`;
  let tag = document.querySelector(selector) as HTMLMetaElement;

  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }

  tag.setAttribute('content', value);
}

/**
 * Update or create link tag
 */
function updateLinkTag(rel: string, href: string): void {
  const selector = `link[rel="${rel}"]`;
  let tag = document.querySelector(selector) as HTMLLinkElement;

  if (!tag) {
    tag = document.createElement('link');
    tag.rel = rel;
    document.head.appendChild(tag);
  }

  tag.href = href;
}

/**
 * Render meta tag to HTML
 */
function renderMetaTag(meta: MetaTag): string {
  const attrs: string[] = [];

  if (meta.name) {
    attrs.push(`name="${escapeHTML(meta.name)}"`);
  }

  if (meta.property) {
    attrs.push(`property="${escapeHTML(meta.property)}"`);
  }

  attrs.push(`content="${escapeHTML(meta.content)}"`);

  // Add other attributes
  for (const [key, value] of Object.entries(meta)) {
    if (key !== 'name' && key !== 'property' && key !== 'content' && value) {
      attrs.push(`${key}="${escapeHTML(String(value))}"`);
    }
  }

  return `<meta ${attrs.join(' ')}>`;
}

/**
 * Render link tag to HTML
 */
function renderLinkTag(link: LinkTag): string {
  const attrs: string[] = [`rel="${escapeHTML(link.rel)}"`, `href="${escapeHTML(link.href)}"`];

  // Add other attributes
  for (const [key, value] of Object.entries(link)) {
    if (key !== 'rel' && key !== 'href' && value) {
      attrs.push(`${key}="${escapeHTML(String(value))}"`);
    }
  }

  return `<link ${attrs.join(' ')}>`;
}

/**
 * Render script tag to HTML
 */
function renderScriptTag(script: ScriptTag): string {
  const attrs: string[] = [];

  if (script.type) {
    attrs.push(`type="${escapeHTML(script.type)}"`);
  }

  if (script.src) {
    attrs.push(`src="${escapeHTML(script.src)}"`);
  }

  if (script.async) {
    attrs.push('async');
  }

  if (script.defer) {
    attrs.push('defer');
  }

  // Add other attributes
  for (const [key, value] of Object.entries(script)) {
    if (!['type', 'src', 'async', 'defer', 'content'].includes(key) && value) {
      if (typeof value === 'boolean') {
        attrs.push(key);
      } else {
        attrs.push(`${key}="${escapeHTML(String(value))}"`);
      }
    }
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  const content = script.content || '';

  return `<script${attrStr}>${content}</script>`;
}

/**
 * Render style tag to HTML
 */
function renderStyleTag(style: StyleTag): string {
  const attrs: string[] = [];

  // Add other attributes
  for (const [key, value] of Object.entries(style)) {
    if (key !== 'content' && value) {
      attrs.push(`${key}="${escapeHTML(String(value))}"`);
    }
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  return `<style${attrStr}>${style.content}</style>`;
}

/**
 * Create Open Graph meta tags
 *
 * Convenience function for creating OG tags.
 *
 * @param og - Open Graph data
 * @returns Meta tags
 *
 * @example
 * ```typescript
 * const ogTags = createOpenGraphTags({
 *   title: 'Article Title',
 *   description: 'Article description',
 *   image: '/og-image.jpg',
 *   type: 'article',
 *   url: 'https://example.com/article'
 * });
 * ```
 */
export function createOpenGraphTags(og: {
  title: string;
  description?: string;
  image?: string;
  type?: string;
  url?: string;
  siteName?: string;
}): MetaTags {
  return {
    ogTitle: og.title,
    ogDescription: og.description,
    ogImage: og.image,
    'og:type': og.type || 'website',
    'og:url': og.url,
    'og:site_name': og.siteName,
  };
}

/**
 * Create Twitter Card meta tags
 *
 * Convenience function for creating Twitter Card tags.
 *
 * @param twitter - Twitter Card data
 * @returns Meta tags
 *
 * @example
 * ```typescript
 * const twitterTags = createTwitterCardTags({
 *   card: 'summary_large_image',
 *   title: 'Article Title',
 *   description: 'Article description',
 *   image: '/twitter-image.jpg',
 *   creator: '@username'
 * });
 * ```
 */
export function createTwitterCardTags(twitter: {
  card?: 'summary' | 'summary_large_image' | 'app' | 'player';
  title: string;
  description?: string;
  image?: string;
  site?: string;
  creator?: string;
}): MetaTags {
  return {
    'twitter:card': twitter.card || 'summary_large_image',
    'twitter:title': twitter.title,
    'twitter:description': twitter.description,
    'twitter:image': twitter.image,
    'twitter:site': twitter.site,
    'twitter:creator': twitter.creator,
  };
}

/**
 * Create JSON-LD structured data
 *
 * Generates structured data for SEO.
 *
 * @param data - Structured data object
 * @returns Script tag with JSON-LD
 *
 * @example
 * ```typescript
 * const jsonLD = createJSONLD({
 *   '@context': 'https://schema.org',
 *   '@type': 'Article',
 *   headline: 'Article Title',
 *   author: {
 *     '@type': 'Person',
 *     name: 'Author Name'
 *   }
 * });
 * ```
 */
export function createJSONLD(data: Record<string, any>): ScriptTag {
  return {
    type: 'application/ld+json',
    content: JSON.stringify(data),
  };
}

/**
 * Escape HTML special characters
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
