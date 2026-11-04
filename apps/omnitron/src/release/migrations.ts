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
import type { ReleaseManifest, ReleasePackageSource } from './manifest.js';
import { artifactReleaseContexts } from './origin.js';
import { migrationEntryPath } from '../services/migration-target.js';
import type { PackedMigrationProgram } from './migration-programs.js';

const exec = promisify(execFile);

/** Migration filenames the existing stack admission policy recognizes. */
const MIGRATION = /(?:^|\/)migrations\/[^/]+\.(?:ts|mts|js|mjs|sql)$/;

/** Read a tracked regular file as it exists in the checked-out package, and prove
 * its bytes against the named Git object. Gates and builds can change a checkout. */
function checkedBlob(root: string, file: string, mode: string, object: string): Buffer {
  const full = path.join(root, file);
  if (!/^100(?:644|755)$/.test(mode) || fs.realpathSync(full) !== full || !fs.lstatSync(full).isFile())
    throw Error('Release source must be a physical tracked file: ' + file);
  const bytes = fs.readFileSync(full);
  const oid = createHash(object.length === 64 ? 'sha256' : 'sha1')
    .update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  if (oid !== object) throw Error('Release source differs from its Git commit: ' + file);
  return bytes;
}

export async function releaseMigrationSources(workspace: string, commit: string, packageDirectories: readonly string[],
  programs: readonly (PackedMigrationProgram & { directory: string })[] = []): Promise<{
  migrations: Record<string, string>; packages: Map<string, ReleasePackageSource>;
}> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw Error('Expected the full release source commit');
  const root = fs.realpathSync((await exec('git', ['rev-parse', '--show-toplevel'], { cwd: workspace })).stdout.trimEnd());
  const physicalWorkspace = fs.realpathSync(workspace);
  const prefix = path.relative(root, physicalWorkspace).split(path.sep).join('/');
  const declared = new Set<string>();
  for (const program of programs) {
    if (!packageDirectories.includes(program.directory) || !['config', 'script'].includes(program.mode) ||
        typeof program.releaseSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(program.releaseSha256))
      throw Error('Invalid packed migration program');
    migrationEntryPath(program.source, 'source'); migrationEntryPath(program.release, 'release');
    if (!/\.[cm]?js$/.test(program.release)) throw Error('A released migration must name a compiled JavaScript module');
    declared.add(path.posix.join(prefix, program.directory, program.source));
  }
  const { stdout } = await exec('git', ['--no-replace-objects', '--literal-pathspecs', 'ls-tree', '-r', '-z', '--full-tree',
    commit, '--', prefix || '.'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const files = new Map<string, { mode: string; oid: string }>();
  for (const record of stdout.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t'), [mode, kind, oid] = record.slice(0, tab).split(' ');
    const file = record.slice(tab + 1);
    if (kind === 'blob' && (path.posix.basename(file) === 'package.json' || MIGRATION.test(file) || declared.has(file)))
      files.set(file, { mode: mode!, oid: oid! });
  }
  const packages = new Map<string, ReleasePackageSource>();
  const owned = new Map<string, Record<string, string>>();
  for (const input of new Set(packageDirectories)) {
    const directory = input.split(path.sep).join('/');
    if (directory !== '.' && directory.split('/').some(p => !p || p === '.' || p === '..' || /[\\:\0]/.test(p)))
      throw Error('Invalid release package directory: ' + input);
    const pkg = path.posix.join(prefix, directory), file = path.posix.join(pkg, 'package.json'), tracked = files.get(file);
    if (!tracked) throw Error('Compiled package has no tracked package.json: ' + file);
    checkedBlob(root, file, tracked.mode, tracked.oid);
    const migrations: Record<string, string> = {};
    owned.set(pkg, migrations);
    packages.set(input, { directory: pkg, manifestBlob: tracked.oid, migrations });
  }
  const migrations: Record<string, string> = {};
  const packageOf = (file: string) => {
    let owner = path.posix.dirname(file);
    while (owner !== '.' && !files.has(path.posix.join(owner, 'package.json'))) owner = path.posix.dirname(owner);
    return owner;
  };
  for (const [file, blob] of files) {
    if (!MIGRATION.test(file)) continue;
    // Attribute a file to its nearest tracked package, even if that nested
    // package is not among the applications selected for this release.
    const owner = packageOf(file);
    const scoped = owned.get(owner);
    const workspaceFile = prefix ? file.slice(prefix.length + 1) : file;
    const stackFile = /^apps\/[^/]+\/(?:.+\/)?migrations\//.test(workspaceFile);
    if (!scoped && !stackFile) continue;
    const digest = createHash('sha256').update(checkedBlob(root, file, blob.mode, blob.oid)).digest('hex');
    if (scoped) scoped[path.posix.relative(owner, file)] = digest;
    migrations[workspaceFile] = digest;
  }
  for (const program of programs) {
    const source = packages.get(program.directory)!;
    const file = path.posix.join(source.directory, program.source), blob = files.get(file);
    if (!blob || packageOf(file) !== source.directory)
      throw Error('Declared migration source is not tracked by its owning package: ' + file);
    const sourceSha256 = createHash('sha256').update(checkedBlob(root, file, blob.mode, blob.oid)).digest('hex');
    const entry = { mode: program.mode, source: program.source, sourceBlob: blob.oid, sourceSha256,
      release: program.release, releaseSha256: program.releaseSha256 };
    const previous = source.migrationPrograms?.find(p => p.release === entry.release);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw Error('Conflicting migration program provenance: ' + file);
    if (!previous) packages.set(program.directory, { ...source, migrationPrograms: [...(source.migrationPrograms ?? []), entry] });
  }
  return { migrations, packages };
}

/** Existing workspace inventory, also used by release admission for older releases. */
export async function migrationDigests(dir: string): Promise<Record<string, string>> {
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return (await releaseMigrationSources(dir, stdout.trim(), [])).migrations;
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

/** A consumer's workspace migration map cannot describe another producer's
 * schema history. Compare the physical package that supplied each retained app. */
export function changedImportedMigrations(deployed: ReleaseManifest, candidate: ReleaseManifest, apps: readonly string[]): string[] {
  const changes: string[] = [];
  const oldSources = new Map(artifactReleaseContexts(deployed).map(source => [source.app, source]));
  const newSources = new Map(artifactReleaseContexts(candidate).map(source => [source.app, source]));
  for (const app of apps) {
    const previous = deployed.artifacts.find(artifact => artifact.app === app);
    const next = candidate.artifacts.find(artifact => artifact.app === app);
    if (!previous || !next || (!previous.origin && !next.origin)) continue;
    const before = oldSources.get(app)!, after = newSources.get(app)!;
    const oldPackage = before.artifact.packageSource, newPackage = after.artifact.packageSource;
    if (!oldPackage || !newPackage) {
      changes.push(app + ': migration provenance is unavailable for one of the producer packages');
      continue;
    }
    if (Object.keys(oldPackage.migrations).length && (before.manifest.project.repo !== after.manifest.project.repo || oldPackage.directory !== newPackage.directory)) {
      changes.push(app + ': the package that owns existing migrations changed');
      continue;
    }
    changes.push(...changedReleasedMigrations(oldPackage.migrations, newPackage.migrations).map(file => app + '/' + file));
  }
  return changes;
}
