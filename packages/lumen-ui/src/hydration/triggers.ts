/**
 * Hydration trigger definitions and lifecycle coordinators for Selective Portal Hydration.
 */

import { parseHydrationTrigger, type HydrationTrigger } from '@omnitron-dev/lumen-ast/islands';
export type { HydrationTrigger } from '@omnitron-dev/lumen-ast/islands';

export interface TriggerOptions {
  /** IntersectionObserver threshold (0.0 - 1.0). Default: 0.1 */
  threshold?: number;
  /** IntersectionObserver rootMargin. Default: '200px' */
  rootMargin?: string;
  /** requestIdleCallback timeout in ms. Default: 2000 */
  timeout?: number;
}

export type TriggerCleanup = () => void;

/**
 * Attaches a trigger listener to a DOM element.
 * Invokes onTrigger once when triggered, then automatically cleans up.
 */
export function setupTrigger(
  element: HTMLElement,
  trigger: HydrationTrigger,
  onTrigger: () => void,
  options?: TriggerOptions
): TriggerCleanup {
  switch (parseHydrationTrigger(trigger)) {
    case 'load':
      return setupLoadTrigger(onTrigger);

    case 'visible':
      return setupVisibleTrigger(element, onTrigger, options);

    case 'interaction':
      return setupInteractionTrigger(element, onTrigger);

    case 'idle':
      return setupIdleTrigger(onTrigger, options);

    default:
      return setupEventTrigger(element, trigger.slice(2).toLowerCase(), onTrigger);
  }
}

export function setupLoadTrigger(onTrigger: () => void): TriggerCleanup {
  if (typeof window === 'undefined') return () => {};

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    const handle = requestAnimationFrame(() => onTrigger());
    return () => cancelAnimationFrame(handle);
  }

  const handler = () => onTrigger();
  window.addEventListener('DOMContentLoaded', handler, { once: true });
  return () => window.removeEventListener('DOMContentLoaded', handler);
}

export function setupVisibleTrigger(
  element: HTMLElement,
  onTrigger: () => void,
  options?: TriggerOptions
): TriggerCleanup {
  if (typeof window === 'undefined') return () => {};

  if (typeof IntersectionObserver === 'undefined') {
    onTrigger();
    return () => {};
  }

  let observer: IntersectionObserver | null = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (observer) {
            observer.disconnect();
            observer = null;
          }
          onTrigger();
          break;
        }
      }
    },
    {
      rootMargin: options?.rootMargin ?? '200px',
      threshold: options?.threshold ?? 0.1,
    }
  );

  observer.observe(element);
  return () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

const INTERACTION_EVENTS = ['pointerenter', 'focusin', 'click', 'touchstart', 'keydown'] as const;

export function setupInteractionTrigger(element: HTMLElement, onTrigger: () => void): TriggerCleanup {
  if (typeof window === 'undefined') return () => {};

  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    cleanup();
    onTrigger();
  };

  const cleanup = () => {
    for (const evt of INTERACTION_EVENTS) {
      element.removeEventListener(evt, handler);
    }
  };

  for (const evt of INTERACTION_EVENTS) {
    element.addEventListener(evt, handler, { once: true, passive: true });
  }

  return cleanup;
}

export function setupIdleTrigger(onTrigger: () => void, options?: TriggerOptions): TriggerCleanup {
  if (typeof window === 'undefined') return () => {};

  if ('requestIdleCallback' in window && typeof (window as any).requestIdleCallback === 'function') {
    const handle = (window as any).requestIdleCallback(() => onTrigger(), { timeout: options?.timeout ?? 2000 });
    return () => (window as any).cancelIdleCallback(handle);
  }

  const timer = setTimeout(() => onTrigger(), 200);
  return () => clearTimeout(timer);
}

export function setupEventTrigger(element: HTMLElement, eventName: string, onTrigger: () => void): TriggerCleanup {
  if (typeof window === 'undefined') return () => {};

  const handler = () => onTrigger();
  element.addEventListener(eventName, handler, { once: true, passive: true });
  return () => element.removeEventListener(eventName, handler);
}
