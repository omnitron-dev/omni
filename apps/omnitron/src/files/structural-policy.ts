import path from 'node:path';
import { fileStructureError } from '../shared/file-policy.js';

/** Protect host directory structure, while retaining administrator access to ordinary files inside it. */
const SYSTEM_PATHS = [
  '/bin', '/sbin', '/usr', '/etc', '/var', '/boot', '/dev', '/proc', '/sys', '/run', '/lib', '/lib64',
  '/home', '/root', '/tmp', '/opt', '/srv', '/mnt', '/media', '/lost+found',
  '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/lib64', '/usr/libexec', '/usr/local', '/var/lib', '/var/log', '/var/run',
  '/Users', '/Applications', '/System', '/Library', '/Volumes', '/private', '/private/etc', '/private/var', '/private/tmp',
  '/System/Volumes/Data', '/System/Volumes/Data/Users', '/System/Volumes/Data/Library', '/System/Volumes/Data/Applications',
  '/System/Volumes/Data/private', '/System/Volumes/Data/private/etc', '/System/Volumes/Data/private/var', '/System/Volumes/Data/private/tmp',
] as const;

export function structuralPaths(root: string, configured: readonly string[] = []): string[] {
  const base = path.resolve(root);
  return [...new Set([...configured, ...SYSTEM_PATHS.flatMap(protectedPath => {
    const relative = path.relative(base, protectedPath);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? [relative.split(path.sep).join('/')] : [];
  })])];
}

export function assertStructuralChange(root: string, relative: string, configured: readonly string[] = []): void {
  const protectedPaths = structuralPaths(root, configured);
  const error = process.platform === 'darwin'
    ? fileStructureError(relative.toLowerCase(), protectedPaths.map(value => value.toLowerCase()))
    : fileStructureError(relative, protectedPaths);
  if (error) throw new Error(error);
}
