import type { Dirent } from 'node:fs';
import { assertReleaseLoaderEnvironment } from './target-runtime.js';

export type ClosureLibrarySource = Iterable<string | undefined> | { verifiedRoot: string };

/**
 * Locate shared-object directories packaged inside an application's `.omnitron`
 * closure (`node_modules/.omnitron/<index>/...`).
 *
 * `stageApplicationClosure` flattens each dependency into a numbered directory
 * under `node_modules/.omnitron/<index>`, breaking sibling relative `DT_RPATH` /
 * `DT_RUNPATH` entries such as `$ORIGIN/../../sharp-libvips-linux-x64/lib` when
 * Node resolves symlinks before `dlopen()`. Prepending the closure's physical
 * shared-library directories to `LD_LIBRARY_PATH` when spawning child processes
 * on Linux restores dynamic-linker resolution without mutating the verified
 * `.installed` payload tree on disk.
 * Pass `{ verifiedRoot }` for an admitted installation: dependency-free roots
 * never borrow a parent's closure, and invalid library paths fail closed.
 * Candidate arrays retain ancestor discovery for development sources.
 *
 * Self-contained (`process.getBuiltinModule` only, zero module-scope value imports)
 * so Vitest/Rolldown/esbuild never rewrite identifiers inside `.toString()`.
 */
export function closureLibraryDirectories(source: ClosureLibrarySource): string[] {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const verified = typeof source === 'object' && source !== null && 'verifiedRoot' in source;
  let closureRoot: string | null = null;
  if (verified) {
    const root = source.verifiedRoot;
    if (typeof root !== 'string' || !path.isAbsolute(root) || fs.realpathSync(root) !== root || !fs.lstatSync(root).isDirectory())
      throw Error('Verified closure root must be a physical absolute directory: ' + root);
    if (!fs.lstatSync(path.join(root, '.omnitron-closure.json')).isFile())
      throw Error('Verified closure record must be a physical file: ' + root);
    // A dependency-free release is valid. Its parent directory is never an
    // alternative source of libraries, even if that parent is another closure.
    for (const directory of [path.join(root, 'node_modules'), path.join(root, 'node_modules', '.omnitron')]) {
      try {
        if (!fs.lstatSync(directory).isDirectory() || fs.realpathSync(directory) !== directory)
          throw Error('Verified closure library directory must be physical: ' + directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    }
    closureRoot = root;
  } else for (const candidate of source) {
    if (!candidate) continue;
    let current = path.resolve(candidate);
    for (;;) {
      try {
        if (
          fs.lstatSync(path.join(current, '.omnitron-closure.json')).isFile() &&
          fs.lstatSync(path.join(current, 'node_modules')).isDirectory() &&
          fs.lstatSync(path.join(current, 'node_modules', '.omnitron')).isDirectory()
        ) {
          closureRoot = fs.realpathSync(current);
          break;
        }
      } catch {
        // Candidate may be a file inside the closure or an uncreated path.
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (closureRoot) break;
  }
  if (!closureRoot) return [];

  const omnitronDir = path.join(closureRoot, 'node_modules', '.omnitron');
  const rootPrefix = closureRoot + path.sep;
  const sharedObject = /\.so(?:\.[0-9]+)*$/;
  const compareNames = (a: string, b: string): number => {
    const na = /^[0-9]+$/.test(a) ? Number(a) : NaN;
    const nb = /^[0-9]+$/.test(b) ? Number(b) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  };

  const directories: string[] = [];
  const seen = new Set<string>();
  const scanPackageDir = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let entries: Dirent[];
    try {
      if (verified && fs.realpathSync(dir) !== dir)
        throw Error('Verified closure library directory must be physical: ' + dir);
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (verified) throw error;
      return;
    }
    entries.sort((a, b) => compareNames(a.name, b.name));
    let hasSharedObject = false;
    for (const entry of entries) {
      if (!sharedObject.test(entry.name)) continue;
      if (entry.isFile()) {
        hasSharedObject = true;
        if (!verified) break;
      }
      if (entry.isSymbolicLink()) {
        try {
          const resolved = fs.realpathSync(path.join(dir, entry.name));
          const containedFile = resolved.startsWith(rootPrefix) && fs.statSync(resolved).isFile();
          if (verified && !containedFile)
            throw Error('Verified closure library leaves its root or is not a file: ' + path.join(dir, entry.name));
          if (containedFile) {
            hasSharedObject = true;
            if (!verified) break;
          }
        } catch (error) {
          if (verified) throw error;
          // Ignore broken or escaping links.
        }
      }
    }
    if (hasSharedObject && !seen.has(dir)) {
      seen.add(dir);
      directories.push(dir);
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      scanPackageDir(path.join(dir, entry.name), depth + 1);
    }
  };

  let packages: Dirent[];
  try {
    packages = fs.readdirSync(omnitronDir, { withFileTypes: true });
  } catch (error) {
    if (verified) throw error;
    return [];
  }
  packages.sort((a, b) => compareNames(a.name, b.name));
  for (const pkg of packages) {
    if (!pkg.isDirectory()) continue;
    scanPackageDir(path.join(omnitronDir, pkg.name), 0);
  }
  return directories;
}

export function mergeLibraryPath(
  directories: readonly string[],
  ...existing: Array<string | undefined>
): string | undefined {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (segment: string): void => {
    if (!segment || seen.has(segment)) return;
    seen.add(segment);
    ordered.push(segment);
  };
  for (const dir of directories) push(dir);
  for (const value of existing) {
    if (!value) continue;
    for (const part of value.split(':')) push(part);
  }
  return ordered.length > 0 ? ordered.join(':') : undefined;
}

/**
 * Return a child spawn environment with packaged `.omnitron` shared-library
 * directories prepended to `LD_LIBRARY_PATH` on Linux.
 *
 * Returns `env` unchanged (without allocating or mutating) on non-Linux hosts
 * or when no packaged `.so` directories exist in the closure.
 */
export function withClosureLibraryPath(
  env: Readonly<Record<string, string | undefined>> | undefined,
  source: ClosureLibrarySource,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Record<string, string> | undefined {
  if (typeof source === 'object' && source !== null && 'verifiedRoot' in source) {
    assertReleaseLoaderEnvironment(env);
    assertReleaseLoaderEnvironment(inheritedEnv);
  }
  if (platform !== 'linux') return env as Record<string, string> | undefined;
  const directories = closureLibraryDirectories(source);
  if (directories.length === 0) return env as Record<string, string> | undefined;
  const libraryPath = mergeLibraryPath(directories, env?.['LD_LIBRARY_PATH'], inheritedEnv['LD_LIBRARY_PATH']);
  if (!libraryPath) return env as Record<string, string> | undefined;
  const normalized: Record<string, string> = {};
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') normalized[key] = value;
    }
  }
  normalized['LD_LIBRARY_PATH'] = libraryPath;
  return normalized;
}
