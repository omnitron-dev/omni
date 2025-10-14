/**
 * ProgressiveSVG Component
 *
 * Progressive enhancement for SVG with graceful degradation and client-side enhancement
 */

import { defineComponent, signal, effect, onCleanup } from '../../index.js';
import type { SVGProps } from '../primitives/svg.js';
import { SVG } from '../primitives/svg.js';
import { canUseDOM, isServer } from '../ssr/utils.js';

export type EnhancementTrigger = 'load' | 'idle' | 'interaction' | 'visible';

export interface ProgressiveSVGProps extends SVGProps {
  /** Fallback content for no-JavaScript environments */
  noscript?: any;

  /** Render in no-JavaScript mode (default: false) */
  nojs?: boolean;

  /** Enable progressive enhancement (default: true) */
  enhance?: boolean;

  /** When to enhance (default: 'load') */
  enhanceOn?: EnhancementTrigger;

  /** Enable animations after enhancement (default: true) */
  enableAnimations?: boolean;

  /** Enable interactivity after enhancement (default: true) */
  enableInteractivity?: boolean;

  /** Enable dynamic loading after enhancement (default: false) */
  enableDynamicLoading?: boolean;

  /** Intersection observer options for 'visible' trigger */
  intersectionOptions?: IntersectionObserverInit;

  /** Interaction events to listen for with 'interaction' trigger */
  interactionEvents?: string[];

  /** Idle timeout for 'idle' trigger (ms, default: 2000) */
  idleTimeout?: number;

  /** Callback when enhancement completes */
  onEnhanced?: () => void;

  /** Callback when enhancement fails */
  onEnhancementError?: (error: Error) => void;

  /** Base SVG content */
  children?: any;
}

/**
 * ProgressiveSVG component with graceful degradation and enhancement
 */
export const ProgressiveSVG = defineComponent<ProgressiveSVGProps>((props) => {
  const isEnhanced = signal(false);
  const _isVisible = signal(false);
  const error = signal<Error | null>(null);

  const {
    noscript,
    nojs = false,
    enhance = true,
    enhanceOn = 'load',
    enableAnimations = true,
    enableInteractivity = true,
    enableDynamicLoading: _enableDynamicLoading = false,
    intersectionOptions,
    interactionEvents = ['mouseenter', 'focusin', 'touchstart'],
    idleTimeout = 2000,
    onEnhanced,
    onEnhancementError,
    ...svgProps
  } = props;

  // Track if we should enhance
  const shouldEnhance = enhance && !nojs && canUseDOM();

  // Perform enhancement based on trigger
  effect(() => {
    if (!shouldEnhance || isEnhanced()) {
      return;
    }

    const performEnhancement = () => {
      try {
        isEnhanced.set(true);
        onEnhanced?.();
      } catch (err) {
        const enhancementError = err instanceof Error ? err : new Error(String(err));
        error.set(enhancementError);
        onEnhancementError?.(enhancementError);
      }
    };

    switch (enhanceOn) {
      case 'load':
        performEnhancement();
        break;

      case 'idle':
        scheduleIdleEnhancement(performEnhancement, idleTimeout);
        break;

      case 'visible':
        scheduleVisibleEnhancement(performEnhancement, intersectionOptions);
        break;

      case 'interaction':
        scheduleInteractionEnhancement(performEnhancement, interactionEvents);
        break;

      default:
        // For any unknown strategy, fall back to immediate
        performEnhancement();
        break;
    }
  });

  return () => {
    // Server-side or no-JS: render basic SVG with fallback
    if (isServer() || nojs) {
      return (
        <>
          <SVG {...svgProps}>{props.children}</SVG>
          {noscript && <noscript>{noscript}</noscript>}
        </>
      );
    }

    // Error state
    if (error()) {
      return (
        <SVG {...svgProps} role="img" aria-label="SVG Error">
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="red">
            Error loading SVG
          </text>
        </SVG>
      );
    }

    // Not yet enhanced: render basic SVG
    if (!isEnhanced()) {
      return (
        <SVG
          {...svgProps}
          data-progressive-svg="true"
          data-enhance-on={enhanceOn}
        >
          {props.children}
        </SVG>
      );
    }

    // Enhanced: render with full features
    const enhancedProps: any = {
      ...svgProps,
      'data-progressive-svg': 'true',
      'data-enhanced': 'true',
    };

    // Add animation class if enabled
    if (enableAnimations) {
      enhancedProps.className = `${svgProps.className || ''} progressive-svg-animated`.trim();
    }

    // Add interactivity if enabled
    if (enableInteractivity) {
      enhancedProps['data-interactive'] = 'true';
    }

    return (
      <SVG {...enhancedProps}>
        {props.children}
      </SVG>
    );
  };
});

/**
 * Schedule enhancement during browser idle time
 */
function scheduleIdleEnhancement(callback: () => void, timeout: number): void {
  if ('requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(callback, { timeout });
    onCleanup(() => window.cancelIdleCallback(handle));
  } else {
    const handle = setTimeout(callback, 0);
    onCleanup(() => clearTimeout(handle));
  }
}

/**
 * Schedule enhancement when element becomes visible
 */
function scheduleVisibleEnhancement(
  callback: () => void,
  options?: IntersectionObserverInit
): void {
  // We need to get reference to the element
  // This is a simplified implementation
  effect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      callback();
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            callback();
            observer.disconnect();
          }
        });
      },
      options || { threshold: 0.01 }
    );

    // Observe document body as placeholder
    // In real implementation, would observe the actual SVG element
    const target = document.querySelector('[data-progressive-svg]');
    if (target) {
      observer.observe(target);
    } else {
      callback();
    }

    onCleanup(() => observer.disconnect());
  });
}

/**
 * Schedule enhancement on user interaction
 */
function scheduleInteractionEnhancement(
  callback: () => void,
  events: string[]
): void {
  effect(() => {
    let executed = false;

    const handler = () => {
      if (!executed) {
        executed = true;
        callback();
      }
    };

    // Get target element
    const target = document.querySelector('[data-progressive-svg]');
    if (!target) {
      callback();
      return;
    }

    // Add listeners
    events.forEach(event =>
      target.addEventListener(event, handler, { once: true, passive: true })
    );

    onCleanup(() => {
      events.forEach(event => target.removeEventListener(event, handler));
    });
  });
}

/**
 * NoScript fallback component
 */
export const NoScriptSVG = defineComponent<{
  fallback: any;
  children?: any;
}>((props) => () => (
    <>
      {props.children}
      <noscript>{props.fallback}</noscript>
    </>
  ));

/**
 * SSR-friendly SVG component that handles hydration
 */
export const SSRSafeSVG = defineComponent<
  SVGProps & {
    /** Server-rendered content */
    serverContent?: string;
    /** Hydration callback */
    onHydrate?: () => void;
  }
>((props) => {
  const isHydrated = signal(false);

  const { serverContent, onHydrate, ...svgProps } = props;

  effect(() => {
    if (canUseDOM() && !isHydrated()) {
      isHydrated.set(true);
      onHydrate?.();
    }
  });

  return () => {
    // On server or before hydration, use server content if available
    if (!isHydrated() && serverContent) {
      return <div dangerouslySetInnerHTML={{ __html: serverContent }} />;
    }

    // After hydration or on client, render normally
    return <SVG {...svgProps}>{props.children}</SVG>;
  };
});

// Add global styles for progressive enhancement
if (canUseDOM() && !document.querySelector('#aether-progressive-svg-styles')) {
  const style = document.createElement('style');
  style.id = 'aether-progressive-svg-styles';
  style.textContent = `
    /* Base styles for progressive SVG */
    [data-progressive-svg]:not([data-enhanced]) {
      /* Disable animations before enhancement */
      animation: none !important;
      transition: none !important;
    }

    /* Enhanced styles */
    [data-progressive-svg][data-enhanced] {
      animation: inherit;
      transition: inherit;
    }

    /* Animation class */
    .progressive-svg-animated {
      transition: all 0.3s ease-in-out;
    }

    /* Interactive styles */
    [data-progressive-svg][data-interactive] {
      cursor: pointer;
    }

    [data-progressive-svg][data-interactive]:hover {
      opacity: 0.8;
    }

    /* No-script fallback visibility */
    noscript {
      display: none;
    }
  `;
  document.head.appendChild(style);
}
