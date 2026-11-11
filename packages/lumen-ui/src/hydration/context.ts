import { createContext, useContext, type ComponentType } from 'react';

export type IslandComponent = ComponentType<any>;
export type IslandRegistry = Record<string, IslandComponent>;

export interface LumenContextValue {
  theme: string;
  locale: string;
  currentPath: string;
  islands: IslandRegistry;
  registerIsland: (name: string, component: IslandComponent) => void;
  getIsland: (name: string) => IslandComponent | undefined;
  activeIslands: Set<string>;
  hydrateIsland: (islandId: string) => void;
}

export const defaultLumenContextValue: LumenContextValue = {
  theme: 'dark',
  locale: 'en',
  currentPath: '/',
  islands: {},
  registerIsland: () => {},
  getIsland: () => undefined,
  activeIslands: new Set<string>(),
  hydrateIsland: () => {},
};

export const LumenContext = createContext<LumenContextValue>(defaultLumenContextValue);

export const useLumen = (): LumenContextValue => useContext(LumenContext);
