/**
 * Whether an application has to be compiled again.
 *
 * A deployment stops shipping what the node already has. What it did not
 * stop was producing it: every autostart of the master ran
 * `rm -rf dist && tsc` for each of six applications, and only afterwards
 * asked whether the result differed from what the node was running.
 * Measured on one restart with nothing changed — three minutes thirty-nine
 * seconds of compilers, then eleven seconds of deployment that transferred
 * nothing and restarted nothing.
 *
 * `rm -rf dist` stays where it is. `tsc` only writes, it never removes, so a
 * deleted source leaves its compiled file in `dist` forever — measured on
 * `@daos/paysys`, 34 migrations in `src` against 40 in `dist`, one of them a
 * migration whose source had been replaced and which the artifact then ran.
 * That is also why the question cannot be "is dist newer than src": a
 * deletion makes nothing newer. It is "is this dist the one these inputs
 * produce", which is a question about content and is answered by comparing
 * hashes against what was recorded when that dist was built.
 *
 * Every unknown compiles. The cost of compiling again is minutes; the cost
 * of shipping a dist that these sources did not produce is a node running
 * code nobody wrote.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';

/** What was true of an application the last time it was compiled. */
export interface BuildRecord {
  /** Everything that decides what the compiler emits — see `buildInputsChecksum`. */
  readonly inputs: string;
  /** What the `dist` it produced hashed to, so a changed one is not reused. */
  readonly dist: string;
}

export interface BuildQuestion {
  /** What the last build of this application recorded, or null if nothing did. */
  readonly recorded: BuildRecord | null;
  /** What the inputs hash to now, or null when they could not be read. */
  readonly inputs: string | null;
  /** What `dist` hashes to now, or null when there is none. */
  readonly distChecksum: string | null;
}

export type BuildDecision =
  | { action: 'build'; because: string }
  | { action: 'reuse'; because: string };

export function decideBuild(question: BuildQuestion): BuildDecision {
  if (!question.inputs) {
    return { action: 'build', because: 'the build inputs could not be read' };
  }
  if (!question.recorded) {
    return { action: 'build', because: 'nothing records what this dist was built from' };
  }
  if (!question.distChecksum) {
    return { action: 'build', because: 'there is no dist to reuse' };
  }
  if (question.recorded.inputs !== question.inputs) {
    return { action: 'build', because: 'the inputs changed since that dist was built' };
  }
  if (question.recorded.dist !== question.distChecksum) {
    return { action: 'build', because: 'dist is not what that build produced' };
  }
  return { action: 'reuse', because: 'dist is what these inputs produce — not compiling it again' };
}

/**
 * Where the record of one application's build is kept.
 *
 * Outside the application, because an artifact build runs against a project
 * that is not omnitron's and leaving files in somebody else's repository is
 * not ours to do. Named by the directory rather than by the package, so two
 * checkouts of one project — and two applications called `main` in two
 * repositories — do not read each other's record.
 */
export function buildRecordPath(cacheRoot: string, appDir: string): string {
  const resolved = path.resolve(appDir);
  const key = createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  return path.join(cacheRoot, `${path.basename(resolved)}-${key}.json`);
}
