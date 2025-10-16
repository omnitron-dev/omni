/**
 * MarkdownPreview component - Renders markdown with syntax highlighting
 *
 * Features:
 * - Reactive rendering (updates when markdown signal changes)
 * - Syntax highlighting using rehype-starry-night
 * - GFM (GitHub Flavored Markdown) support
 * - Custom renderer support
 * - XSS protection with HTML sanitization
 */

import { defineComponent, signal, effect, type Signal } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeStarryNight from 'rehype-starry-night';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

/**
 * MarkdownPreview component props
 */
export interface MarkdownPreviewProps {
  /**
   * Markdown content as a signal
   */
  markdown: Signal<string>;

  /**
   * CSS class name
   */
  class?: string;

  /**
   * Custom markdown renderer
   * If provided, this will be used instead of the built-in renderer
   */
  renderer?: (markdown: string) => string;

  /**
   * Enable syntax highlighting
   * @default true
   */
  enableSyntaxHighlight?: boolean;

  /**
   * Enable GFM (GitHub Flavored Markdown)
   * @default true
   */
  enableGFM?: boolean;

  /**
   * Enable heading anchors
   * @default true
   */
  enableHeadingAnchors?: boolean;

  /**
   * Sanitize HTML output
   * @default true
   */
  sanitize?: boolean;
}

/**
 * MarkdownPreview component
 *
 * Renders markdown content with syntax highlighting and GFM support
 *
 * @example
 * ```typescript
 * const markdown = signal('# Hello\n\nThis is **bold** text.');
 *
 * const MyComponent = defineComponent(() => {
 *   return () => jsx(MarkdownPreview, {
 *     markdown,
 *     class: 'markdown-preview',
 *   });
 * });
 * ```
 */
export const MarkdownPreview = defineComponent<MarkdownPreviewProps>((props) => {
  // Default options
  const enableSyntaxHighlight = props.enableSyntaxHighlight !== false;
  const enableGFM = props.enableGFM !== false;
  const enableHeadingAnchors = props.enableHeadingAnchors !== false;
  const sanitize = props.sanitize !== false;

  /**
   * Render markdown to HTML
   */
  const renderMarkdown = async (markdown: string): Promise<string> => {
    // Use custom renderer if provided
    if (props.renderer) {
      return props.renderer(markdown);
    }

    // Build unified processor
    let processor = unified().use(remarkParse);

    // Add GFM support
    if (enableGFM) {
      processor = processor.use(remarkGfm);
    }

    // Convert to HTML
    processor = processor.use(remarkRehype);

    // Add slug IDs to headings
    if (enableHeadingAnchors) {
      processor = processor.use(rehypeSlug);
      processor = processor.use(rehypeAutolinkHeadings, {
        behavior: 'wrap',
      });
    }

    // Add syntax highlighting
    if (enableSyntaxHighlight) {
      processor = processor.use(rehypeStarryNight);
    }

    // Stringify to HTML
    processor = processor.use(rehypeStringify);

    // Process markdown
    const result = await processor.process(markdown);
    let html = String(result);

    // Sanitize HTML to prevent XSS
    if (sanitize) {
      html = sanitizeHTML(html);
    }

    return html;
  };

  /**
   * HTML content signal (updated reactively)
   */
  const htmlContent = signal('');

  /**
   * Effect to update HTML when markdown changes
   */
  effect(() => {
    const markdown = props.markdown();
    if (!markdown) {
      htmlContent.set('');
      return;
    }

    // Render markdown asynchronously
    renderMarkdown(markdown)
      .then((html) => {
        htmlContent.set(html);
      })
      .catch((error) => {
        console.error('Failed to render markdown:', error);
        htmlContent.set('<div class="error">Failed to render markdown</div>');
      });
  });

  /**
   * Component render function
   */
  return () => {
    const className = `markdown-preview ${props.class || ''}`.trim();

    return jsx('div', {
      class: className,
      innerHTML: htmlContent(),
    });
  };
}, 'MarkdownPreview');

/**
 * Sanitize HTML to prevent XSS attacks
 * This is a simple implementation - in production, use a library like DOMPurify
 */
function sanitizeHTML(html: string): string {
  // Basic sanitization - remove potentially dangerous elements and attributes
  // In production, use DOMPurify or similar library

  // Remove script tags
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers
  html = html.replace(/on\w+\s*=\s*"[^"]*"/gi, '');
  html = html.replace(/on\w+\s*=\s*'[^']*'/gi, '');

  // Remove javascript: URLs
  html = html.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
  html = html.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");

  // Remove data: URLs (except images)
  html = html.replace(/src\s*=\s*"data:(?!image\/)[^"]*"/gi, 'src=""');
  html = html.replace(/src\s*=\s*'data:(?!image\/)[^']*'/gi, "src=''");

  return html;
}

/**
 * Default CSS styles for markdown preview
 * These can be imported and used in your application
 */
export const markdownPreviewStyles = `
.markdown-preview {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #333;
  max-width: 100%;
}

.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3,
.markdown-preview h4,
.markdown-preview h5,
.markdown-preview h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}

.markdown-preview h1 {
  font-size: 2em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #eee;
}

.markdown-preview h2 {
  font-size: 1.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #eee;
}

.markdown-preview h3 {
  font-size: 1.25em;
}

.markdown-preview p {
  margin-top: 0;
  margin-bottom: 16px;
}

.markdown-preview a {
  color: #0366d6;
  text-decoration: none;
}

.markdown-preview a:hover {
  text-decoration: underline;
}

.markdown-preview code {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: rgba(27, 31, 35, 0.05);
  border-radius: 3px;
  font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
}

.markdown-preview pre {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 3px;
}

.markdown-preview pre code {
  display: inline;
  padding: 0;
  margin: 0;
  overflow: visible;
  line-height: inherit;
  background-color: transparent;
  border: 0;
}

.markdown-preview blockquote {
  padding: 0 1em;
  color: #6a737d;
  border-left: 0.25em solid #dfe2e5;
  margin: 0 0 16px 0;
}

.markdown-preview ul,
.markdown-preview ol {
  padding-left: 2em;
  margin-top: 0;
  margin-bottom: 16px;
}

.markdown-preview li {
  margin-bottom: 0.25em;
}

.markdown-preview table {
  border-spacing: 0;
  border-collapse: collapse;
  margin-bottom: 16px;
  width: 100%;
}

.markdown-preview table th,
.markdown-preview table td {
  padding: 6px 13px;
  border: 1px solid #dfe2e5;
}

.markdown-preview table th {
  font-weight: 600;
  background-color: #f6f8fa;
}

.markdown-preview table tr {
  background-color: #fff;
  border-top: 1px solid #c6cbd1;
}

.markdown-preview table tr:nth-child(2n) {
  background-color: #f6f8fa;
}

.markdown-preview img {
  max-width: 100%;
  height: auto;
}

.markdown-preview hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: #e1e4e8;
  border: 0;
}

.markdown-preview .error {
  color: #d73a49;
  padding: 16px;
  background-color: #ffeef0;
  border: 1px solid #f97583;
  border-radius: 3px;
}
`;
