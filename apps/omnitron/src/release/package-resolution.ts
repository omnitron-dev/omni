/** Look up installed packages without consulting NODE_PATH or user-wide modules.
 * In a materialized release every dependency has its own explicit link. */
export async function resolveInstalledDependency(directory: string, name: string, directOnly = false): Promise<string | undefined> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) || name.split('/').some(part => part.startsWith('.')))
    throw Error('Invalid dependency name: ' + name);
  let current = directory;
  while (true) {
    if (path.basename(current) !== 'node_modules') {
      const candidate = path.join(current, 'node_modules', name);
      try {
        await fs.access(path.join(candidate, 'package.json'));
        return candidate;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      }
    }
    const parent = path.dirname(current);
    if (directOnly || parent === current) return undefined;
    current = parent;
  }
}
