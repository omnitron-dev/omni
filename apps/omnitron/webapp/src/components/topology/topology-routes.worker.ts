import { routeTopology, type GraphGeometry } from './route-geometry';
self.onmessage = (event: MessageEvent<GraphGeometry>) => {
  try {
    self.postMessage({ routes: routeTopology(event.data) });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
