import { useEffect, useState } from 'react';
import { BaseEdge, type Edge, type EdgeProps, type Node } from '@xyflow/react';
import type { GraphGeometry, GraphRoutes, RoutedLink } from './route-geometry';
import { TOPOLOGY_CARD_HEIGHT, TOPOLOGY_CARD_WIDTH } from './topology-layout';

interface RouteState {
  key: string;
  routes?: GraphRoutes;
  error?: string;
}

/** Only geometry invalidates routes. Polls, selection and camera movement do not start new workers. */
export function useTopologyRoutes(nodes: Node[], edges: Edge[], enabled: boolean) {
  const key =
    enabled && edges.length && nodes.length
      ? JSON.stringify({
          cards: nodes.map(({ id, position }) => ({
            id,
            ...position,
            width: TOPOLOGY_CARD_WIDTH,
            height: TOPOLOGY_CARD_HEIGHT,
          })),
          links: edges.map(({ id, source, target }) => ({ id, source, target })),
        } satisfies GraphGeometry)
      : '';
  const [result, setResult] = useState<RouteState | null>(null);
  useEffect(() => {
    if (!key) return undefined;
    let worker: Worker | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (state: Omit<RouteState, 'key'>) => {
      worker?.terminate();
      clearTimeout(deadline);
      setResult({ key, ...state });
    };
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('./topology-routes.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event) => finish(event.data);
        worker.onerror = (event) => finish({ error: event.message || 'Routing worker unavailable' });
        deadline = setTimeout(
          () => finish({ error: 'Routing exceeded its time budget. Select a stack to narrow the map.' }),
          10_000
        );
        worker.postMessage(JSON.parse(key));
      } catch (err) {
        finish({ error: err instanceof Error ? err.message : String(err) });
      }
    }, 60);
    return () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      worker?.terminate();
    };
  }, [key]);
  return {
    routes: result?.key === key ? result.routes : undefined,
    pending: Boolean(key && result?.key !== key),
    error: result?.key === key ? result.error : undefined,
  };
}

export function TopologyEdge({ id, data, markerEnd, style, label, labelStyle, labelBgStyle }: EdgeProps) {
  const route = data?.route as RoutedLink | undefined;
  if (!route) return null;
  const start = route.points[0]!;
  const path = route.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        label={label}
        labelX={route.label.x}
        labelY={route.label.y}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
      />
      <circle cx={start.x} cy={start.y} r={2.5} fill={style?.stroke} opacity={style?.opacity} />
    </>
  );
}
