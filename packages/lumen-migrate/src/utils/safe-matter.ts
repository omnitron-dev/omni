import { sep } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

import { parseSafeFrontmatter as parseMetadata } from '@omnitron-dev/lumen-ast';

export class DisabledFrontmatterEngineError extends Error {
  constructor(engineName: string) {
    super(`Executable frontmatter engine "${engineName}" is disabled.`);
    this.name = 'DisabledFrontmatterEngineError';
  }
}

export interface SafeMatterResult {
  data: Record<string, unknown>;
  content: string;
}

export function parseSafeFrontmatter(rawContent: string): SafeMatterResult {
  const parsed = parseMetadata(rawContent);
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error?.code === 'EXECUTABLE_FRONTMATTER_FORBIDDEN') throw new DisabledFrontmatterEngineError('script');
  if (error) throw new Error(error.message);
  return { data: parsed.data, content: parsed.content };
}

export interface PathContainmentResult {
  isSymlink: boolean;
  realPath: string;
  escaped: boolean;
}

export function inspectPathContainment(rootRealPath: string, candidatePath: string): PathContainmentResult {
  const lstat = lstatSync(candidatePath);
  const isSymlink = lstat.isSymbolicLink();

  let realPath: string;
  try {
    realPath = realpathSync(candidatePath);
  } catch {
    return {
      isSymlink,
      realPath: '',
      escaped: true,
    };
  }

  const normalizedRoot =
    rootRealPath.length > 1 && rootRealPath.endsWith(sep) ? rootRealPath.slice(0, -1) : rootRealPath;
  const escaped =
    normalizedRoot === sep
      ? !realPath.startsWith(sep)
      : realPath !== normalizedRoot && !realPath.startsWith(`${normalizedRoot}${sep}`);

  return {
    isSymlink,
    realPath,
    escaped,
  };
}
