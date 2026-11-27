import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { IEcosystemConfig, IStackConfig } from '../config/types.js';
import { expandServiceDeclarations } from '../infrastructure/config-normalizer.js';
import { mergeInfrastructure } from '../infrastructure/merge-config.js';
import { createDefaultRegistry } from '../infrastructure/presets/index.js';
import { inspectReleaseArtifact } from '../release/artifact-inspection.js';
import type { LoadedRelease } from '../release/load.js';
import { artifactReleaseContext } from '../release/origin.js';
import { COMPILED_MIGRATION_ENTRY, requestedMigrations, validateMigrationOwners } from '../services/migration-target.js';
import { canonicalHash } from '../services/physical-restore-graph.js';
import type { MigrationRehearsalPlan, MigrationRehearsalReceipt, RehearsalCopyPlan, RehearsalCopyReceipt } from '../shared/dto/first-write.js';
import type { ReleaseMigrationHistory } from '../shared/dto/project.js';
import { checkRehearsalCopy } from './first-write-inspection.js';

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const component = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

function sourceNames(files: Readonly<Record<string, string>>) {
  const names = new Map<string, string>();
  for (const [file, hash] of Object.entries(files)) {
    if (!digest(hash)) throw Error('Invalid migration source checksum in the admitted package');
    // The packaged public loader ignores index, declaration and test files in its own registry directory.
    if (/^src\/database\/migrations\/(?:index\.(?:ts|js)|[^/]+\.(?:d|spec|test)\.(?:ts|js))$/.test(file)) continue;
    const match = /^src\/database\/migrations\/(\d+_[a-zA-Z0-9_-]+)(?:\.migration)?\.ts$/.exec(file);
    if (!match || match[1]!.length > 200 || names.has(match[1]!))
      throw Error('The selected package must have one complete numbered script registry');
    names.set(match[1]!, file);
  }
  if (!names.size || names.size > 2048) throw Error('Unsupported migration registry size');
  return names;
}

export async function planRehearsalMigrations(copy: RehearsalCopyPlan, receipt: RehearsalCopyReceipt, app: string,
  previous: LoadedRelease, candidate: LoadedRelease, config: IEcosystemConfig, stack: IStackConfig, history: ReleaseMigrationHistory) {
  checkRehearsalCopy(copy, receipt);
  if (!component.test(app) || copy.manifestSha256 !== candidate.manifestSha256 || copy.release !== candidate.id)
    throw Error('The prepared pair belongs to a different candidate');
  const requests = requestedMigrations(expandServiceDeclarations(mergeInfrastructure(config, stack) ?? {}, createDefaultRegistry()));
  validateMigrationOwners(requests, config.apps.filter(entry => entry.enabled !== false && (!Array.isArray(stack.apps) || stack.apps.includes(entry.name))));
  const selected = requests.filter(request => request.app === app), [owner] = selected;
  if (selected.length !== 1 || owner?.mode !== 'script' || owner.service !== 'postgres' || !component.test(owner.database) ||
      owner.release !== COMPILED_MIGRATION_ENTRY || (owner.migrationTimeoutMs !== undefined && owner.migrationTimeoutMs !== 3_600_000) ||
      (stack.infrastructureOwnership !== undefined && stack.infrastructureOwnership !== 'stack'))
    throw Error('The private trial requires one declared standard PostgreSQL script owner');
  const old = artifactReleaseContext(previous.manifest, app), next = artifactReleaseContext(candidate.manifest, app);
  const before = old.artifact.packageSource, after = next.artifact.packageSource;
  if (!before || !after || old.manifest.project.repo !== next.manifest.project.repo || before.directory !== after.directory)
    throw Error('The incumbent and candidate must have the same proven migration package');
  const oldNames = sourceNames(before.migrations), newNames = sourceNames(after.migrations);
  if (Object.entries(before.migrations).some(([file, hash]) => after.migrations[file] !== hash))
    throw Error('An incumbent migration changed');
  const names = [...newNames.keys()].sort(), added = names.filter(name => !oldNames.has(name));
  const evidence = new Set(added.map(name => next.chain.length ? app + '/' + newNames.get(name)!
    : path.posix.join(path.posix.relative(next.manifest.project.directory ?? '.', after.directory), newNames.get(name)!)));
  const reported = new Set(history.entries);
  if (!added.length || history.kind !== 'added-migrations' || history.total !== history.entries.length ||
      reported.size !== history.entries.length || reported.size !== evidence.size || [...evidence].some(file => !reported.has(file)))
    throw Error('The reviewed additions must belong entirely to the selected application');
  const programs = after.migrationPrograms?.filter(item => item.mode === owner.mode && item.source === owner.source && item.release === owner.release) ?? [];
  const [program] = programs;
  if (programs.length !== 1 || !program || !component.test(next.artifact.app)) throw Error('The immutable release has no unique matching migration program');
  const inspection = await inspectReleaseArtifact(candidate.id, app, { releasesRoot: path.dirname(candidate.root),
    files: [{ path: program.release }] });
  const archive = candidate.files.find(item => item.app === app);
  if (!archive || archive.sha256 !== inspection.artifact.sha256 || inspection.manifestSha256 !== copy.manifestSha256 ||
      inspection.files.find(file => file.path === program.release)?.sha256 !== program.releaseSha256 ||
      inspection.closure.target.platform !== 'linux' || (inspection.closure.nodeOptions !== '' &&
        !/^--max-old-space-size=[1-9][0-9]{0,6}$/.test(inspection.closure.nodeOptions)))
    throw Error('The selected archive, Linux target or declared compiled program differs');
  const facts = { protocol: 1 as const, copy, receipt, app, database: owner.database, producerApp: inspection.producer.app,
    producerManifest: inspection.producer.manifestSha256, archiveSha256: archive.sha256, archiveBytes: archive.bytes,
    closureSha256: inspection.closure.sha256, nodeOptions: inspection.closure.nodeOptions,
    program: { path: program.release, sha256: program.releaseSha256, sourceSha256: program.sourceSha256 },
    target: inspection.closure.target, names, added };
  return { plan: { ...facts, digest: canonicalHash(facts) }, archive: archive.path };
}

/** Both joins must agree with the complete isolated package registry; an empty or orphan checksum never passes. */
export function checkMigrationRehearsal(plan: MigrationRehearsalPlan, raw: MigrationRehearsalReceipt): void {
  const exact = (row: unknown, keys: string[]) => !!row && typeof row === 'object' && !Array.isArray(row) &&
    isDeepStrictEqual(Object.keys(row).sort(), [...keys].sort());
  const baseline = plan.names.filter(name => !plan.added.includes(name));
  if (!exact(raw, ['operationId', 'review', 'registry', 'before', 'after','generations']) || raw.operationId !== plan.copy.operationId ||
      !exact(raw.generations, ['postgres','minio']) || !digest(raw.generations.postgres) ||
      raw.generations.postgres === plan.receipt.copies.find(row => row.tag === 'postgres-data')?.generation ||
      raw.generations.minio !== plan.receipt.copies.find(row => row.tag === 'minio-data')?.generation ||
      raw.review !== plan.digest || !Array.isArray(raw.registry) || !Array.isArray(raw.before) || !Array.isArray(raw.after) ||
      raw.registry.length !== plan.names.length || raw.before.length !== baseline.length || raw.after.length !== plan.names.length)
    throw Error('Incomplete private migration receipt');
  const sums = new Map<string, string>();
  for (const [i, row] of raw.registry.entries()) {
    if (!exact(row, ['name','checksum']) || row.name !== plan.names[i] || !digest(row.checksum)) throw Error('Private registry differs from the package');
    sums.set(row.name, row.checksum);
  }
  for (const [names, rows] of [[baseline, raw.before], [plan.names, raw.after]] as const) {
    if (rows.some((row, index) => !exact(row, ['name','checksum','executedAt']) || names[index] !== row.name ||
      row.checksum !== sums.get(row.name) || typeof row.executedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.executedAt) || !Number.isFinite(Date.parse(row.executedAt))))
      throw Error('The native PostgreSQL history differs from the package');
  }
  if (!isDeepStrictEqual(raw.before, raw.after.filter(row => !plan.added.includes(row.name))))
    throw Error('Previously applied private migration history changed');
}
