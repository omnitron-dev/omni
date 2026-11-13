import React, { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { parseIslandProps, parseHydrationTrigger } from '@omnitron-dev/lumen-ast/islands';
import { LumenContext, type LumenContextValue, type IslandComponent, type IslandRegistry } from './context.js';
import { setupTrigger, type HydrationTrigger } from './triggers.js';
import { DocumentTabs } from './document-tabs.js';

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
  trigger?: HydrationTrigger;
  props?: Record<string, unknown>;
  metadataError?: Error;
  rawProps: string | null;
  rawTrigger: string | null;
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

function discoverIsland(element: HTMLElement, previous?: DiscoveredIsland): DiscoveredIsland {
  const { islandId, componentName } = resolveElementIslandIdentity(element);
  const rawProps = element.getAttribute('data-props');
  const rawTrigger = element.getAttribute('data-hydrate');
  if (previous?.islandId === islandId && previous.componentName === componentName &&
    previous.rawProps === rawProps && previous.rawTrigger === rawTrigger) return previous;
  const item = { instanceKey: getOrCreateInstanceKey(element), islandId, componentName, element, rawProps, rawTrigger };
  try {
    return { ...item, props: rawProps === null ? {} : parseIslandProps(rawProps), trigger: parseHydrationTrigger(rawTrigger ?? 'idle') };
  } catch (error) {
    const metadataError = error instanceof Error ? error : new Error('Invalid island metadata');
    console.error(`[LumenHydration] Invalid metadata for island "${islandId}":`, metadataError);
    return { ...item, metadataError };
  }
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
      if (!el.isConnected) return;
      let item = discoveredListRef.current.find(candidate => candidate.element === el);
      const identity = resolveElementIslandIdentity(el);
      const triggerChanged = item?.rawTrigger !== el.getAttribute('data-hydrate');
      // Attributes may change and an interaction may fire in the same task, before MutationObserver runs.
      if (!item || item.rawProps !== el.getAttribute('data-props') || triggerChanged ||
        item.islandId !== identity.islandId || item.componentName !== identity.componentName) {
        scanAndAttach();
        if (triggerChanged) return;
        item = discoveredListRef.current.find(candidate => candidate.element === el);
      }
      if (!item || item.metadataError) return;

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

      clearStaticFallbackIfReady(el, item.componentName);

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
      const previousByElement = new Map(prevList.map(item => [item.element, item]));
      const nextList = [...connectedElements].map(el => discoverIsland(el, previousByElement.get(el)));
      const pendingElementsToActivate: HTMLElement[] = [];
      const listChanged = prevList.length !== nextList.length || nextList.some((item, index) => item !== prevList[index]);
      // Publish metadata before attaching triggers: visible fallback can activate synchronously.
      discoveredListRef.current = nextList;

      for (const item of nextList) {
        const { element: el, islandId, componentName } = item;
        const previous = previousByElement.get(el);
        if (item.metadataError || previous?.rawTrigger !== item.rawTrigger) {
          cleanups.get(el)?.();
          cleanups.delete(el);
        }
        if (item.metadataError) {
          el.setAttribute('data-lumen-error', 'metadata');
          if (activeElements.delete(el)) activePruned = true;
          continue;
        }
        el.removeAttribute('data-lumen-error');

        // Drain any pending imperative hydration requests for this island
        if (
          pendingHydrateIdsRef?.current &&
          (pendingHydrateIdsRef.current.has(islandId) || pendingHydrateIdsRef.current.has(componentName))
        ) {
          pendingHydrateIdsRef.current.delete(islandId);
          pendingHydrateIdsRef.current.delete(componentName);
          pendingElementsToActivate.push(el);
          continue;
        }

        // Skip if this exact element is already active or already has an attached trigger listener
        if (activeElements.has(el) || cleanups.has(el)) {
          continue;
        }

        const cleanup = setupTrigger(el, item.trigger!, () => {
          activateElement(el);
        });
        if (activeElements.has(el)) cleanup();
        else cleanups.set(el, cleanup);
      }

      for (const el of pendingElementsToActivate) {
        activateElement(el);
      }

      if (activePruned || listChanged) {
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
        if (!item.metadataError && item.element.isConnected && (item.islandId === targetId || item.componentName === targetId)) {
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
        attributes: true,
        attributeFilter: ['data-props', 'data-hydrate', 'data-component', 'data-widget', 'data-lumen-island'],
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
    if (item.element.isConnected && item.metadataError) {
      if (!clearedSsrElementsRef.current.has(item.element)) {
        clearedSsrElementsRef.current.add(item.element);
        item.element.replaceChildren();
      }
      portals.push(createPortal(<p className="lumen-island-error" role="alert">Unable to load this component: invalid island metadata.</p>, item.element, item.instanceKey));
      continue;
    }
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

  const mergedIslands = useMemo<IslandRegistry>(() => ({ LumenDocumentTabs: DocumentTabs, ...islands, ...dynamicIslands }), [islands, dynamicIslands]);

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
      mode={resolvedMode}
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
