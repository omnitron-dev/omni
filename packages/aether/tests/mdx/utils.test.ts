/**
 * MDX Utilities Tests
 */

import { describe, test, expect } from 'vitest';
import {
  sanitizeMDX,
  validateMDX,
  mdxToHTML,
  mdxToPlainText,
  calculateReadingTime,
  extractImages,
  extractLinks,
  parseFrontmatter,
  extractTOC,
  generateId,
  highlightMatches,
  truncateMDX
} from '../../src/mdx/utils/index';

describe('MDX Utilities', () => {
  describe('sanitizeMDX', () => {
    test('should remove script tags', () => {
      const source = 'Text <script>alert("xss")</script> more text';
      const sanitized = sanitizeMDX(source);

      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('alert');
    });

    test('should remove event handlers', () => {
      const source = '<div onclick="alert(1)">Content</div>';
      const sanitized = sanitizeMDX(source);

      expect(sanitized).not.toContain('onclick');
    });

    test('should remove javascript protocol', () => {
      const source = '<a href="javascript:alert(1)">Link</a>';
      const sanitized = sanitizeMDX(source);

      expect(sanitized).not.toContain('javascript:');
    });
  });

  describe('validateMDX', () => {
    test('should validate correct MDX', () => {
      const source = '# Title\n\n<Button>Click</Button>';
      const result = validateMDX(source);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    test('should detect unclosed JSX tags', () => {
      const source = '<Button>Click';
      const result = validateMDX(source);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('Unclosed JSX tag');
    });

    test('should detect unmatched braces', () => {
      const source = 'Text { expression';
      const result = validateMDX(source);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('unclosed brace');
    });

    test('should detect unclosed frontmatter', () => {
      const source = '---\ntitle: Test';
      const result = validateMDX(source);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('Unclosed frontmatter');
    });
  });

  describe('mdxToHTML', () => {
    test('should convert markdown headings', () => {
      const source = '# H1\n## H2\n### H3';
      const html = mdxToHTML(source);

      expect(html).toContain('<h1>H1</h1>');
      expect(html).toContain('<h2>H2</h2>');
      expect(html).toContain('<h3>H3</h3>');
    });

    test('should convert markdown formatting', () => {
      const source = '**bold** and *italic*';
      const html = mdxToHTML(source);

      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
    });

    test('should convert markdown links', () => {
      const source = '[Link](https://example.com)';
      const html = mdxToHTML(source);

      expect(html).toContain('<a href="https://example.com">Link</a>');
    });

    test('should convert code blocks', () => {
      const source = '```js\ncode\n```';
      const html = mdxToHTML(source);

      expect(html).toContain('<code class="language-js">code');
      expect(html).toContain('</code>');
    });
  });

  describe('mdxToPlainText', () => {
    test('should remove frontmatter', () => {
      const source = '---\ntitle: Test\n---\n\nContent';
      const text = mdxToPlainText(source);

      expect(text).toBe('Content');
      expect(text).not.toContain('---');
      expect(text).not.toContain('title:');
    });

    test('should remove JSX components', () => {
      const source = 'Text <Button>Click</Button> more text';
      const text = mdxToPlainText(source);

      expect(text).toBe('Text Click more text');
    });

    test('should remove markdown formatting', () => {
      const source = '# Title\n\n**bold** and [link](url)';
      const text = mdxToPlainText(source);

      expect(text).toBe('Title\n\nbold and link');
    });

    test('should remove code block markers', () => {
      const source = '```js\ncode\n```\n\n`inline`';
      const text = mdxToPlainText(source);

      expect(text).toBe('inline');
    });
  });

  describe('calculateReadingTime', () => {
    test('should calculate reading time', () => {
      // 200 words = 1 minute at 200 WPM
      const words = Array(200).fill('word').join(' ');
      const source = `# Title\n\n${words}`;

      const time = calculateReadingTime(source);

      expect(time.words).toBeGreaterThanOrEqual(200);
      // Title adds 1 word, so 201 words / 200 WPM = 1.005 minutes, rounds to 2
      expect(time.minutes).toBe(2);
      expect(time.time).toBe(120000); // 2 minutes in ms
    });

    test('should exclude code blocks from word count', () => {
      const source = 'Word\n\n```js\nconst longCodeBlock = "should not count";\n```';
      const time = calculateReadingTime(source);

      expect(time.words).toBe(1);
    });
  });

  describe('extractImages', () => {
    test('should extract markdown images', () => {
      const source = '![Alt text](image.png "Title")';
      const images = extractImages(source);

      expect(images).toHaveLength(1);
      expect(images[0]).toEqual({
        src: 'image.png',
        alt: 'Alt text',
        title: 'Title'
      });
    });

    test('should extract JSX img tags', () => {
      const source = '<img src="photo.jpg" alt="Photo" />';
      const images = extractImages(source);

      expect(images).toHaveLength(1);
      expect(images[0]).toEqual({
        src: 'photo.jpg',
        alt: 'Photo',
        title: undefined
      });
    });

    test('should remove duplicate images', () => {
      const source = '![](img.png)\n![](img.png)';
      const images = extractImages(source);

      expect(images).toHaveLength(1);
    });
  });

  describe('extractLinks', () => {
    test('should extract markdown links', () => {
      const source = '[External](https://example.com) and [Internal](/page)';
      const links = extractLinks(source);

      expect(links).toHaveLength(2);
      expect(links[0]).toEqual({
        href: 'https://example.com',
        text: 'External',
        external: true
      });
      expect(links[1]).toEqual({
        href: '/page',
        text: 'Internal',
        external: false
      });
    });

    test('should extract JSX anchor tags', () => {
      const source = '<a href="https://test.com">Test</a>';
      const links = extractLinks(source);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        href: 'https://test.com',
        text: 'Test',
        external: true
      });
    });
  });

  describe('parseFrontmatter', () => {
    test('should parse YAML-like frontmatter', () => {
      const source = '---\ntitle: Test Post\nauthor: John\npublished: true\nviews: 100\n---\n\n# Content';
      const { data, content } = parseFrontmatter(source);

      expect(data).toEqual({
        title: 'Test Post',
        author: 'John',
        published: true,
        views: 100
      });
      expect(content).toBe('# Content');
    });

    test('should handle arrays in frontmatter', () => {
      const source = '---\ntags: [react, mdx, testing]\n---\n\nContent';
      const { data } = parseFrontmatter(source);

      expect(data.tags).toEqual(['react', 'mdx', 'testing']);
    });

    test('should return empty data for no frontmatter', () => {
      const source = '# Just content';
      const { data, content } = parseFrontmatter(source);

      expect(data).toEqual({});
      expect(content).toBe('# Just content');
    });
  });

  describe('extractTOC', () => {
    test('should extract table of contents', () => {
      const source = '# Title\n\n## Section 1\n\n### Subsection\n\n## Section 2';
      const toc = extractTOC(source);

      expect(toc).toHaveLength(1); // Only top-level entries
      expect(toc[0].title).toBe('Title');
      expect(toc[0].children).toHaveLength(2);
      expect(toc[0].children![0].title).toBe('Section 1');
      expect(toc[0].children![0].children).toHaveLength(1);
    });

    test('should generate IDs for headings', () => {
      const source = '# Hello World!\n\n## Test & Special-Characters';
      const toc = extractTOC(source);

      expect(toc[0].id).toBe('hello-world');
      expect(toc[0].children![0].id).toBe('test-special-characters');
    });
  });

  describe('generateId', () => {
    test('should generate valid IDs', () => {
      expect(generateId('Hello World')).toBe('hello-world');
      expect(generateId('Test & Special @ Characters!')).toBe('test-special-characters');
      expect(generateId('  Multiple   Spaces  ')).toBe('multiple-spaces');
      expect(generateId('--Leading-Dashes--')).toBe('leading-dashes');
    });
  });

  describe('highlightMatches', () => {
    test('should highlight search matches', () => {
      const content = 'The quick brown fox jumps';
      const highlighted = highlightMatches(content, 'quick');

      expect(highlighted).toContain('<mark class="highlight">quick</mark>');
    });

    test('should handle case-insensitive matching', () => {
      const content = 'Test TEST test';
      const highlighted = highlightMatches(content, 'test');

      expect(highlighted.match(/<mark/g)?.length).toBe(3);
    });

    test('should escape special regex characters', () => {
      const content = 'Price is $10.99';
      const highlighted = highlightMatches(content, '$10.99');

      expect(highlighted).toContain('<mark class="highlight">$10.99</mark>');
    });
  });

  describe('truncateMDX', () => {
    test('should truncate long content', () => {
      const source = '# Title\n\n' + 'word '.repeat(100);
      const truncated = truncateMDX(source, 50);

      expect(truncated.length).toBeLessThanOrEqual(53); // 50 + '...'
      expect(truncated).toMatch(/\.\.\.$/);
    });

    test('should not truncate short content', () => {
      const source = 'Short text';
      const truncated = truncateMDX(source, 100);

      expect(truncated).toBe('Short text');
      expect(truncated).not.toContain('...');
    });

    test('should truncate at word boundaries', () => {
      const source = 'One two three four five';
      const truncated = truncateMDX(source, 10);

      expect(truncated).toBe('One two...');
    });
  });
});