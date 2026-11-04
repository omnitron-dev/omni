import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { IEcosystemConfig } from '../config/types.js';
import { normalizeInfraConfig } from '../infrastructure/config-normalizer.js';
import { mergeInfrastructure } from '../infrastructure/merge-config.js';
import { createDefaultRegistry } from '../infrastructure/presets/index.js';
import { requestedMigrations, validateMigrationOwners, type MigrationRequest } from '../services/migration-target.js';
import { frozenMember } from './frozen-installation.js';

export type MigrationProgramInput = Pick<MigrationRequest, 'mode' | 'source' | 'release'>;
export type PackedMigrationProgram = MigrationProgramInput & { releaseSha256: string };

/** Reuse the deployment declaration policy. A file's spelling does not decide
 * whether it owns a migration registry. No application or migration code runs. */
export function declaredMigrationPrograms(config: IEcosystemConfig, forStack?: string): ReadonlyMap<string, readonly MigrationProgramInput[]> {
  const stacks = config.stacks ?? {};
  if (forStack && !Object.hasOwn(stacks, forStack)) throw Error('Unknown release migration stack: ' + forStack);
  const scopes = forStack ? [stacks[forStack]!] : Object.values(stacks);
  if (!scopes.length) scopes.push({ type: 'local', apps: 'all' });
  const result = new Map<string, MigrationProgramInput[]>();
  for (const stack of scopes) {
    const services = normalizeInfraConfig(mergeInfrastructure(config, stack) ?? {}, createDefaultRegistry());
    const requests = requestedMigrations(services);
    const apps = config.apps.filter(app => app.enabled !== false && (!Array.isArray(stack.apps) || stack.apps.includes(app.name)));
    validateMigrationOwners(requests, apps);
    for (const { app, mode, source, release } of requests) {
      const programs = result.get(app) ?? [];
      const prior = programs.find(p => p.release === release);
      if (prior && (prior.source !== source || prior.mode !== mode))
        throw Error('Conflicting declared migration source for ' + app + '/' + release);
      if (!prior) programs.push({ mode, source, release });
      result.set(app, programs);
    }
  }
  return result;
}

/** Read the actual staged bytes before packing, never a later mutable dist. */
export async function packedMigrationPrograms(root: string, programs: readonly MigrationProgramInput[]): Promise<PackedMigrationProgram[]> {
  const result: PackedMigrationProgram[] = [];
  for (const program of programs) {
    const file = await frozenMember(root, program.release);
    const bytes = await fs.readFile(file);
    result.push({ ...program, releaseSha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return result;
}
