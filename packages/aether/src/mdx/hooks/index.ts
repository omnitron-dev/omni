/**
 * MDX Hooks
 *
 * React-like hooks for MDX functionality in Aether
 */

import { signal, computed, effect } from '../../core/reactivity/index.js';
import { onMount, onCleanup } from '../../core/component/lifecycle.js';
import { batch } from '../../core/reactivity/batch.js';
import { useMDXContext } from '../runtime/provider.js';
import { compileMDXSync } from '../compiler/index.js';

import type { Signal, MDXComponent, CompileMDXOptions, TOCEntry, MDXNavigationResult } from '../types.js';

/**
 * Hook for dynamic MDX compilation
 */
export function useMDXCompiler(source: Signal<string>, options?: CompileMDXOptions): Signal<MDXComponent | null> {
  const compiled = signal<MDXComponent | null>(null);
  const error = signal<Error | null>(null);

  // Compile on source change
  effect(() => {
    const mdxSource = source();
    if (!mdxSource) {
      compiled.set(null);
      return;
    }

    batch(() => {
      try {
        const module = compileMDXSync(mdxSource, options);
        compiled.set(module.default);
        error.set(null);
      } catch (err) {
        error.set(err as Error);
        compiled.set(null);
        console.error('MDX compilation error:', err);
      }
    });
  });

  // Return compiled component with error state
  return computed(() => {
    if (error()) {
      // Return error component
      return null;
    }
    return compiled();
  });
}

/**
 * Hook for accessing frontmatter data
 */
export function useFrontmatter(): Record<string, any> {
  const context = useMDXContext();
  return context.scope?.frontmatter || {};
}

/**
 * Hook for MDX navigation (table of contents)
 */
export function useMDXNavigation(toc?: TOCEntry[]): MDXNavigationResult {
  const activeSection = signal<string | null>(null);
  const observerRef = signal<IntersectionObserver | null>(null);

  // Setup intersection observer for active section detection
  onMount(() => {
    if (typeof window === 'undefined' || !toc || toc.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((entry) => entry.isIntersecting);
        if (visibleEntries.length > 0) {
          // Get the topmost visible section
          const topEntry = visibleEntries.reduce((prev, current) =>
            prev.boundingClientRect.top < current.boundingClientRect.top ? prev : current
          );
          activeSection.set(topEntry.target.id);
        }
      },
      {
        rootMargin: '-20% 0px -70% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    // Observe all heading elements
    for (const item of toc) {
      const element = document.getElementById(item.id);
      if (element) {
        observer.observe(element);
      }
    }

    observerRef.set(observer);

    // Cleanup
    onCleanup(() => {
      observer.disconnect();
    });
  });

  // Scroll to section function
  const scrollToSection = (id: string) => {
    if (typeof window === 'undefined') return;

    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });

      // Update URL hash
      window.location.hash = id;

      // Update active section
      activeSection.set(id);
    }
  };

  return {
    toc: toc || [],
    activeSection,
    scrollToSection,
  };
}

/**
 * Hook for syntax highlighting
 */
export function useSyntaxHighlight(code: string, language?: string): Signal<string> {
  const highlighted = signal(code);

  effect(() => {
    // In production, integrate with rehype-starry-night
    // For now, return the code as-is
    highlighted.set(code);
  });

  return highlighted;
}

/**
 * Hook for MDX search functionality
 */
export function useMDXSearch(
  content: string,
  query: Signal<string>
): Signal<
  Array<{
    text: string;
    position: number;
    context: string;
  }>
> {
  return computed(() => {
    const searchQuery = query().toLowerCase();
    if (!searchQuery) return [];

    const results: Array<{
      text: string;
      position: number;
      context: string;
    }> = [];

    const lines = content.split('\n');
    let position = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {
        position += 1; // +1 for newline
        continue;
      }

      const lowerLine = line.toLowerCase();
      const index = lowerLine.indexOf(searchQuery);

      if (index !== -1) {
        // Get context (previous and next line)
        const prevLine = i > 0 ? lines[i - 1] || '' : '';
        const nextLine = i < lines.length - 1 ? lines[i + 1] || '' : '';

        results.push({
          text: line,
          position: position + index,
          context: `${prevLine}\n${line}\n${nextLine}`.trim(),
        });
      }

      position += line.length + 1; // +1 for newline
    }

    return results;
  });
}

/**
 * Hook for MDX copy functionality
 */
export function useCopyToClipboard(): {
  copied: Signal<boolean>;
  copy: (text: string) => Promise<void>;
} {
  const copied = signal(false);
  let timeoutId: any;

  const copy = async (text: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      console.warn('Clipboard API not available');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      copied.set(true);

      // Reset after 2 seconds
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => copied.set(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Cleanup timeout on unmount
  onCleanup(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

  return { copied, copy };
}

/**
 * Hook for MDX reading time calculation
 */
export function useReadingTime(content: string): {
  minutes: number;
  words: number;
  time: number;
} {
  const wordsPerMinute = 200; // Average reading speed

  // Remove MDX/JSX tags and count words
  const plainText = content
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]*`/g, '') // Remove inline code
    .replace(/\{[^}]*\}/g, '') // Remove JSX expressions
    .trim();

  const words = plainText.split(/\s+/).filter((word) => word.length > 0).length;
  const minutes = Math.ceil(words / wordsPerMinute);
  const time = minutes * 60 * 1000; // in milliseconds, based on rounded minutes

  return { minutes, words, time };
}

/**
 * Hook for MDX theme detection and switching
 */
export function useMDXTheme(): {
  theme: Signal<'light' | 'dark' | 'auto'>;
  setTheme: (theme: 'light' | 'dark' | 'auto') => void;
  resolvedTheme: Signal<'light' | 'dark'>;
} {
  const theme = signal<'light' | 'dark' | 'auto'>('auto');

  const resolvedTheme = computed(() => {
    const currentTheme = theme();

    if (currentTheme !== 'auto') {
      return currentTheme;
    }

    // Check system preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    }

    return 'light';
  });

  // Listen for system theme changes
  onMount(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      // Trigger reactivity update
      theme.set(theme());
    };

    mediaQuery.addEventListener('change', handleChange);

    onCleanup(() => {
      mediaQuery.removeEventListener('change', handleChange);
    });
  });

  const setTheme = (newTheme: 'light' | 'dark' | 'auto') => {
    theme.set(newTheme);

    // Apply theme to document
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.setAttribute('data-mdx-theme', resolvedTheme());
    }
  };

  return { theme, setTheme, resolvedTheme };
}

/**
 * Hook for lazy loading MDX content
 */
export function useLazyMDX(
  loader: () => Promise<{ default: MDXComponent }>,
  fallback?: MDXComponent
): Signal<MDXComponent | null> {
  const component = signal<MDXComponent | null>(fallback || null);
  const loading = signal(true);
  const error = signal<Error | null>(null);

  onMount(() => {
    loader()
      .then((module) => {
        component.set(module.default);
        loading.set(false);
      })
      .catch((err) => {
        error.set(err as Error);
        loading.set(false);
        console.error('Failed to load MDX:', err);
      });
  });

  return computed(() => {
    if (loading()) return fallback || null;
    if (error()) return null;
    return component();
  });
}
