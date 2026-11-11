import React, { useState, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PrismProvider } from '@omnitron-dev/prism';
import { LumenContext, type LumenContextValue, type IslandRegistry } from './context.js';
import { setupTrigger, type HydrationTrigger } from './triggers.js';

export interface LumenShellProps {
  children?: ReactNode;
  theme?: 'light' | 'dark' | string;
  locale?: string;
  currentPath?: string;
  islands?: IslandRegistry;
  disablePrismProvider?: boolean;
}

interface DiscoveredIsland {
  islandId: string;
  componentName: string;
  trigger: HydrationTrigger;
  props: Record<string, unknown>;
  element: HTMLElement;
}

export function PortalIslandManager({ registry }: { registry: IslandRegistry }): React.JSX.Element | null {
  const [activeIslands, setActiveIslands] = useState<Set<string>>(() => new Set());
  const [discovered, setDiscovered] = useState<DiscoveredIsland[]>([]);

  // Persistent refs for decoupled observer and listener lifecycle
  const cleanupsRef = useRef<Map<string, () => void>>(new Map());
  const activeIslandsRef = useRef<Set<string>>(new Set());
  const discoveredMapRef = useRef<Map<string, DiscoveredIsland>>(new Map());

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const cleanups = cleanupsRef.current;

    const activateIsland = (islandId: string) => {
      // 1. Clean up ONLY this specific island's trigger listener without touching others
      const cleanup = cleanups.get(islandId);
      if (cleanup) {
        cleanup();
        cleanups.delete(islandId);
      }

      // 2. Prevent redundant trigger executions
      if (activeIslandsRef.current.has(islandId)) {
        return;
      }
      activeIslandsRef.current.add(islandId);

      // 3. Dispatch state change to mount the portal
      setActiveIslands((prev) => {
        if (prev.has(islandId)) return prev;
        const next = new Set(prev);
        next.add(islandId);
        return next;
      });
    };

    const scanAndAttach = () => {
      if (typeof document === 'undefined') return;

      const elements = document.querySelectorAll<HTMLElement>('.lumen-portal-island, [data-lumen-island]');

      let listChanged = false;
      const currentDiscovered = discoveredMapRef.current;
      const newDiscoveredMap = new Map<string, DiscoveredIsland>();
      const islandsList: DiscoveredIsland[] = [];

      elements.forEach((el) => {
        const islandId = el.getAttribute('data-lumen-island') ?? '';
        const componentName = el.getAttribute('data-component') || islandId;
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
          islandId,
          componentName,
          trigger,
          props,
          element: el,
        };

        islandsList.push(item);
        newDiscoveredMap.set(islandId, item);

        if (!currentDiscovered.has(islandId) || currentDiscovered.get(islandId)?.element !== el) {
          listChanged = true;
        }

        // If island is already active or trigger listener is already registered, skip setup
        if (activeIslandsRef.current.has(islandId) || cleanups.has(islandId)) {
          return;
        }

        // Attach listener for this island only
        const cleanup = setupTrigger(el, trigger, () => {
          activateIsland(islandId);
        });

        cleanups.set(islandId, cleanup);
      });

      // Prune dead cleanups for elements disconnected from DOM before hydrating
      cleanups.forEach((cleanup, id) => {
        const item = newDiscoveredMap.get(id);
        if (!item || !item.element.isConnected) {
          cleanup();
          cleanups.delete(id);
        }
      });

      if (listChanged || currentDiscovered.size !== newDiscoveredMap.size) {
        discoveredMapRef.current = newDiscoveredMap;
        setDiscovered(islandsList);
      }
    };

    // Initial scan and trigger attachment on mount
    scanAndAttach();

    // Observe dynamic DOM changes (e.g. client router transitions, modals)
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

    // Teardown ONLY on full component unmount
    return () => {
      mutationObserver?.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    };
  }, []); // Run ONCE on client mount

  if (typeof window === 'undefined' || discovered.length === 0) {
    return null;
  }

  const portals: React.ReactPortal[] = [];

  for (const item of discovered) {
    if (activeIslands.has(item.islandId)) {
      const Component = registry[item.componentName];
      if (Component) {
        portals.push(createPortal(React.createElement(Component, item.props), item.element, item.islandId));
      }
    }
  }

  return portals.length > 0 ? React.createElement(React.Fragment, null, ...portals) : null;
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

  const contextValue: LumenContextValue = {
    theme,
    locale,
    currentPath,
    islands,
    registerIsland: () => {},
    getIsland: (name: string) => islands[name],
    activeIslands: new Set<string>(),
    hydrateIsland: () => {},
  };

  const shellDiv = React.createElement(
    'div',
    { className: 'lumen-shell', 'data-theme': theme, 'data-locale': locale },
    children,
    React.createElement(PortalIslandManager, { registry: islands })
  );

  const contextProvider = React.createElement(LumenContext.Provider, { value: contextValue }, shellDiv);

  if (disablePrismProvider) {
    return contextProvider;
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
      {contextProvider}
    </PrismProvider>
  );
}
