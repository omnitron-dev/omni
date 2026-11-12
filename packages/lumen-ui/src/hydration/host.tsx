import React, { type ReactNode } from 'react';
import { serializeIslandProps, parseHydrationTrigger } from '@omnitron-dev/lumen-ast/islands';
import type { HydrationTrigger } from './triggers.js';

export interface PortalIslandHostProps {
  islandId: string;
  component?: string;
  hydrate?: HydrationTrigger;
  props?: Record<string, unknown>;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function PortalIslandHost({
  islandId,
  component,
  hydrate = 'idle',
  props = {},
  children,
  className = 'lumen-portal-island',
  style,
}: PortalIslandHostProps): React.JSX.Element {
  return React.createElement(
    'div',
    {
      className,
      'data-lumen-island': islandId,
      ...(component ? { 'data-component': component } : {}),
      'data-hydrate': parseHydrationTrigger(hydrate),
      'data-props': serializeIslandProps(props),
      style,
    },
    children
  );
}
