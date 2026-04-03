'use client';

/**
 * useEventListener Hook
 *
 * Attaches event listeners with automatic cleanup.
 *
 * @module @omnitron-dev/prism/core/hooks
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Supported event maps for different targets.
 */
type WindowEventMap = globalThis.WindowEventMap;
type HTMLElementEventMap = globalThis.HTMLElementEventMap;
type DocumentEventMap = globalThis.DocumentEventMap;

/**
 * Hook to attach event listeners with automatic cleanup.
 *
 * @template K - Event type key
 * @param {K} eventName - Name of the event
 * @param {function} handler - Event handler
 * @param {RefObject<HTMLElement>} [element] - Target element (defaults to window)
 * @param {AddEventListenerOptions} [options] - Event listener options
 *
 * @example
 * ```tsx
 * // Window event
 * function ScrollTracker() {
 *   useEventListener('scroll', () => console.log('Scrolled!'));
 *   return null;
 * }
 *
 * // Element event
 * function ClickTracker() {
 *   const ref = useRef<HTMLDivElement>(null);
 *   useEventListener('click', (e) => console.log('Clicked!', e), ref);
 *   return <div ref={ref}>Click me</div>;
 * }
 * ```
 */
export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  element?: undefined,
  options?: AddEventListenerOptions
): void;

export function useEventListener<K extends keyof HTMLElementEventMap>(
  eventName: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  element: RefObject<HTMLElement | null>,
  options?: AddEventListenerOptions
): void;

export function useEventListener<K extends keyof DocumentEventMap>(
  eventName: K,
  handler: (event: DocumentEventMap[K]) => void,
  element: RefObject<Document>,
  options?: AddEventListenerOptions
): void;

export function useEventListener(
  eventName: string,
  handler: (event: Event) => void,
  element?: RefObject<HTMLElement | Document | null>,
  options?: AddEventListenerOptions
): void {
  const savedHandler = useRef(handler);

  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    const targetElement = element?.current ?? window;

    if (!targetElement?.addEventListener) {
      return undefined;
    }

    const eventListener = (event: Event) => savedHandler.current(event);

    targetElement.addEventListener(eventName, eventListener, options);

    return () => {
      targetElement.removeEventListener(eventName, eventListener, options);
    };
  }, [eventName, element, options]);
}
