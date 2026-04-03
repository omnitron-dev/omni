// Browser stub for Node.js 'path' module
export function join(...segments: string[]): string {
  return segments.join('/').replace(/\/+/g, '/');
}

export function resolve(...segments: string[]): string {
  return join(...segments);
}

export function basename(p: string, ext?: string): string {
  const base = p.split('/').pop() || '';
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function dirname(p: string): string {
  const parts = p.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

export function extname(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

export const sep = '/';
export const delimiter = ':';

export default { join, resolve, basename, dirname, extname, sep, delimiter };
