import React, { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PrismProvider } from '@omnitron-dev/prism';
import { LumenContext, type LumenContextValue, type IslandComponent, type IslandRegistry } from './context.js';
import { setupTrigger, type HydrationTrigger } from './triggers.js';

export interface LumenShellProps {
  children?: ReactNode;
  theme?: 'light' | 'dark' | string;
  locale?: string;
  currentPath?: string;
  islands?: IslandRegistry;
  disablePrismProvider?: boolean;
}

export interface PortalIslandManagerProps {
  registry: IslandRegistry;
  onActiveIslandsChange?: (activeIds: Set<string>) => void;
  hydrateHandlerRef?: React.MutableRefObject<((islandId: string) => void) | null>;
  pendingHydrateIdsRef?: React.MutableRefObject<Set<string>>;
}

interface DiscoveredIsland {
  instanceKey: string;
  islandId: string;
  componentName: string;
  trigger: HydrationTrigger;
  props: Record<string, unknown>;
  element: HTMLElement;
}

const ISLAND_SELECTOR = '.lumen-portal-island, [data-lumen-island], [data-widget]';

let globalElementInstanceCounter = 0;
const elementInstanceKeys = new WeakMap<HTMLElement, string>();
const syntheticElementIds = new WeakMap<HTMLElement, string>();

function getOrCreateInstanceKey(el: HTMLElement): string {
  let key = elementInstanceKeys.get(el);
  if (!key) {
    globalElementInstanceCounter += 1;
    key = `lumen-island-inst-${globalElementInstanceCounter}`;
    elementInstanceKeys.set(el, key);
  }
  return key;
}

function resolveElementIslandIdentity(el: HTMLElement): { islandId: string; componentName: string } {
  const explicitIslandId = el.getAttribute('data-lumen-island') ?? '';
  const dataComponent = el.getAttribute('data-component') ?? '';
  const dataWidget = el.getAttribute('data-widget') ?? '';

  let islandId = explicitIslandId;
  if (!islandId) {
    let synthetic = syntheticElementIds.get(el);
    if (!synthetic) {
      const base = dataWidget || dataComponent || 'island';
      globalElementInstanceCounter += 1;
      synthetic = `${base}-${globalElementInstanceCounter}`;
      syntheticElementIds.set(el, synthetic);
    }
    islandId = synthetic;
    el.setAttribute('data-lumen-island', islandId);
  }

  const componentName = dataComponent || dataWidget || islandId;
  return { islandId, componentName };
}

export function PortalIslandManager({
  registry,
  onActiveIslandsChange,
  hydrateHandlerRef,
  pendingHydrateIdsRef,
}: PortalIslandManagerProps): React.JSX.Element | null {
  const [, setRenderVersion] = useState(0);
  const [discovered, setDiscovered] = useState<DiscoveredIsland[]>([]);

  // Element-identity keyed lifecycle refs (prevents stale string-ID collisions across DOM replacements)
  const cleanupsRef = useRef<Map<HTMLElement, () => void>>(new Map());
  const activeElementsRef = useRef<Set<HTMLElement>>(new Set());
  const clearedSsrElementsRef = useRef<WeakSet<HTMLElement>>(new WeakSet());
  const discoveredListRef = useRef<DiscoveredIsland[]>([]);
  const registryRef = useRef<IslandRegistry>(registry);
  const onActiveIslandsChangeRef = useRef(onActiveIslandsChange);

  registryRef.current = registry;
  onActiveIslandsChangeRef.current = onActiveIslandsChange;

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const cleanups = cleanupsRef.current;
    const activeElements = activeElementsRef.current;

    const notifyActiveIds = () => {
      const nextIds = new Set<string>();
      for (const item of discoveredListRef.current) {
        if (item.element.isConnected && activeElements.has(item.element)) {
          nextIds.add(item.islandId);
        }
      }
      onActiveIslandsChangeRef.current?.(nextIds);
    };

    const clearStaticFallbackIfReady = (el: HTMLElement, componentName: string) => {
      if (clearedSsrElementsRef.current.has(el)) {
        return;
      }
      if (registryRef.current[componentName]) {
        clearedSsrElementsRef.current.add(el);
        el.replaceChildren();
      }
    };

    const activateElement = (el: HTMLElement) => {
      if (!el.isConnected) {
        return;
      }

      // 1. Clean up ONLY this specific DOM element's trigger listener
      const cleanup = cleanups.get(el);
      if (cleanup) {
        cleanup();
        cleanups.delete(el);
      }

      // 2. Prevent redundant activation for the exact same connected DOM node
      if (activeElements.has(el)) {
        return;
      }
      activeElements.add(el);

      const { componentName } = resolveElementIslandIdentity(el);
      clearStaticFallbackIfReady(el, componentName);

      notifyActiveIds();
      setRenderVersion((v) => v + 1);
    };

    const scanAndAttach = () => {
      if (typeof document === 'undefined') return;

      const nodeList = document.querySelectorAll<HTMLElement>(ISLAND_SELECTOR);
      const connectedElements = new Set<HTMLElement>();
      nodeList.forEach((el) => {
        if (el.isConnected) {
          connectedElements.add(el);
        }
      });

      let activePruned = false;

      // 1. Prune detached elements from trigger listeners immediately
      cleanups.forEach((cleanup, el) => {
        if (!connectedElements.has(el) || !el.isConnected) {
          cleanup();
          cleanups.delete(el);
        }
      });

      // 2. Prune detached elements from active state so replaced nodes with same islandId must re-trigger
      activeElements.forEach((el) => {
        if (!connectedElements.has(el) || !el.isConnected) {
          activeElements.delete(el);
          activePruned = true;
        }
      });

      const prevList = discoveredListRef.current;
      const nextList: DiscoveredIsland[] = [];
      const pendingElementsToActivate: HTMLElement[] = [];
      let listChanged = prevList.length !== connectedElements.size;

      let idx = 0;
      connectedElements.forEach((el) => {
        const instanceKey = getOrCreateInstanceKey(el);
        const { islandId, componentName } = resolveElementIslandIdentity(el);
        const trigger = (el.getAttribute('data-hydrate') || 'idle') as HydrationTrigger;
        let props: Record<string, unknown> = {};

        const rawProps = el.getAttribute('data-props');
        if (rawProps) {
          try {
            props = JSON.parse(rawProps);
          } catch (e) {
            console.error(`[LumenHydration] Failed to parse data-props for island "${islandId}":`, e);
          }
        }

        const item: DiscoveredIsland = {
          instanceKey,
          islandId,
          componentName,
          trigger,
          props,
          element: el,
        };

        const prevItem = prevList[idx];
        if (
          !prevItem ||
          prevItem.element !== el ||
          prevItem.instanceKey !== instanceKey ||
          prevItem.islandId !== islandId ||
          prevItem.componentName !== componentName
        ) {
          listChanged = true;
        }
        idx += 1;

        nextList.push(item);

        // Drain any pending imperative hydration requests for this island
        if (
          pendingHydrateIdsRef?.current &&
          (pendingHydrateIdsRef.current.has(islandId) || pendingHydrateIdsRef.current.has(componentName))
        ) {
          pendingHydrateIdsRef.current.delete(islandId);
          pendingHydrateIdsRef.current.delete(componentName);
          pendingElementsToActivate.push(el);
          return;
        }

        // Skip if this exact element is already active or already has an attached trigger listener
        if (activeElements.has(el) || cleanups.has(el)) {
          return;
        }

        const cleanup = setupTrigger(el, trigger, () => {
          activateElement(el);
        });

        cleanups.set(el, cleanup);
      });

      discoveredListRef.current = nextList;

      for (const el of pendingElementsToActivate) {
        activateElement(el);
      }

      if (activePruned) {
        notifyActiveIds();
      }

      if (listChanged || activePruned || pendingElementsToActivate.length > 0) {
        setDiscovered(nextList);
      }
    };

    const hydrateById = (targetId: string) => {
      if (!targetId) return;
      scanAndAttach();
      let matched = false;
      for (const item of discoveredListRef.current) {
        if (item.element.isConnected && (item.islandId === targetId || item.componentName === targetId)) {
          matched = true;
          activateElement(item.element);
        }
      }
      if (!matched && pendingHydrateIdsRef?.current) {
        pendingHydrateIdsRef.current.add(targetId);
      }
    };

    if (hydrateHandlerRef) {
      hydrateHandlerRef.current = hydrateById;
    }

    // Initial scan and trigger attachment on mount
    scanAndAttach();

    // Observe dynamic DOM changes (e.g. client router transitions, replaced island nodes, modals)
    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        scanAndAttach();
      });
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      if (hydrateHandlerRef) {
        hydrateHandlerRef.current = null;
      }
      mutationObserver?.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
      activeElements.clear();
    };
  }, [hydrateHandlerRef, pendingHydrateIdsRef]);

  if (typeof window === 'undefined' || discovered.length === 0) {
    return null;
  }

  const portals: React.ReactPortal[] = [];

  for (const item of discovered) {
    if (item.element.isConnected && activeElementsRef.current.has(item.element)) {
      const Component = registry[item.componentName];
      if (Component) {
        // Clear static SSR fallback children once right before mounting the live portal component
        if (!clearedSsrElementsRef.current.has(item.element)) {
          clearedSsrElementsRef.current.add(item.element);
          item.element.replaceChildren();
        }
        portals.push(createPortal(React.createElement(Component, item.props), item.element, item.instanceKey));
      }
    }
  }

  return portals.length > 0 ? React.createElement(React.Fragment, null, ...portals) : null;
}

function LumenShellProvider({
  children,
  theme = 'dark',
  locale = 'en',
  currentPath = '/',
  islands = {},
}: Omit<LumenShellProps, 'disablePrismProvider'>): React.JSX.Element {
  const [dynamicIslands, setDynamicIslands] = useState<IslandRegistry>({});
  const [activeIslands, setActiveIslands] = useState<Set<string>>(() => new Set());

  const mergedIslands = useMemo<IslandRegistry>(() => ({ ...islands, ...dynamicIslands }), [islands, dynamicIslands]);

  // Synchronous ref ensures getIsland() immediately reflects registerIsland() within the same tick
  const latestRegistryRef = useRef<IslandRegistry>(mergedIslands);
  latestRegistryRef.current = mergedIslands;

  const hydrateHandlerRef = useRef<((islandId: string) => void) | null>(null);
  const pendingHydrateIdsRef = useRef<Set<string>>(new Set());

  const registerIsland = useCallback((name: string, component: IslandComponent) => {
    if (!name || !component) return;
    latestRegistryRef.current = { ...latestRegistryRef.current, [name]: component };
    setDynamicIslands((prev) => {
      if (prev[name] === component) return prev;
      return { ...prev, [name]: component };
    });
  }, []);

  const getIsland = useCallback((name: string): IslandComponent | undefined => latestRegistryRef.current[name], []);

  const hydrateIsland = useCallback((islandId: string) => {
    if (!islandId) return;
    if (hydrateHandlerRef.current) {
      hydrateHandlerRef.current(islandId);
    } else {
      pendingHydrateIdsRef.current.add(islandId);
    }
  }, []);

  const handleActiveIslandsChange = useCallback((nextIds: Set<string>) => {
    setActiveIslands((prev) => {
      if (prev.size === nextIds.size && Array.from(prev).every((id) => nextIds.has(id))) {
        return prev;
      }
      return new Set(nextIds);
    });
  }, []);

  const contextValue = useMemo<LumenContextValue>(
    () => ({
      theme,
      locale,
      currentPath,
      islands: mergedIslands,
      registerIsland,
      getIsland,
      activeIslands,
      hydrateIsland,
    }),
    [theme, locale, currentPath, mergedIslands, registerIsland, getIsland, activeIslands, hydrateIsland]
  );

  const shellDiv = React.createElement(
    'div',
    { className: 'lumen-shell', 'data-theme': theme, 'data-locale': locale },
    children,
    React.createElement(PortalIslandManager, {
      registry: mergedIslands,
      onActiveIslandsChange: handleActiveIslandsChange,
      hydrateHandlerRef,
      pendingHydrateIdsRef,
    })
  );

  return React.createElement(LumenContext.Provider, { value: contextValue }, shellDiv);
}

export function LumenShell({
  children,
  theme = 'dark',
  locale = 'en',
  currentPath = '/',
  islands = {},
  disablePrismProvider = false,
}: LumenShellProps): React.JSX.Element {
  const resolvedMode = theme === 'light' ? 'light' : 'dark';

  const providerElement = React.createElement(LumenShellProvider, {
    theme,
    locale,
    currentPath,
    islands,
    children,
  });

  if (disablePrismProvider) {
    return providerElement;
  }

  return (
    <PrismProvider
      disableCssBaseline
      config={{
        theme: {
          mode: resolvedMode,
        },
      }}
    >
      {providerElement}
    </PrismProvider>
  );
}
