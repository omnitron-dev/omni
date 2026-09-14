#!/usr/bin/env node
/**
 * Remove build output whose source is gone.
 *
 * `tsc` writes files; it never removes them. Delete a source and its compiled
 * output stays in `dist` for ever — and `package.json` says
 * `files: ["dist", …]`, so it is published, shipped to every node, and
 * bundled by the local-install channel.
 *
 * Measured in `apps/omnitron` on 2026-09-14: 17 such files, the oldest from
 * March. One of them, `dist/services/metrics.service.js`, imports
 * `prom-client` — a package this one does not depend on, so anything reaching
 * it would get ERR_MODULE_NOT_FOUND. Nothing does: none of the 17 is imported
 * from live code, which is what makes this housekeeping rather than an
 * outage. It is still code from deleted sources travelling to production.
 *
 * Found by taking a colleague's correction seriously. They had removed
 * dependencies using a scanner that reads `src`, then checked afterwards that
 * no `dist` imported what they removed — and said the check belonged before
 * the removal, not after. The boundary generalises: a consumer runs `dist`,
 * and `dist` can hold imports `src` no longer has.
 *
 * ## Why this and not `rm -rf dist`
 *
 * The daemon runs FROM `dist`. `rm -rf dist` in a build script has taken this
 * development stand down before: a running daemon's lazy imports vanish
 * mid-flight. This removes only files with no corresponding source, and
 * nothing imports those — a running daemon cannot miss what nothing asks for.
 *
 * Usage:
 *   node scripts/prune-stale-build.mjs           # report only, exit 1 if any
 *   node scripts/prune-stale-build.mjs --delete  # and remove them
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** Every emitted file under `dir`. */
export function* emitted(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* emitted(full);
    else yield full;
  }
}

/**
 * The sources a build artefact could have come from, or null when the name is
 * not one `tsc` emits — which leaves anything else in `dist` alone.
 *
 * One source produces up to four files: `.js`, `.d.ts`, and a `.map` for
 * each. All four are keyed to the same stem.
 */
export function sourcesFor(distFile, distDir, srcDir) {
  const rel = path.relative(distDir, distFile);
  const stem = rel.replace(/\.(js|d\.ts)(\.map)?$/, '');
  if (stem === rel) return null;
  return ['.ts', '.tsx'].map((ext) => path.join(srcDir, stem + ext));
}

/** Artefacts under `distDir` with no source under `srcDir`. */
export function findStale(distDir, srcDir) {
  const stale = [];
  for (const file of emitted(distDir)) {
    const candidates = sourcesFor(file, distDir, srcDir);
    if (!candidates) continue;
    if (candidates.some((c) => fs.existsSync(c))) continue;
    stale.push(file);
  }
  return stale;
}

function main() {
  const distDir = path.join(root, 'dist');
  const srcDir = path.join(root, 'src');
  const remove = process.argv.includes('--delete');
  const stale = findStale(distDir, srcDir);

  if (stale.length === 0) {
    console.log('dist is clean — every artefact has a source.');
    return;
  }

  const bytes = stale.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  console.log(`${stale.length} build artefacts have no source (${(bytes / 1024).toFixed(1)} KiB):`);
  for (const f of stale.slice(0, 20)) console.log(`  ${path.relative(root, f)}`);
  if (stale.length > 20) console.log(`  … and ${stale.length - 20} more`);

  if (!remove) {
    console.log('\nRun with --delete to remove them. They are published: `files` includes `dist`.');
    process.exitCode = 1;
    return;
  }

  for (const f of stale) fs.rmSync(f, { force: true });
  console.log(`\nRemoved ${stale.length}.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main();
