'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode, type RefObject } from 'react';

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

export interface ScrollSpyProviderProps {
  children: ReactNode;
  /** Activation offset in pixels. Defaults to the scroll container's CSS scroll-padding-top. */
  offset?: number;
  /** Scroll container; null uses the document viewport. */
  root?: HTMLElement | null;
  /** Explicit document anchors, including headings outside this provider (for SSR islands). */
  headingIds?: readonly string[];
  /** Auto-discovery inside containerRef or the provider; ignored when headingIds is supplied. */
  headingSelector?: string;
  containerRef?: RefObject<HTMLElement | null>;
}

/** Track section starts, not just headings currently intersecting the viewport. */
export function ScrollSpyProvider({
  children,
  offset,
  root = null,
  headingIds,
  headingSelector = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]',
  containerRef,
}: ScrollSpyProviderProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const registered = useRef(new Map<string, HTMLElement>());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<(() => void) | null>(null);

  const registerSection = useCallback((id: string, element: HTMLElement) => {
    registered.current.set(id, element);
    refreshRef.current?.();
  }, []);

  const unregisterSection = useCallback((id: string) => {
    registered.current.delete(id);
    refreshRef.current?.();
  }, []);

  useEffect(() => {
    const doc = wrapperRef.current?.ownerDocument;
    const view = doc?.defaultView;
    if (!doc || !view) return undefined;
    const container = headingIds ? doc : containerRef?.current ?? wrapperRef.current!;
    const scroller = root ?? doc.scrollingElement ?? doc.documentElement;
    const scrollTarget = root ?? view;
    let sections: HTMLElement[] = [];
    let frame = 0;
    let rescan = true;
    let navigation: { id: string; position?: number } | null = null;

    const number = (value: string) => Number.parseFloat(value) || 0;
    const readHash = () => {
      try { return decodeURIComponent(view.location.hash.slice(1)); } catch { return ''; }
    };

    const update = () => {
      frame = 0;
      if (rescan) {
        rescan = false;
        const discovered = headingIds
          ? headingIds.map(id => doc.getElementById(id))
          : headingSelector ? [...container.querySelectorAll<HTMLElement>(headingSelector)] : [];
        sections = [...new Set([...discovered, ...registered.current.values()])]
          .filter((element): element is HTMLElement => !!element?.id && element.isConnected && (!root || root.contains(element)))
          .sort((a, b) => a.compareDocumentPosition(b) & 2 ? 1 : -1);
        resizeObserver.disconnect();
        resizeObserver.observe(root ?? doc.documentElement);
        if (doc.body) resizeObserver.observe(doc.body);
        if (container instanceof view.HTMLElement) resizeObserver.observe(container);
        sections.forEach(section => resizeObserver.observe(section));
      }

      const top = root ? root.getBoundingClientRect().top + root.clientTop : 0;
      const height = root ? root.clientHeight : view.innerHeight;
      const position = scroller.scrollTop;
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const atEnd = maximum > 0 && position >= maximum - 1;
      const threshold = top + (offset ?? number(view.getComputedStyle(scroller).scrollPaddingTop));
      const measured = sections.filter(section => section.isConnected && section.getClientRects().length > 0)
        .map(element => ({ element, top: element.getBoundingClientRect().top,
          threshold: threshold + number(view.getComputedStyle(element).scrollMarginTop) }));

      let current = measured.at(0);
      for (const section of measured) {
        if (section.top <= section.threshold + 1) current = section;
      }
      if (atEnd) current = measured.at(-1);

      // Native anchor navigation can be clamped near the end of a short document.
      // Keep that explicit destination until the reader moves, without changing history,
      // focus, scroll behavior, or intercepting the browser's anchor action.
      if (navigation) {
        const destination = measured.find(section => section.element.id === navigation?.id);
        if (!destination || (navigation.position !== undefined && Math.abs(position - navigation.position) > 1)) {
          navigation = null;
        } else if (Math.abs(destination.top - destination.threshold) <= 1 ||
          ((atEnd || maximum === 0) && destination.top >= top && destination.top < top + height)) {
          navigation.position = position;
          current = destination;
        }
      }
      setActiveId(current?.element.id ?? null);
    };

    const schedule = () => { if (!frame) frame = view.requestAnimationFrame(update); };
    const refresh = () => { rescan = true; schedule(); };
    const resizeObserver = new ResizeObserver(schedule);
    const mutations = new MutationObserver(refresh);
    mutations.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['id', 'hidden'] });
    refreshRef.current = refresh;

    const hashChanged = () => { navigation = { id: readHash() }; schedule(); };
    const clicked = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof view.Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof view.HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const url = new URL(anchor.href);
      if (url.origin !== view.location.origin || url.pathname !== view.location.pathname || url.search !== view.location.search) return;
      try { navigation = { id: decodeURIComponent(url.hash.slice(1)) }; } catch { navigation = null; }
      schedule();
    };
    const manualScroll = () => { navigation = null; schedule(); };
    const key = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) manualScroll();
    };
    scrollTarget.addEventListener('scroll', schedule, { passive: true });
    scrollTarget.addEventListener('wheel', manualScroll, { passive: true });
    scrollTarget.addEventListener('touchstart', manualScroll, { passive: true });
    view.addEventListener('resize', schedule);
    view.addEventListener('hashchange', hashChanged);
    view.addEventListener('popstate', hashChanged);
    doc.addEventListener('click', clicked);
    doc.addEventListener('keydown', key);
    hashChanged();

    return () => {
      refreshRef.current = null;
      view.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutations.disconnect();
      scrollTarget.removeEventListener('scroll', schedule);
      scrollTarget.removeEventListener('wheel', manualScroll);
      scrollTarget.removeEventListener('touchstart', manualScroll);
      view.removeEventListener('resize', schedule);
      view.removeEventListener('hashchange', hashChanged);
      view.removeEventListener('popstate', hashChanged);
      doc.removeEventListener('click', clicked);
      doc.removeEventListener('keydown', key);
    };
  }, [offset, root, headingIds, headingSelector, containerRef]);

  return (
    <ScrollSpyContext.Provider value={{ activeId, registerSection, unregisterSection }}>
      <div ref={wrapperRef}>{children}</div>
    </ScrollSpyContext.Provider>
  );
}
