#!/usr/bin/env node
/**
 * A package whose `dist` is older than its `src`.
 *
 * Nothing in this repository runs from `src`. The sample stand loads titan out
 * of `packages/titan/dist`, titan loads msgpack out of
 * `packages/msgpack/dist`, and a test importing `@omnitron-dev/titan/netron`
 * gets the build, not the source. So an edit to a package's source changes
 * nothing anybody executes until somebody builds it — and nothing says when
 * that was.
 *
 * Two of these were measured on 2026-09-20, both while looking at something
 * else:
 *
 *   - `packet-compatibility.test.ts` imports BOTH netron implementations and
 *     asserts they agree about the wire. titan came in through its published
 *     entry, and that build was FOUR DAYS old, so the suite compared today's
 *     browser code against whatever titan somebody last compiled. A guard
 *     added to titan's decoder was invisible to it (`103ef327`).
 *   - `msgpack/dist` was NINE days old, so a prototype-pollution fix in
 *     `decodeMap` was in effect in the unit tests — which import `src` — and
 *     in nothing else (`78880f00`).
 *
 * This is a WORKLIST, not a gate. A stale build is not by itself a defect:
 * packages are built on release, and a repository mid-change legitimately has
 * sources ahead of artefacts. What it is, is a fact that changes how every
 * other measurement should be read — "I fixed it and the test passes" means
 * something different when the test reads a build from last week.
 *
 * The comparison is the NEWEST source against the NEWEST build output, which
 * is the cheap question. It cannot tell an unbuilt fix from a comment edit;
 * read the diff before acting.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeScan } from './lib/scan-receipt.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const skip = new Set(['node_modules', '.git', 'coverage']);

/** A missing source or output is reported as missing coverage. Failures reading an existing directory propagate. */
function newest(directory) {
  if (!statSync(directory, { throwIfNoEntry: false })) return null;
  let best = null;
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const stat = statSync(file);
        if (stat.isFile() && (!best || stat.mtimeMs > best.mtime)) best = { mtime: stat.mtimeMs, file };
      }
    }
  }
  walk(directory);
  return best;
}

const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && statSync(join(root, 'packages', entry.name, 'package.json'), { throwIfNoEntry: false })?.isFile())
  .map(entry => entry.name).sort();
const older = [], withoutSource = [], withoutBuild = [];
let compared = 0;
for (const name of packages) {
  const directory = join(root, 'packages', name);
  const src = newest(join(directory, 'src'));
  if (!src) { withoutSource.push(name); continue; }
  const dist = newest(join(directory, 'dist'));
  if (!dist) { withoutBuild.push(name); continue; }
  compared++;
  if (src.mtime > dist.mtime) {
    older.push({ name, delay: src.mtime - dist.mtime, src: relative(root, src.file), built: new Date(dist.mtime).toISOString() });
  }
}
if (!packages.length || withoutSource.length === packages.length) throw Error('No package source files available for the build comparison');
for (const row of older.sort((a, b) => b.delay - a.delay)) {
  console.log('  ' + row.name + '  newest output ' + row.built + ', newest source ' + row.src + ' (' + row.delay + 'ms newer)');
}
console.log(older.length + ' older builds among ' + compared + ' compared packages.');
if (withoutSource.length) console.log('No source files: ' + withoutSource.join(', '));
if (withoutBuild.length) console.log('No build output to compare: ' + withoutBuild.join(', '));
completeScan(import.meta.url, older.length ? 'findings' : compared ? 'complete' : 'not-applicable',
  { packages: packages.length, compared, older: older.length, withoutSource: withoutSource.length, withoutBuild: withoutBuild.length });
