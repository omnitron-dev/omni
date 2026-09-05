/**
 * Every local import must resolve to a file the repository actually has.
 *
 * Commit `8c4f550` shipped `backend-status.store.ts` importing
 * `src/utils/backend-health` while that file was untracked. The working tree
 * built, the tests passed, and a fresh clone at that commit could not compile
 * the console. Nothing in the working tree can see this: the file is right
 * there on disk.
 *
 * The cause is the commit protocol this session adopted — path-scoped
 * `git commit -F msg -- <paths>` — which was introduced because two agents
 * sharing a repository kept sweeping each other's files into commits. It
 * fixed that and created this: a new file omitted from the path list is
 * silently left behind, and only the repository knows.
 *
 * So the check has to ask git, not the filesystem. "The import target exists"
 * is the question the working tree can answer and it is not the question
 * that matters.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: packageRoot })
  .toString()
  .trim();

/** Every path git has, repo-relative. */
function trackedFiles(): Set<string> {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  return new Set(out.toString().split('\0').filter(Boolean));
}

/** Local import specifiers — relative, or the console's `src/…` alias. */
function localSpecifiers(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const spec = m[1]!;
      if (spec.startsWith('.') || spec.startsWith('src/')) found.add(spec);
    }
  }
  return [...found];
}

/**
 * Resolve a specifier to a repo-relative path, trying the extensions a
 * TypeScript ESM project uses. `./foo.js` is written for the emitted output
 * and resolves to `./foo.ts` in source.
 */
function resolveSpecifier(fromFile: string, spec: string, aliasRoot: string): string | null {
  const base = spec.startsWith('src/')
    ? path.join(aliasRoot, spec.slice('src/'.length))
    : path.resolve(path.dirname(fromFile), spec);

  const withoutJs = base.replace(/\.js$/, '');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(repoRoot, candidate);
    }
  }
  return null;
}

/** Tracked source files under a directory, absolute. */
function sourcesUnder(tracked: Set<string>, relDir: string): string[] {
  return [...tracked]
    .filter((f) => f.startsWith(relDir) && /\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => path.join(repoRoot, f));
}

describe('local imports resolve to tracked files', () => {
  const tracked = trackedFiles();
  const daemonSources = sourcesUnder(tracked, 'apps/omnitron/src/');
  const consoleSources = sourcesUnder(tracked, 'apps/omnitron/webapp/src/');

  it('found the trees it is supposed to check', () => {
    // A sweep over an empty file list passes while proving nothing.
    expect(tracked.size).toBeGreaterThan(100);
    expect(daemonSources.length, 'daemon sources').toBeGreaterThan(50);
    expect(consoleSources.length, 'console sources').toBeGreaterThan(20);
  });

  it('resolves the alias form the console uses', () => {
    // The specific shape that broke: `from 'src/utils/backend-health'` in a
    // console store. If this stops resolving, the sweep below goes quiet.
    const aliasRoot = path.join(repoRoot, 'apps/omnitron/webapp/src');
    const store = path.join(aliasRoot, 'stores/backend-status.store.ts');
    expect(fs.existsSync(store)).toBe(true);
    expect(resolveSpecifier(store, 'src/utils/backend-health', aliasRoot)).toBe(
      'apps/omnitron/webapp/src/utils/backend-health.ts'
    );
  });

  it('has no import pointing at a file the repository does not have', () => {
    const untracked: string[] = [];

    for (const [files, aliasRoot] of [
      [daemonSources, path.join(repoRoot, 'apps/omnitron/src')],
      [consoleSources, path.join(repoRoot, 'apps/omnitron/webapp/src')],
    ] as Array<[string[], string]>) {
      for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        for (const spec of localSpecifiers(source)) {
          const resolved = resolveSpecifier(file, spec, aliasRoot);
          // Unresolvable is a different problem (a genuinely missing file,
          // which the compiler already reports). What this catches is a file
          // present on disk and absent from git.
          if (resolved && !tracked.has(resolved)) {
            untracked.push(`${path.relative(repoRoot, file)} → ${spec} (${resolved})`);
          }
        }
      }
    }

    expect(untracked, 'imported but not committed — a fresh clone would not build').toEqual([]);
  });
});
