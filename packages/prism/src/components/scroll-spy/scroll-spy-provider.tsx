'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';

interface ScrollSpyContextValue {
  activeId: string | null;
  registerSection: (id: string, element: HTMLElement) => void;
  unregisterSection: (id: string) => void;
}

const ScrollSpyContext = createContext<ScrollSpyContextValue>({
  activeId: null,
  registerSection: () => {},
  unregisterSection: () => {},
});

export function useScrollSpy() {
  return useContext(ScrollSpyContext);
}

interface ScrollSpyProviderProps {
  children: ReactNode;
  /** Offset from top in pixels for activation threshold */
  offset?: number;
  /** Root element to observe (defaults to viewport) */
  root?: HTMLElement | null;
  /**
   * CSS selector for heading elements to auto-observe.
   * When set, headings matching this selector inside the container
   * are automatically registered (no need for ScrollSpySection wrappers).
   * @default 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'
   */
  headingSelector?: string;
  /** Ref to the container to scan for headings. Defaults to document. */
  containerRef?: React.RefObject<HTMLElement | null>;
}

export function ScrollSpyProvider({
  children,
  offset = 80,
  root = null,
  headingSelector = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]',
  containerRef,
}: ScrollSpyProviderProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sectionsRef = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Create IntersectionObserver
  const createObserver = useCallback(() => {
    observerRef.current?.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible entry
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        root,
        rootMargin: `-${offset}px 0px -60% 0px`,
        threshold: 0,
      }
    );

    sectionsRef.current.forEach((element) => observer.observe(element));
    observerRef.current = observer;
  }, [offset, root]);

  // Auto-scan for headings with IDs
  useEffect(() => {
    if (!headingSelector) return undefined;

    // Wait a tick for content to render
    const timer = setTimeout(() => {
      const container = containerRef?.current ?? wrapperRef.current;
      if (!container) return;

      const headings = container.querySelectorAll<HTMLElement>(headingSelector);
      headings.forEach((heading) => {
        if (heading.id) {
          sectionsRef.current.set(heading.id, heading);
        }
      });

      createObserver();
    }, 100);

    return () => {
      clearTimeout(timer);
      observerRef.current?.disconnect();
    };
  }, [headingSelector, containerRef, createObserver]);

  // Also observe via MutationObserver to catch dynamically added headings
  useEffect(() => {
    if (!headingSelector) return undefined;

    const container = containerRef?.current ?? wrapperRef.current;
    if (!container) return undefined;

    const mutationObserver = new MutationObserver(() => {
      const headings = container.querySelectorAll<HTMLElement>(headingSelector);
      let changed = false;

      headings.forEach((heading) => {
        if (heading.id && !sectionsRef.current.has(heading.id)) {
          sectionsRef.current.set(heading.id, heading);
          changed = true;
        }
      });

      if (changed) {
        createObserver();
      }
    });

    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => mutationObserver.disconnect();
  }, [headingSelector, containerRef, createObserver]);

  const registerSection = useCallback((id: string, element: HTMLElement) => {
    sectionsRef.current.set(id, element);
    observerRef.current?.observe(element);
  }, []);

  const unregisterSection = useCallback((id: string) => {
    const element = sectionsRef.current.get(id);
    if (element) observerRef.current?.unobserve(element);
    sectionsRef.current.delete(id);
  }, []);

  return (
    <ScrollSpyContext.Provider value={{ activeId, registerSection, unregisterSection }}>
      <div ref={wrapperRef}>{children}</div>
    </ScrollSpyContext.Provider>
  );
}
