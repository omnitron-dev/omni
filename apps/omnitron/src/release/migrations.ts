/**
 * A migration that ran is history, not source.
 *
 * Once a migration has run on a stack, its file is a record of what that
 * stack's schema went through, and the migrator on the node refuses one whose
 * checksum moved — at the migration step of a deployment, after the build,
 * the gates and the artifact transfer. On 2026-09-24 a function body a new
 * migration recreated came within a commit of changing what an applied one
 * had installed, and the only thing that would have said so was that step.
 *
 * So a release records the sha256 of every migration file it carries, and
 * admission compares them with the release already running on the stack:
 * a file that ran there and changed since is refused by name, before any node
 * is touched. New files are what a release is for, and pass.
 *
 * Stricter than the node, on purpose: its migrator hashes the compiled text of
 * `up` and `down`, this hashes the file — an edited comment the node would let
 * through is refused here too. An applied file is history either way.
 *
 * «Ran there» is the stack's last start that succeeded (`stack.start`). A
 * start that failed (`stack.start.failed`) may have applied the migrations it
 * added before it failed; those are not compared here, and the node's
 * migrator stays their judge.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** A tracked file inside a `migrations` directory of an app. */
const MIGRATION = /^apps\/[^/]+\/(?:.+\/)?migrations\/[^/]+\.(?:ts|mts|js|mjs|sql)$/;

/** Every tracked migration file under `dir`: repository path → sha256 of its bytes. */
export async function migrationDigests(dir: string): Promise<Record<string, string>> {
  const { stdout } = await exec('git', ['ls-files', '-z', '--', 'apps'], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
  const out: Record<string, string> = {};
  for (const file of stdout.split('\0').filter((f) => MIGRATION.test(f)).sort()) {
    out[file] = createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex');
  }
  return out;
}

/**
 * The migrations that ran with `deployed` and are not the same in
 * `candidate`: edited, or gone. Added ones are not listed.
 */
export function changedReleasedMigrations(
  deployed: Readonly<Record<string, string>>,
  candidate: Readonly<Record<string, string>>,
): string[] {
  return Object.keys(deployed)
    .filter((file) => candidate[file] !== deployed[file])
    .sort();
}
