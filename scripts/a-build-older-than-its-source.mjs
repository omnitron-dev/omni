#!/usr/bin/env node
/**
 * A package whose `dist` is older than its `src`.
 *
 * Nothing in this repository runs from `src`. The daos stand loads titan out
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
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

/** Newest mtime under a directory, and the file it belongs to. */
export function newest(dir, skip = new Set(['node_modules', '.git', 'coverage'])) {
  let best = { mtime: 0, file: null };
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const m = statSync(p).mtimeMs;
        if (m > best.mtime) best = { mtime: m, file: p };
      }
    }
  };
  walk(dir);
  return best;
}

const packages = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const rows = [];
for (const name of packages) {
  const src = join(ROOT, 'packages', name, 'src');
  const dist = join(ROOT, 'packages', name, 'dist');
  if (!existsSync(src) || !existsSync(dist)) continue;
  const s = newest(src);
  const d = newest(dist);
  if (s.mtime > d.mtime) {
    rows.push({
      name,
      days: Math.round(((s.mtime - d.mtime) / 86_400_000) * 10) / 10,
      src: s.file?.replace(ROOT + '/', ''),
      built: new Date(d.mtime).toISOString().slice(0, 10),
    });
  }
}

rows.sort((a, b) => b.days - a.days);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(22)} dist built ${r.built}, source is ${r.days}d newer`);
  console.log(`      newest source: ${r.src}`);
}
console.log(`\n${rows.length} of ${packages.length} package(s) run from a build older than their source`);

const selfCheck = (() => {
  // The walker must find the newest file, not the first one, and must not
  // descend into node_modules — which is where a package's own dependencies
  // live and would dominate every timestamp.
  const probe = newest(join(ROOT, 'scripts'));
  return probe.file !== null && probe.mtime > 0 && !probe.file.includes('node_modules');
})();
console.log(
  selfCheck
    ? 'self-check OK: the walker finds a newest file and skips node_modules'
    : '!! SELF-CHECK FAILED — the walker is not measuring what this scan claims',
);
if (!selfCheck) process.exit(1);
