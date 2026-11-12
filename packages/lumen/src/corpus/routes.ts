import { posix } from 'node:path';

/** A route is an absolute URL path, not a filesystem path or external URL. */
export function normalizeRoute(route: string): string {
  if (
    !route.startsWith('/') ||
    route.startsWith('//') ||
    /[?#\\]/.test(route) ||
    [...route].some((char) => char.charCodeAt(0) <= 32)
  ) {
    throw new Error(`Invalid document route: ${JSON.stringify(route)}`);
  }
  const segments = route.split('/');
  if (segments.some((segment) => ['.', '..'].includes(decodeURIComponent(segment)))) {
    throw new Error(`Document route traverses its root: ${JSON.stringify(route)}`);
  }
  return route.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

export function documentRoute(relativePath: string, frontmatter: Record<string, unknown>): string {
  const stem = relativePath.replace(/\\/g, '/').replace(/\.(?:pdx|mdx?)$/, '');
  const slug = typeof frontmatter['slug'] === 'string' ? frontmatter['slug'].trim() : '';
  const route = slug
    ? slug.startsWith('/')
      ? slug
      : `/${posix.join(posix.dirname(stem), slug)}`
    : `/${stem.replace(/(?:^|\/)index$/, '')}`;
  return normalizeRoute(route);
}
