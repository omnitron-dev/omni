#!/usr/bin/env node
/**
 * A package that needs itself built to build.
 *
 * `packages/testing/src/titan/database/test-utilities.ts` imported
 * `@omnitron-dev/testing/docker` — its OWN package, by name. TypeScript
 * resolves a self-reference through the package's `exports`, and those point
 * at `./dist/docker/index.d.ts`: a file that exists only after the package
 * has been built once. In a developer's checkout it always had been. In a
 * clean clone it had not, so the first compile failed with TS2307 — and
 * because the tsconfig also said `declarationDir: ./dist`, that failing
 * compile still left declarations in `dist`, a second compile found them and
 * passed, and `build-package.sh`'s swap then threw them away. Measured
 * 2026-09-25 in a daos release build: `@omnitron-dev/testing` shipped with 0
 * `.d.ts`, paysys «cannot resolve @omnitron-dev/testing/async», and the
 * release was refused.
 *
 * A package reaches its own modules by relative path. Counted per import
 * statement, in `src`, tests excluded (a test may import the published
 * surface on purpose); comments are not imports.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      yield* sources(full);
    } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      yield full;
    }
  }
}

/** Import and export statements only — block and line comments removed first. */
function statements(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');
  return code;
}

const found = [];
for (const name of readdirSync(PACKAGES)) {
  const dir = join(PACKAGES, name);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const src = join(dir, 'src');
  try {
    if (!statSync(src).isDirectory()) continue;
  } catch {
    continue;
  }
  const self = pkg.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const pattern = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*)['"]${self}(?:/[^'"]*)?['"]`, 'g');
  for (const file of sources(src)) {
    const code = statements(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(pattern)) {
      const line = code.slice(0, m.index).split('\n').length;
      found.push(`${relative(ROOT, file)}:${line}  ${m[0]}`);
    }
  }
}

if (found.length) {
  console.error(`a package that needs itself built — ${found.length} self-import(s); use a relative path:`);
  for (const f of found) console.error(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log('a package that needs itself built — no package imports itself by name');
}
