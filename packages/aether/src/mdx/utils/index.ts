/**
 * MDX Utilities
 *
 * Helper functions for MDX processing and manipulation
 */

import type {
  SanitizeOptions,
  MDXToHTMLOptions,
  ReadingTime,
  ExtractedImage,
  ExtractedLink,
  ValidationResult,
  TOCEntry
} from '../types.js';

/**
 * Sanitize MDX content for security
 */
export function sanitizeMDX(
  source: string,
  options: SanitizeOptions = {}
): string {
  const {
    allowedTags: _allowedTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'em', 'strong'],
    allowedAttributes: _allowedAttributes = { a: ['href', 'target'], code: ['className'] },
    allowedProtocols = ['http', 'https', 'mailto']
  } = options;

  // Basic sanitization - in production use a proper sanitizer
  let sanitized = source;

  // Remove script tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  // Remove data: protocol (unless explicitly allowed)
  if (!allowedProtocols.includes('data')) {
    sanitized = sanitized.replace(/data:/gi, '');
  }

  return sanitized;
}

/**
 * Validate MDX content
 */
export function validateMDX(source: string): ValidationResult {
  const errors: ValidationResult['errors'] = [];

  try {
    // Check for unclosed JSX tags
    const jsxTagRegex = /<(\w+)(?:\s[^>]*)?>/g;
    const openTags: Array<{ tag: string; line: number }> = [];
    const lines = source.split('\n');

    lines.forEach((line, lineIndex) => {
      let match;
      while ((match = jsxTagRegex.exec(line)) !== null) {
        const tag = match[1];
        if (!tag) continue;

        // Check if it's a self-closing tag
        if (match[0].endsWith('/>')) continue;

        // Check for closing tag
        const closeTagRegex = new RegExp(`</${tag}>`, 'g');
        if (!closeTagRegex.test(line.substring(match.index + match[0].length))) {
          openTags.push({ tag, line: lineIndex + 1 });
        }
      }
    });

    // Check for unmatched opening tags
    for (const { tag, line } of openTags) {
      const closeTagRegex = new RegExp(`</${tag}>`, 'g');
      if (!closeTagRegex.test(source)) {
        errors.push({
          line,
          column: 0,
          message: `Unclosed JSX tag: <${tag}>`,
          severity: 'error'
        });
      }
    }

    // Check for unmatched braces
    let braceCount = 0;
    lines.forEach((line, lineIndex) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '{' && (i === 0 || line[i - 1] !== '\\')) {
          braceCount++;
        } else if (line[i] === '}' && (i === 0 || line[i - 1] !== '\\')) {
          braceCount--;
        }

        if (braceCount < 0) {
          errors.push({
            line: lineIndex + 1,
            column: i + 1,
            message: 'Unmatched closing brace }',
            severity: 'error'
          });
          braceCount = 0; // Reset to continue checking
        }
      }
    });

    if (braceCount > 0) {
      const lastLine = lines[lines.length - 1];
      errors.push({
        line: lines.length,
        column: lastLine ? lastLine.length : 0,
        message: `${braceCount} unclosed brace(s) {`,
        severity: 'error'
      });
    }

    // Check for invalid frontmatter
    if (source.startsWith('---')) {
      const frontmatterEnd = source.indexOf('---', 3);
      if (frontmatterEnd === -1) {
        errors.push({
          line: 1,
          column: 1,
          message: 'Unclosed frontmatter block',
          severity: 'error'
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    return {
      valid: false,
      errors: [{
        line: 0,
        column: 0,
        message: `Validation error: ${error}`,
        severity: 'error'
      }]
    };
  }
}

/**
 * Transform MDX to HTML (simplified)
 */
export function mdxToHTML(
  source: string,
  options: MDXToHTMLOptions = {}
): string {
  let html = source;

  // Convert markdown headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Convert markdown bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Convert markdown links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Convert markdown code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Convert line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = `<p>${html}</p>`;

  // Sanitize if requested
  if (options.sanitize) {
    html = sanitizeMDX(html);
  }

  return html;
}

/**
 * Transform MDX to plain text
 */
export function mdxToPlainText(source: string): string {
  let text = source;

  // Remove frontmatter
  if (text.startsWith('---')) {
    const frontmatterEnd = text.indexOf('---', 3);
    if (frontmatterEnd !== -1) {
      text = text.substring(frontmatterEnd + 3).trim();
    }
  }

  // Remove JSX components
  text = text.replace(/<[A-Z][^>]*>(.*?)<\/[A-Z][^>]*>/gs, '$1');

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Remove code blocks markers
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove inline code markers
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove markdown formatting
  text = text.replace(/\*\*(.+?)\*\*/g, '$1'); // Bold
  text = text.replace(/\*(.+?)\*/g, '$1'); // Italic
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Links
  text = text.replace(/^[#]+\s/gm, ''); // Headers

  // Remove JSX expressions
  text = text.replace(/\{[^}]*\}/g, '');

  // Clean up extra whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

/**
 * Calculate reading time for MDX content
 */
export function calculateReadingTime(source: string): ReadingTime {
  const wordsPerMinute = 200; // Average reading speed

  // Convert to plain text first
  const plainText = mdxToPlainText(source);

  // Count words
  const words = plainText
    .split(/\s+/)
    .filter(word => word.length > 0)
    .length;

  // Calculate time
  const minutes = Math.ceil(words / wordsPerMinute);
  const time = minutes * 60 * 1000; // in milliseconds, based on rounded minutes

  return { minutes, words, time };
}

/**
 * Extract images from MDX content
 */
export function extractImages(source: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];

  // Markdown image syntax ![alt](src "title")
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+?)(?:\s+"([^"]*)")?\)/g;
  let match;

  while ((match = markdownImageRegex.exec(source)) !== null) {
    const src = match[2];
    if (!src) continue;

    images.push({
      src,
      alt: match[1] || undefined,
      title: match[3] || undefined
    });
  }

  // JSX img tags
  const jsxImageRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((match = jsxImageRegex.exec(source)) !== null) {
    const src = match[1];
    if (!src) continue;

    // Extract alt
    const altMatch = match[0].match(/alt=["']([^"']+)["']/i);
    const alt = altMatch ? altMatch[1] : undefined;

    // Extract title
    const titleMatch = match[0].match(/title=["']([^"']+)["']/i);
    const title = titleMatch ? titleMatch[1] : undefined;

    images.push({ src, alt, title });
  }

  // Remove duplicates
  const uniqueImages = images.filter(
    (img, index, self) =>
      index === self.findIndex(i => i.src === img.src)
  );

  return uniqueImages;
}

/**
 * Extract links from MDX content
 */
export function extractLinks(source: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];

  // Markdown link syntax [text](href)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = markdownLinkRegex.exec(source)) !== null) {
    const href = match[2];
    const text = match[1];
    if (!href || !text) continue;

    const external = href.startsWith('http://') || href.startsWith('https://');

    links.push({ href, text, external });
  }

  // JSX anchor tags
  const jsxLinkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  while ((match = jsxLinkRegex.exec(source)) !== null) {
    const href = match[1];
    const text = match[2];
    if (!href || !text) continue;

    const external = href.startsWith('http://') || href.startsWith('https://');

    links.push({ href, text, external });
  }

  // Remove duplicates
  const uniqueLinks = links.filter(
    (link, index, self) =>
      index === self.findIndex(l => l.href === link.href && l.text === link.text)
  );

  return uniqueLinks;
}

/**
 * Parse frontmatter from MDX content
 */
export function parseFrontmatter(
  source: string
): { data: Record<string, any>; content: string } {
  if (!source.startsWith('---')) {
    return { data: {}, content: source };
  }

  const frontmatterEnd = source.indexOf('\n---', 3);
  if (frontmatterEnd === -1) {
    return { data: {}, content: source };
  }

  const frontmatterContent = source.substring(4, frontmatterEnd);
  const content = source.substring(frontmatterEnd + 4).trim();

  // Parse YAML-like frontmatter (simplified)
  const data: Record<string, any> = {};
  const lines = frontmatterContent.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();

    // Parse value
    if (value === 'true' || value === 'false') {
      data[key] = value === 'true';
    } else if (/^\d+$/.test(value)) {
      data[key] = parseInt(value, 10);
    } else if (/^\d+\.\d+$/.test(value)) {
      data[key] = parseFloat(value);
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Simple array parsing
      data[key] = value
        .substring(1, value.length - 1)
        .split(',')
        .map(s => s.trim());
    } else {
      // Remove quotes if present
      data[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return { data, content };
}

/**
 * Extract table of contents from MDX content
 */
export function extractTOC(source: string): TOCEntry[] {
  const toc: TOCEntry[] = [];
  const lines = source.split('\n');
  const stack: TOCEntry[] = [];

  for (const line of lines) {
    // Match markdown headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const hashes = headingMatch[1];
      const titleText = headingMatch[2];
      if (!hashes || !titleText) continue;

      const level = hashes.length;
      const title = titleText.trim();
      const id = generateId(title);

      const entry: TOCEntry = {
        level,
        title,
        id,
        children: []
      };

      // Find parent
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        toc.push(entry);
      } else {
        const parent = stack[stack.length - 1]!;
        if (!parent.children) parent.children = [];
        parent.children.push(entry);
      }

      stack.push(entry);
    }
  }

  return toc;
}

/**
 * Generate ID from text (for anchors)
 */
export function generateId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove non-word characters
    .replace(/\s+/g, '-') // Replace spaces with dashes
    .replace(/-+/g, '-') // Replace multiple dashes with single dash
    .replace(/^-|-$/g, '') // Remove leading/trailing dashes
    .trim();
}

/**
 * Highlight text matches in content
 */
export function highlightMatches(
  content: string,
  query: string,
  className: string = 'highlight'
): string {
  if (!query) return content;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');

  return content.replace(regex, `<mark class="${className}">$1</mark>`);
}

/**
 * Truncate MDX content with ellipsis
 */
export function truncateMDX(
  source: string,
  maxLength: number,
  ellipsis: string = '...'
): string {
  const plainText = mdxToPlainText(source);

  if (plainText.length <= maxLength) {
    return source;
  }

  // Find the last complete word within maxLength
  let truncated = plainText.substring(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(' ');

  if (lastSpaceIndex !== -1) {
    truncated = truncated.substring(0, lastSpaceIndex);
  }

  return truncated + ellipsis;
}