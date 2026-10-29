import type { FileDocument, FileEntry, FileLocation, FileRoot } from '@omnitron-dev/omnitron/dto/services';
export type FileHost = { id: string; name: string; host: string; isLocal: boolean };
export type PaneSelection = { location: FileLocation; root: FileRoot; entries: FileEntry[] };
export const joinPath = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);
export const parentPath = (value: string) => value.split('/').slice(0, -1).join('/');
export const describeFileError = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function relocateBuffer<T extends { id: string; location: FileLocation; document: FileDocument }>(
  buffer: T,
  source: FileLocation & { version: string },
  destination: Pick<FileEntry, 'path' | 'version'>
): T {
  const { location } = buffer;
  if (
    location.nodeId !== source.nodeId ||
    location.rootId !== source.rootId ||
    (location.path !== source.path && !location.path.startsWith(`${source.path}/`))
  )
    return buffer;
  const moved = { ...location, path: destination.path + location.path.slice(source.path.length) };
  return {
    ...buffer,
    id: JSON.stringify(moved),
    location: moved,
    document:
      location.path === source.path && buffer.document.version === source.version
        ? { ...buffer.document, version: destination.version }
        : buffer.document,
  };
}
export function fileName(value: string): string {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value === '.omnitron-files' ||
    /[/\\]/.test(value) ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32) ||
    new TextEncoder().encode(value).length > 255
  )
    throw new Error('Enter a single file name, without slashes or control characters');
  return value;
}
export function relativePath(value: string): string {
  const result = value.replace(/^\/+|\/+$/g, '');
  if (result) result.split('/').forEach(fileName);
  return result;
}
export function fileBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let n = value / 1024,
    index = 0;
  while (n >= 1024 && index < units.length - 1) {
    n /= 1024;
    index++;
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[index]}`;
}
export function visibleEntries(
  entries: FileEntry[],
  query: string,
  hidden: boolean,
  sort: 'name' | 'size' | 'modifiedAt',
  descending: boolean
) {
  return entries
    .filter(
      (e) => (hidden || !e.name.startsWith('.')) && e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    )
    .sort((a, b) => {
      if ((a.kind === 'directory') !== (b.kind === 'directory')) return a.kind === 'directory' ? -1 : 1;
      const order = sort === 'size' ? a.size - b.size : a[sort].localeCompare(b[sort], undefined, { numeric: true });
      return (descending ? -1 : 1) * order;
    });
}
export function lineEnding(content: string): '\n' | '\r\n' | '\r' | 'mixed' {
  const kinds = new Set(content.match(/\r\n|\r|\n/g) ?? []);
  return kinds.size > 1 ? 'mixed' : ((kinds.values().next().value ?? '\n') as '\n' | '\r\n' | '\r');
}
export async function encodeChunk(bytes: Uint8Array): Promise<{ data: string; sha256: string }> {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return {
    data: btoa(binary),
    sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
