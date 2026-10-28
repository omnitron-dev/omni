import { quoteShellArgument as quote } from './shell-command';

/** Preserve the exact application handle and registry node across Console navigation. */
export function logHref(app: string, node?: string): string {
  const params = new URLSearchParams({ app });
  if (node) params.set('node', node);
  return `/logs?${params}`;
}

/** POSIX shell quoting: application names are data, never executable syntax. */
export function logCommand(app: string, node?: string): string {
  return `omnitron logs ${quote(app)}${node ? ` --node ${quote(node)}` : ''} -n 100`;
}
