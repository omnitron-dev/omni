/**
 * MDX Runtime Components
 *
 * Built-in components for MDX rendering with Aether integration
 */

import { defineComponent } from '../../core/component/define.js';
import { signal, computed } from '../../core/reactivity/index.js';
import { jsx } from '../../jsx-runtime.js';
import { Code } from '../../primitives/Code.js';
import type { Component } from '../types.js';

/**
 * Props for MDX heading components
 */
interface HeadingProps {
  children?: any;
  id?: string;
  className?: string;
  [key: string]: any;
}

/**
 * Create heading component with anchor link support
 */
function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6): Component<HeadingProps> {
  const Tag = `h${level}` as const;

  return defineComponent<HeadingProps>((props) => {
    const { children, id, className, ...restProps } = props;

    // Add anchor link behavior
    const handleAnchorClick = (e: MouseEvent) => {
      if (id && e.target === e.currentTarget) {
        // Update URL hash
        if (typeof window !== 'undefined') {
          window.location.hash = id;
        }
      }
    };

    return () => jsx(Tag, {
      ...restProps,
      id,
      class: `mdx-h${level} ${className || ''}`,
      onClick: handleAnchorClick,
      children: [
        // Anchor link icon (optional)
        id && jsx('a', {
          href: `#${id}`,
          class: 'mdx-anchor',
          'aria-label': `Link to ${id}`,
          children: '#'
        }),
        children
      ]
    });
  });
}

/**
 * MDX heading components
 */
export const H1 = createHeading(1);
export const H2 = createHeading(2);
export const H3 = createHeading(3);
export const H4 = createHeading(4);
export const H5 = createHeading(5);
export const H6 = createHeading(6);

/**
 * MDX Code Block with syntax highlighting support
 */
export const MDXCodeBlock = defineComponent<{
  children: string;
  language?: string;
  filename?: string;
  highlight?: string;
  showLineNumbers?: boolean;
}>((props) => {
  const copied = signal(false);
  const codeRef = signal<HTMLElement | null>(null);

  const handleCopy = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(props.children);
      copied.set(true);
      setTimeout(() => copied.set(false), 2000);
    }
  };

  // Parse highlighted lines
  const highlightedLines = computed(() => {
    if (!props.highlight) return new Set<number>();

    const lines = new Set<number>();
    const ranges = props.highlight.split(',');

    for (const range of ranges) {
      if (range.includes('-')) {
        const parts = range.split('-').map(Number);
        const start = parts[0];
        const end = parts[1];
        if (start !== undefined && end !== undefined) {
          for (let i = start; i <= end; i++) {
            lines.add(i);
          }
        }
      } else {
        lines.add(Number(range));
      }
    }

    return lines;
  });

  return () => jsx('div', {
    class: 'mdx-code-block',
    children: [
      // Header with filename and copy button (always show header for copy button)
      jsx('div', {
        class: 'mdx-code-header',
        children: [
          props.filename && jsx('span', {
            class: 'mdx-code-filename',
            children: props.filename
          }),
          jsx('button', {
            class: 'mdx-code-copy',
            onClick: handleCopy,
            'aria-label': copied() ? 'Copied!' : 'Copy code',
            children: copied() ? '✓ Copied' : '📋 Copy'
          })
        ]
      }),
      // Code content
      jsx(Code, {
        block: true,
        language: props.language,
        ref: codeRef,
        'data-highlight': props.highlight,
        'data-line-numbers': props.showLineNumbers,
        children: props.children
      })
    ]
  });
});

/**
 * MDX Link component with external link detection
 */
export const MDXLink = defineComponent<{
  href: string;
  children?: any;
  [key: string]: any;
}>((props) => {
  const { href, children, ...restProps } = props;

  const isExternal = computed(() => href.startsWith('http://') || href.startsWith('https://'));

  return () => jsx('a', {
    ...restProps,
    href,
    class: `mdx-link ${isExternal() ? 'mdx-link-external' : 'mdx-link-internal'}`,
    target: isExternal() ? '_blank' : undefined,
    rel: isExternal() ? 'noopener noreferrer' : undefined,
    children: [
      children,
      isExternal() && jsx('span', {
        class: 'mdx-external-icon',
        'aria-label': 'External link',
        children: ' ↗'
      })
    ]
  });
});

/**
 * MDX Image component with lazy loading
 */
export const MDXImage = defineComponent<{
  src: string;
  alt?: string;
  title?: string;
  width?: number | string;
  height?: number | string;
  [key: string]: any;
}>((props) => {
  const { src, alt, title, width, height, ...restProps } = props;
  const loaded = signal(false);
  const error = signal(false);

  return () => jsx('figure', {
    class: 'mdx-figure',
    children: [
      jsx('img', {
        ...restProps,
        src,
        alt: alt || '',
        width,
        height,
        loading: 'lazy',
        class: `mdx-img ${loaded() ? 'mdx-img-loaded' : ''} ${error() ? 'mdx-img-error' : ''}`,
        onLoad: () => loaded.set(true),
        onError: () => error.set(true)
      }),
      title && jsx('figcaption', {
        class: 'mdx-figcaption',
        children: title
      })
    ]
  });
});

/**
 * MDX Table wrapper with responsive scroll
 */
export const MDXTable = defineComponent<{
  children?: any;
  [key: string]: any;
}>((props) => () => jsx('div', {
    class: 'mdx-table-wrapper',
    children: jsx('table', {
      ...props,
      class: 'mdx-table'
    })
  }));

/**
 * MDX Blockquote with citation support
 */
export const MDXBlockquote = defineComponent<{
  children?: any;
  cite?: string;
  author?: string;
  [key: string]: any;
}>((props) => {
  const { children, cite, author, ...restProps } = props;

  return () => jsx('blockquote', {
    ...restProps,
    class: 'mdx-blockquote',
    cite,
    children: [
      jsx('div', {
        class: 'mdx-blockquote-content',
        children
      }),
      (author || cite) && jsx('footer', {
        class: 'mdx-blockquote-footer',
        children: [
          author && jsx('cite', {
            class: 'mdx-blockquote-author',
            children: `— ${author}`
          }),
          cite && author && ', ',
          cite && jsx('a', {
            href: cite,
            class: 'mdx-blockquote-source',
            children: 'Source'
          })
        ]
      })
    ]
  });
});

/**
 * MDX Alert/Callout component
 */
export const MDXAlert = defineComponent<{
  type?: 'info' | 'warning' | 'error' | 'success' | 'note';
  title?: string;
  children?: any;
}>((props) => {
  const type = props.type || 'info';

  const icons = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
    success: '✅',
    note: '📝'
  };

  return () => jsx('div', {
    class: `mdx-alert mdx-alert-${type}`,
    role: 'alert',
    children: [
      jsx('div', {
        class: 'mdx-alert-header',
        children: [
          jsx('span', {
            class: 'mdx-alert-icon',
            children: icons[type]
          }),
          jsx('span', {
            class: 'mdx-alert-title',
            children: props.title || type.charAt(0).toUpperCase() + type.slice(1)
          })
        ]
      }),
      jsx('div', {
        class: 'mdx-alert-content',
        children: props.children
      })
    ]
  });
});

/**
 * MDX Details/Summary (collapsible content)
 */
export const MDXDetails = defineComponent<{
  summary: string;
  children?: any;
  open?: boolean;
}>((props) => {
  const isOpen = signal(props.open || false);

  return () => jsx('details', {
    class: 'mdx-details',
    open: isOpen(),
    onToggle: (e: any) => isOpen.set(e.target.open),
    children: [
      jsx('summary', {
        class: 'mdx-summary',
        children: props.summary
      }),
      jsx('div', {
        class: 'mdx-details-content',
        children: props.children
      })
    ]
  });
});

/**
 * Collection of all MDX components
 */
export const MDXComponents = {
  // Headings
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H4,
  h5: H5,
  h6: H6,

  // Content
  p: (props: any) => jsx('p', { ...props, class: 'mdx-p' }),
  a: MDXLink,
  img: MDXImage,
  blockquote: MDXBlockquote,

  // Code
  code: Code,
  pre: MDXCodeBlock,

  // Lists
  ul: (props: any) => jsx('ul', { ...props, class: 'mdx-ul' }),
  ol: (props: any) => jsx('ol', { ...props, class: 'mdx-ol' }),
  li: (props: any) => jsx('li', { ...props, class: 'mdx-li' }),

  // Tables
  table: MDXTable,
  thead: (props: any) => jsx('thead', { ...props, class: 'mdx-thead' }),
  tbody: (props: any) => jsx('tbody', { ...props, class: 'mdx-tbody' }),
  tr: (props: any) => jsx('tr', { ...props, class: 'mdx-tr' }),
  th: (props: any) => jsx('th', { ...props, class: 'mdx-th' }),
  td: (props: any) => jsx('td', { ...props, class: 'mdx-td' }),

  // Special components
  Alert: MDXAlert,
  Details: MDXDetails,

  // Layout
  hr: () => jsx('hr', { class: 'mdx-hr' }),
  br: () => jsx('br', {})
};