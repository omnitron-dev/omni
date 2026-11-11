import React, { type ReactNode } from 'react';
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

function safeSerializeProps(props: unknown): string {
  try {
    const seen = new WeakSet();
    return JSON.stringify(props ?? {}, (_, v) => {
      if (typeof v === 'bigint') {
        return v.toString();
      }
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) {
          return '[Circular]';
        }
        seen.add(v);
      }
      return v;
    });
  } catch {
    return '{}';
  }
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
      'data-hydrate': hydrate,
      'data-props': safeSerializeProps(props),
      style,
    },
    children
  );
}
