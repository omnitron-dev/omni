/**
 * SVG Lazy Loading
 *
 * Provides lazy loading components and hooks for SVGs using IntersectionObserver.
 * Supports placeholders, retry logic, and configurable loading behavior.
 *
 * @module svg/optimization/lazy
 */

import { signal, type WritableSignal } from '../../core/reactivity/signal.js';
import { defineComponent } from '../../core/component/define.js';
import type { Component } from '../../core/component/types.js';
import { onCleanup } from '../../core/reactivity/context.js';
import { onMount } from '../../core/component/lifecycle.js';
import type { JSX } from '../../core/component/types.js';

/**
 * Lazy load configuration
 */
export interface LazyLoadConfig {
  /** IntersectionObserver root margin */
  rootMargin?: string;

  /** IntersectionObserver threshold */
  threshold?: number | number[];

  /** Preload before intersection */
  preload?: boolean;

  /** Placeholder element or type */
  placeholder?: JSX.Element | 'blur' | 'skeleton';

  /** Number of retry attempts on error */
  retry?: number;

  /** Fallback element on error */
  fallback?: JSX.Element;

  /** Called when SVG loads */
  onLoad?: () => void;

  /** Called when error occurs */
  onError?: (error: Error) => void;

  /** Called when element intersects */
  onIntersect?: (entry: IntersectionObserverEntry) => void;
}

/**
 * Lazy SVG component props
 */
export interface LazySVGProps extends LazyLoadConfig {
  /** SVG source URL */
  src?: string;

  /** Inline SVG content */
  content?: string;

  /** Width */
  width?: string | number;

  /** Height */
  height?: string | number;

  /** Class name */
  className?: string;

  /** Style */
  style?: string | Partial<CSSStyleDeclaration>;

  /** Alt text for accessibility */
  alt?: string;

  /** Title for accessibility */
  title?: string;

  /** Children (rendered after load) */
  children?: JSX.Element;
}

/**
 * Default blur placeholder SVG
 */
function createBlurPlaceholder(width?: string | number, height?: string | number): JSX.Element {
  const w = typeof width === 'number' ? `${width}px` : width || '100%';
  const h = typeof height === 'number' ? `${height}px` : height || '100%';

  return (
    <svg width={w} height={h} style={{ filter: 'blur(10px)', backgroundColor: '#f0f0f0' }}>
      <rect width="100%" height="100%" fill="#e0e0e0" />
    </svg>
  ) as JSX.Element;
}

/**
 * Default skeleton placeholder SVG
 */
function createSkeletonPlaceholder(width?: string | number, height?: string | number): JSX.Element {
  const w = typeof width === 'number' ? `${width}px` : width || '100%';
  const h = typeof height === 'number' ? `${height}px` : height || '100%';

  return (
    <svg width={w} height={h} style={{ backgroundColor: '#f0f0f0' }}>
      <rect width="100%" height="100%" fill="#e0e0e0">
        <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
      </rect>
    </svg>
  ) as JSX.Element;
}

/**
 * Load SVG from URL
 */
async function loadSVG(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to load SVG: ${response.statusText}`);
  }
  return response.text();
}

/**
 * Lazy SVG Component
 *
 * Lazy loads SVG content when it enters the viewport using IntersectionObserver.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <LazySVG src="/icons/logo.svg" />
 *
 * // With placeholder and retry
 * <LazySVG
 *   src="/icons/large.svg"
 *   placeholder="skeleton"
 *   retry={3}
 *   rootMargin="100px"
 *   onLoad={() => console.log('Loaded')}
 * />
 *
 * // With custom placeholder
 * <LazySVG
 *   src="/icons/custom.svg"
 *   placeholder={<div>Loading...</div>}
 * />
 * ```
 */
export const LazySVG: Component<LazySVGProps> = defineComponent<LazySVGProps>((props) => {
  const isVisible = signal(false);
  const isLoaded = signal(false);
  const error = signal<Error | null>(null);
  const svgContent = signal<string>('');
  const containerRef = signal<HTMLElement | null>(null);
  const retryCount = signal(0);

  // Get configuration
  const config: Required<LazyLoadConfig> = {
    rootMargin: props.rootMargin ?? '50px',
    threshold: props.threshold ?? 0.01,
    preload: props.preload ?? false,
    placeholder: props.placeholder ?? 'blur',
    retry: props.retry ?? 0,
    fallback: props.fallback ?? null,
    onLoad: props.onLoad ?? (() => {}),
    onError: props.onError ?? (() => {}),
    onIntersect: props.onIntersect ?? (() => {}),
  };

  // Load SVG content
  const load = async () => {
    if (!props.src && !props.content) {
      const err = new Error('No SVG source provided');
      error.set(err);
      config.onError(err);
      return;
    }

    try {
      if (props.content) {
        svgContent.set(props.content);
        isLoaded.set(true);
        config.onLoad();
      } else if (props.src) {
        const content = await loadSVG(props.src);
        svgContent.set(content);
        isLoaded.set(true);
        config.onLoad();
        error.set(null);
      }
    } catch (err) {
      const loadError = err instanceof Error ? err : new Error('Failed to load SVG');
      error.set(loadError);
      config.onError(loadError);

      // Retry if configured
      if (retryCount() < config.retry) {
        retryCount.set(retryCount() + 1);
        setTimeout(() => load(), 1000 * retryCount());
      }
    }
  };

  // Setup IntersectionObserver
  onMount(() => {
    const container = containerRef();
    if (!container) return;

    // Preload immediately if configured
    if (config.preload) {
      load();
      return;
    }

    // Use IntersectionObserver for lazy loading
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback for environments without IntersectionObserver
      load();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            isVisible.set(true);
            config.onIntersect(entry);
            load();
            observer.disconnect();
          }
        }
      },
      {
        rootMargin: config.rootMargin,
        threshold: config.threshold,
      }
    );

    observer.observe(container);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  return () => {
    // Show error fallback if available
    if (error() && config.fallback) {
      return config.fallback;
    }

    // Show placeholder while loading
    if (!isLoaded()) {
      let placeholderElement: JSX.Element;

      if (typeof config.placeholder === 'string') {
        if (config.placeholder === 'blur') {
          placeholderElement = createBlurPlaceholder(props.width, props.height);
        } else if (config.placeholder === 'skeleton') {
          placeholderElement = createSkeletonPlaceholder(props.width, props.height);
        } else {
          placeholderElement = null;
        }
      } else {
        placeholderElement = config.placeholder;
      }

      return (
        <div
          ref={(el: any) => {
            if (el && el instanceof HTMLElement) containerRef.set(el);
          }}
          className={props.className}
          style={props.style}
          role="img"
          aria-label={props.alt || props.title}
        >
          {placeholderElement}
        </div>
      ) as JSX.Element;
    }

    // Render loaded SVG
    const svgElement = (
      <div
        ref={(el: any) => {
          if (el && el instanceof HTMLElement) containerRef.set(el);
        }}
        className={props.className}
        style={props.style}
        dangerouslySetInnerHTML={{ __html: svgContent() }}
        role="img"
        aria-label={props.alt || props.title}
      />
    ) as JSX.Element;

    return svgElement;
  };
}, 'LazySVG');

/**
 * Hook return value for useLazyLoad
 */
export interface UseLazyLoadReturn {
  /** Is element loaded */
  isLoaded: WritableSignal<boolean>;

  /** Is element visible */
  isVisible: WritableSignal<boolean>;

  /** Error if any */
  error: WritableSignal<Error | null>;
}

/**
 * Lazy load hook
 *
 * Provides lazy loading functionality for any element using IntersectionObserver.
 *
 * @param ref - Signal containing element reference
 * @param config - Lazy load configuration
 * @returns Object with isLoaded, isVisible, and error signals
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent(() => {
 *   const ref = signal<HTMLElement | null>(null);
 *   const { isLoaded, isVisible, error } = useLazyLoad(ref, {
 *     rootMargin: '100px',
 *     threshold: 0.1,
 *     onLoad: () => console.log('Loaded'),
 *   });
 *
 *   return () => (
 *     <div ref={(el) => ref.set(el)}>
 *       {isVisible() ? 'Visible!' : 'Not visible'}
 *     </div>
 *   );
 * });
 * ```
 */
export function useLazyLoad(ref: WritableSignal<Element | null>, config?: LazyLoadConfig): UseLazyLoadReturn {
  const isLoaded = signal(false);
  const isVisible = signal(false);
  const error = signal<Error | null>(null);

  // Get configuration with defaults
  const cfg: Required<LazyLoadConfig> = {
    rootMargin: config?.rootMargin ?? '50px',
    threshold: config?.threshold ?? 0.01,
    preload: config?.preload ?? false,
    placeholder: config?.placeholder ?? null,
    retry: config?.retry ?? 0,
    fallback: config?.fallback ?? null,
    onLoad: config?.onLoad ?? (() => {}),
    onError: config?.onError ?? (() => {}),
    onIntersect: config?.onIntersect ?? (() => {}),
  };

  // Setup IntersectionObserver
  onMount(() => {
    const element = ref();
    if (!element) return;

    // Preload immediately if configured
    if (cfg.preload) {
      isLoaded.set(true);
      isVisible.set(true);
      cfg.onLoad();
      return;
    }

    // Use IntersectionObserver for lazy loading
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback for environments without IntersectionObserver
      isLoaded.set(true);
      isVisible.set(true);
      cfg.onLoad();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            isVisible.set(true);
            cfg.onIntersect(entry);
            isLoaded.set(true);
            cfg.onLoad();
            observer.disconnect();
          }
        }
      },
      {
        rootMargin: cfg.rootMargin,
        threshold: cfg.threshold,
      }
    );

    observer.observe(element);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  return {
    isLoaded,
    isVisible,
    error,
  };
}
