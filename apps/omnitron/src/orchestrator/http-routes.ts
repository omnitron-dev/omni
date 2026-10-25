import type { IProcessEntry } from '../config/types.js';

/** Adapt declared methods and pathnames to Titan's ordered, null-fallthrough handlers. */
export function compileCustomRoutes(
  routes: NonNullable<IProcessEntry['customRoutes']>
): Array<(request: Request) => Promise<Response | null>> {
  return routes.map((route) => {
    // Titan accepts fall-through handlers, while defineSystem declares routes.
    // Preserve the method and pathname boundary when adapting between them.
    const pattern = new RegExp(
      '^' +
        route.pattern
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        '$'
    );
    return async (request: Request) => {
      if (request.method !== route.method || !pattern.test(new URL(request.url).pathname)) return null;
      return route.handler(request);
    };
  });
}
