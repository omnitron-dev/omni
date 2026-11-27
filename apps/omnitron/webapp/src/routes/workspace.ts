import { createPath, parsePath, useLocation } from 'react-router-dom';

export interface Workspace {
  project: string | null;
  stack: string | null;
}

function segment(value?: string): string | null {
  if (!value) return null;
  try {
    const name = decodeURIComponent(value);
    return name.includes('/') ? null : name;
  } catch { return null; }
}

/** Detail paths carry their owner. Only lists use the optional stack filter. */
export function workspaceLocation({ pathname, search = '' }: { pathname: string; search?: string }) {
  const parts = pathname.split('/').filter(Boolean);
  const project = parts[0] === 'projects' ? segment(parts[1]) : null;
  const page = project ? parts.slice(2) : parts;
  const stackDetail = page[0] === 'stacks' && page.length === 2;
  const appDetail = page[0] === 'apps' && page.length === 3;
  const stack = project && (stackDetail || appDetail ? segment(page[1]) : new URLSearchParams(search).get('stack') || null);
  return { project, stack, pagePath: '/' + page.join('/'), stackDetail, appDetail };
}

export function useWorkspace() {
  return workspaceLocation(useLocation());
}

export function workspaceHref({ project, stack }: Workspace, path = '/'): string {
  if (!project) return path;
  const { pathname = '/', search, hash } = parsePath(path);
  const params = new URLSearchParams(search);
  if (stack) params.set('stack', stack);
  else params.delete('stack');
  return createPath({ pathname: '/projects/' + encodeURIComponent(project) + (pathname === '/' ? '' : pathname), search: params.toString(), hash });
}

export function stackHref(project: string, stack: string) {
  return workspaceHref({ project, stack: null }, '/stacks/' + encodeURIComponent(stack));
}

export function appHref(project: string, stack: string, app: string) {
  return workspaceHref({ project, stack: null }, '/apps/' + encodeURIComponent(stack) + '/' + encodeURIComponent(app));
}

export function releaseHref(project: string | null, id: string, stack: string | null = null) {
  return workspaceHref({ project, stack }, '/releases/' + encodeURIComponent(id));
}

export function pipelineRunHref(run: string) {
  return '/pipelines?' + new URLSearchParams({ view: 'runs', run });
}

export function flowHref(
  workspace: { project: string | null; stack?: string | null },
  params: Record<string, string> = {}
): string {
  const search = new URLSearchParams(params).toString();
  return workspaceHref({ project: workspace.project, stack: workspace.stack ?? null }, '/flows' + (search ? '?' + search : ''));
}
