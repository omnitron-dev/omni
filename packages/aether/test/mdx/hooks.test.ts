/**
 * MDX Hooks Tests
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '../../src/core/reactivity/signal.js';
import { batch } from '../../src/core/reactivity/batch.js';
import {
  useMDXCompiler,
  useFrontmatter,
  useMDXNavigation,
  useCopyToClipboard,
  useReadingTime,
  useMDXTheme,
  useMDXSearch,
} from '../../src/mdx/hooks/index.js';

// Mock MDX context
vi.mock('../../src/mdx/runtime/provider', () => ({
  useMDXContext: () => ({
    components: {},
    scope: {
      frontmatter: {
        title: 'Test Title',
        author: 'Test Author',
      },
    },
    reactiveScope: {},
  }),
}));

// Mock lifecycle hooks
vi.mock('../../src/core/component/lifecycle', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    onMount: (fn: () => void) => fn(),
    onCleanup: (fn: () => void) => {},
  };
});

describe('MDX Hooks', () => {
  describe('useMDXCompiler', () => {
    test('should compile MDX reactively', async () => {
      const source = signal('# Hello');
      const compiled = useMDXCompiler(source);

      // Since compileMDXSync is synchronous and the effect runs immediately,
      // the result should be available right away (not null)
      expect(compiled()).not.toBeNull();
      expect(compiled()).toBeDefined();

      // Update source
      batch(() => {
        source.set('# Updated');
      });

      // The compilation happens synchronously, so the result is still available
      expect(compiled()).not.toBeNull();
    });

    test('should handle compilation errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const source = signal('<InvalidJSX');
      const compiled = useMDXCompiler(source);

      // Should return null on error
      expect(compiled()).toBeNull();

      consoleSpy.mockRestore();
    });

    test('should return null for empty source', () => {
      const source = signal('');
      const compiled = useMDXCompiler(source);

      expect(compiled()).toBeNull();
    });
  });

  describe('useFrontmatter', () => {
    test('should return frontmatter from context', () => {
      const frontmatter = useFrontmatter();

      expect(frontmatter).toEqual({
        title: 'Test Title',
        author: 'Test Author',
      });
    });
  });

  describe('useMDXNavigation', () => {
    beforeEach(() => {
      // Mock DOM methods
      global.IntersectionObserver = vi.fn().mockImplementation((callback, options) => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(),
        root: null,
        rootMargin: '',
        thresholds: [],
      }));

      global.document = {
        getElementById: vi.fn((id) => ({ id, scrollIntoView: vi.fn() })),
      } as any;

      global.window = {
        location: { hash: '' },
      } as any;
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    test('should initialize with TOC', () => {
      const toc = [
        { level: 1, title: 'Title 1', id: 'title-1' },
        { level: 2, title: 'Title 2', id: 'title-2' },
      ];

      const navigation = useMDXNavigation(toc);

      expect(navigation.toc).toEqual(toc);
      expect(navigation.activeSection()).toBeNull();
    });

    test('should scroll to section', () => {
      const toc = [{ level: 1, title: 'Title', id: 'title' }];
      const navigation = useMDXNavigation(toc);

      const mockElement = {
        id: 'title',
        scrollIntoView: vi.fn(),
      };
      document.getElementById = vi.fn(() => mockElement) as any;

      navigation.scrollToSection('title');

      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      });
      expect(navigation.activeSection()).toBe('title');
      expect(window.location.hash).toBe('title');
    });

    test('should handle missing elements gracefully', () => {
      const navigation = useMDXNavigation([]);
      document.getElementById = vi.fn(() => null) as any;

      // Should not throw
      expect(() => navigation.scrollToSection('missing')).not.toThrow();
    });
  });

  describe('useCopyToClipboard', () => {
    beforeEach(() => {
      global.navigator = {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      } as any;
    });

    test('should copy text to clipboard', async () => {
      const { copied, copy } = useCopyToClipboard();

      expect(copied()).toBe(false);

      await copy('Test text');

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test text');
      expect(copied()).toBe(true);
    });

    test('should reset copied state after timeout', async () => {
      vi.useFakeTimers();
      const { copied, copy } = useCopyToClipboard();

      await copy('Test');
      expect(copied()).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(copied()).toBe(false);

      vi.useRealTimers();
    });

    test('should handle clipboard API not available', async () => {
      global.navigator = {} as any;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { copy } = useCopyToClipboard();
      await copy('Test');

      expect(consoleSpy).toHaveBeenCalledWith('Clipboard API not available');
      consoleSpy.mockRestore();
    });
  });

  describe('useReadingTime', () => {
    test('should calculate reading time', () => {
      const words = Array(200).fill('word').join(' ');
      const content = `# Title\n\n${words}`;

      const time = useReadingTime(content);

      expect(time.words).toBeGreaterThanOrEqual(200);
      // Title adds 1 word, so 201 words / 200 WPM = 1.005 minutes, rounds to 2
      expect(time.minutes).toBe(2);
      expect(time.time).toBe(120000);
    });

    test('should exclude code blocks', () => {
      const content = 'Word\n\n```js\nconst code = "should not count";\n```';
      const time = useReadingTime(content);

      expect(time.words).toBe(1);
    });
  });

  describe('useMDXTheme', () => {
    beforeEach(() => {
      global.window = {
        matchMedia: vi.fn((query) => ({
          matches: query === '(prefers-color-scheme: dark)',
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      } as any;

      global.document = {
        documentElement: {
          setAttribute: vi.fn(),
        },
      } as any;
    });

    test('should initialize with auto theme', () => {
      const { theme, resolvedTheme } = useMDXTheme();

      expect(theme()).toBe('auto');
      expect(resolvedTheme()).toBe('dark'); // Based on mock matchMedia
    });

    test('should set explicit theme', () => {
      const { theme, setTheme, resolvedTheme } = useMDXTheme();

      setTheme('light');
      expect(theme()).toBe('light');
      expect(resolvedTheme()).toBe('light');

      expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-mdx-theme', 'light');
    });

    test('should detect system theme in auto mode', () => {
      window.matchMedia = vi.fn(() => ({
        matches: false, // Light mode
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })) as any;

      const { resolvedTheme } = useMDXTheme();
      expect(resolvedTheme()).toBe('light');
    });
  });

  describe('useMDXSearch', () => {
    test('should search content', () => {
      const content = 'Line one\nLine two with search term\nLine three';
      const query = signal('search');

      const results = useMDXSearch(content, query);

      expect(results()).toHaveLength(1);
      expect(results()[0].text).toBe('Line two with search term');
      expect(results()[0].context).toContain('Line one');
      expect(results()[0].context).toContain('Line three');
    });

    test('should return empty results for empty query', () => {
      const content = 'Some content';
      const query = signal('');

      const results = useMDXSearch(content, query);
      expect(results()).toEqual([]);
    });

    test('should handle case-insensitive search', () => {
      const content = 'Test TEST test';
      const query = signal('test');

      const results = useMDXSearch(content, query);
      expect(results()).toHaveLength(1); // All on same line
    });

    test('should update results reactively', () => {
      const content = 'Apple\nBanana\nCherry';
      const query = signal('apple');

      const results = useMDXSearch(content, query);
      expect(results()).toHaveLength(1);

      batch(() => {
        query.set('banana');
      });

      expect(results()).toHaveLength(1);
      expect(results()[0].text).toBe('Banana');
    });
  });
});
