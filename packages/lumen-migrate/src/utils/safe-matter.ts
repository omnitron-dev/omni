import { sep } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

import matter from 'gray-matter';

export class DisabledFrontmatterEngineError extends Error {
  constructor(engineName: string) {
    super(`Executable frontmatter engine "${engineName}" is disabled.`);
    this.name = 'DisabledFrontmatterEngineError';
  }
}

const EXECUTABLE_FENCE_RE = /^---(?:js|javascript|coffee|coffeescript)\b/i;

function createDisabledEngine(name: string): () => never {
  return () => {
    throw new DisabledFrontmatterEngineError(name);
  };
}

export interface SafeMatterResult {
  data: Record<string, unknown>;
  content: string;
}

export function parseSafeFrontmatter(rawContent: string): SafeMatterResult {
  if (EXECUTABLE_FENCE_RE.test(rawContent)) {
    throw new DisabledFrontmatterEngineError('script');
  }

  const parsed = matter(rawContent, {
    engines: {
      js: createDisabledEngine('js'),
      javascript: createDisabledEngine('javascript'),
      coffee: createDisabledEngine('coffee'),
      coffeescript: createDisabledEngine('coffeescript'),
    },
  });

  const data =
    parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>)
      : {};

  return {
    data,
    content: typeof parsed.content === 'string' ? parsed.content : '',
  };
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
