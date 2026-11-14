import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { IEcosystemAppEntry, IEcosystemConfig, IAppDefinition, IStackConfig } from '../config/types.js';
import type { StackStartReview, SelectedRelease } from '../shared/dto/project.js';
import type { StackExecutionScope } from '../shared/dto/stack-execution.js';
import { readPrivateRecord, writePrivateRecord } from '../daemon/execution-journal.js';

/** Private restart intent. These are the retained next-start definitions, not
 * an assertion about the original environment of already running processes. */
export interface RuntimeRestartStack extends StackExecutionScope {
  path: string;
  registeredAt: string;
  definition: IStackConfig;
  selection: SelectedRelease | null;
  environment: Record<string, Record<string, string>>;
  declarations: Array<[string, IAppDefinition]>;
  entries: IEcosystemAppEntry[];
  launches: IEcosystemAppEntry[];
  review: StackStartReview;
}

export interface RuntimeRestartConfiguration {
  protocol: 1;
  registryDigest: string;
  ownerId: string;
  inventoryDigest: string;
  watchConfig: IEcosystemConfig;
  projects: Array<[string, { config: IEcosystemConfig; loadedAt: number }]>;
  stacks: RuntimeRestartStack[];
}

export function restartConfigurationDigest(configuration: RuntimeRestartConfiguration): string {
  return createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
}

/** These defaults are constructed before an older owner exposes setConfig.
 * Its controller can restore launch definitions, but cannot replace its PM or log manager. */
export function assertRestartOwnerDefaults(actual: IEcosystemConfig, retained: IEcosystemConfig): void {
  const defaults = (config: IEcosystemConfig) => ({ supervision: config.supervision, monitoring: config.monitoring,
    logging: config.logging, apps: config.apps.map(app => ({ name: app.name,
      logging: (app as typeof app & { observability?: { logging?: unknown } }).observability?.logging })) });
  if (!isDeepStrictEqual(defaults(actual), defaults(retained)))
    throw Error('Previous owner startup defaults differ from the retained next-start configuration');
}

const configurationFile = (home: string, digest: string) => {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid retained configuration digest');
  return path.join(home, 'runtime/local-updates', `configuration-${digest}.json`);
};

export async function saveRestartConfiguration(home: string, configuration: RuntimeRestartConfiguration): Promise<string> {
  const digest = restartConfigurationDigest(configuration);
  await writePrivateRecord(configurationFile(home, digest), configuration);
  return digest;
}

export async function readRestartConfiguration(home: string, digest: string): Promise<RuntimeRestartConfiguration> {
  const configuration = await readPrivateRecord<RuntimeRestartConfiguration>(configurationFile(home, digest));
  if (!configuration || configuration.protocol !== 1 || restartConfigurationDigest(configuration) !== digest ||
      !/^[a-f0-9]{64}$/.test(configuration.registryDigest) || !/^[a-f0-9]{64}$/.test(configuration.inventoryDigest) ||
      !configuration.ownerId || !Array.isArray(configuration.projects) || !Array.isArray(configuration.stacks))
    throw Error('Retained runtime configuration changed or is unavailable');
  return configuration;
}

/** Only owner-bound installation locations may differ. Operational cwd outside
 * the installed tree, environment, readiness and all other launch policy stay exact. */
export function restartLaunchIntent(entry: IEcosystemAppEntry): IEcosystemAppEntry {
  if (!entry.releaseRoot) return entry;
  const root = path.resolve(entry.releaseRoot);
  const relative = (file: string) => (file === root || file.startsWith(root + path.sep))
    ? `<installed>/${path.relative(root, file)}` : file;
  return { ...entry, releaseRoot: '<installed>',
    ...(entry.bootstrap && { bootstrap: relative(entry.bootstrap) }),
    ...(entry.script && { script: relative(entry.script) }),
    ...(entry.cwd && { cwd: relative(entry.cwd) }) };
}
