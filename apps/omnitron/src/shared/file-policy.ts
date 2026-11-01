/** Shared component validation; neither UI validation nor published policy grants authorization. */
export function fileNameError(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..' || value === '.omnitron-files' ||
    /[/\\]/.test(value) || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || new TextEncoder().encode(value).length > 255) {
    return 'Enter one file name, without slashes, control characters or reserved names (maximum 255 UTF-8 bytes)';
  }
  return null;
}

/** Structural protection applies to the named entry and its ancestors, not ordinary children. */
export function fileStructureError(relative: string, protectedPaths: readonly string[] = []): string | null {
  if (!relative) return 'The exported root cannot be renamed or removed';
  if (protectedPaths.some(protectedPath => protectedPath === relative || protectedPath.startsWith(`${relative}/`))) {
    return 'This structural path is protected from rename and removal';
  }
  return null;
}
