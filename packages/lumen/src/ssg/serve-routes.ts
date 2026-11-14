import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { normalizeRoute } from '../corpus/routes.js';

/** Serve directory output with the same URLs as a static host. */
export function directoryRouteRedirects(directory: string): Plugin {
  const root = resolve(directory);
  const middleware = (base: string): Connect.NextHandleFunction => (request, response, next) => {
    const requestUrl = request.url;
    if (!requestUrl || !['GET', 'HEAD'].includes(request.method ?? '') ||
      (request.headers.accept && !/text\/html|\*\/\*/.test(request.headers.accept))) return next();
    const query = requestUrl.indexOf('?');
    const pathname = query < 0 ? requestUrl : requestUrl.slice(0, query);
    const baseRoot = base.replace(/\/$/, '');
    if ((!pathname.startsWith(base) && pathname !== baseRoot) || pathname.endsWith('/')) return next();

    let route: string;
    try {
      route = pathname === baseRoot ? '/' : decodeURIComponent(`/${pathname.slice(base.length)}`);
      if (normalizeRoute(route) !== route) return next();
    } catch { return next(); }

    const redirect = async () => {
      try {
        const [realRoot, index] = await Promise.all([
          realpath(root), realpath(resolve(root, `.${route}`, 'index.html')),
        ]);
        const within = relative(realRoot, index);
        if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !(await stat(index)).isFile()) return next();
        response.statusCode = 308;
        response.setHeader('Location', `${pathname}/${query < 0 ? '' : requestUrl.slice(query)}`);
        return void response.end();
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return next();
        return next(error);
      }
    };
    return void redirect();
  };

  return {
    name: 'lumen-directory-routes',
    configureServer(server) { server.middlewares.use(middleware(server.config.base)); },
    configurePreviewServer(server) { server.middlewares.use(middleware(server.config.base)); },
  };
}
