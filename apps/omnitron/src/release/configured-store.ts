import { readSavedDaemonConfig } from '../config/saved.js';
import { parseStoreConfig, resolveStore, S3ObjectStore, type ReleaseStoreConfig } from './artifact-store.js';

/** The CLI and the controller use the same configured destination and the same secret references. */
export function configuredStoreConfig(): ReleaseStoreConfig {
  return parseStoreConfig(readSavedDaemonConfig()?.releaseStore, '~/.omnitron/config.json');
}

export async function configuredReleaseStore(config: ReleaseStoreConfig, readSecret: (key: string) => Promise<string | null>): Promise<S3ObjectStore> {
  return new S3ObjectStore(await resolveStore(config, readSecret));
}
