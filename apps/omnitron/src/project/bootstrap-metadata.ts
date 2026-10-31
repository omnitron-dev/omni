import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IAppDefinition } from '../config/types.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import { bootstrapDefinitionSource, loadBootstrapConfig } from '../orchestrator/bootstrap-loader.js';

export type BootstrapDeclaration = Pick<IAppDefinition, 'requires' | 'omnitronConfig'>;
export const TOPOLOGY_REFRESH_TIMEOUT_MS = 90_000;
/** A declaration snapshot, not evidence of an open connection or successful service call. */
export interface BootstrapMetadata {
  version: 1;
  bootstrap: string;
  capturedAt: string;
  source: { path: string; sha256: string };
  definition: BootstrapDeclaration;
}
interface MetadataState {
  version: 1;
  bootstrap: string;
  metadata: BootstrapMetadata | null;
  failure: { at: string; reason: string } | null;
}

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function captureBootstrapMetadata(bootstrap: string, source: string, definition: BootstrapDeclaration): BootstrapMetadata {
  // Keep executable hooks, auth objects and application configuration out of this record.
  const data: BootstrapDeclaration = {
    ...(definition.requires !== undefined && { requires: definition.requires }),
    ...(definition.omnitronConfig !== undefined && { omnitronConfig: definition.omnitronConfig }),
  };
  const serialized = JSON.stringify(data, (_key, value: unknown) => {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
      throw new Error('Bootstrap infrastructure declarations must be serializable data');
    return value;
  });
  if (Buffer.byteLength(serialized) > 1_048_576) throw new Error('Bootstrap metadata exceeds 1 MiB');
  return { version: 1, bootstrap: path.resolve(bootstrap), capturedAt: new Date().toISOString(),
    source: { path: path.resolve(source), sha256: hash(fs.readFileSync(source)) },
    definition: JSON.parse(serialized) as BootstrapDeclaration };
}

export function metadataSourceChanged(metadata: BootstrapMetadata): boolean {
  try { return hash(fs.readFileSync(metadata.source.path)) !== metadata.source.sha256; }
  catch { return true; }
}

export async function readBootstrapMetadata(bootstrap: string, devMode = false, timeoutMs = 30_000): Promise<{
  metadata: BootstrapMetadata; definition: IAppDefinition;
}> {
  const source = bootstrapDefinitionSource(bootstrap, devMode);
  const before = hash(fs.readFileSync(source));
  const definition = await loadBootstrapConfig(bootstrap, { devMode, freshModuleGraph: { timeoutMs } });
  const metadata = captureBootstrapMetadata(bootstrap, source, definition);
  if (metadata.source.sha256 !== before || bootstrapDefinitionSource(bootstrap, devMode) !== source)
    throw new Error('Bootstrap changed during declaration capture; retry against a stable revision');
  return { metadata, definition };
}

/** FULL SQLite commit; independent of backend handoff checkpoints and process-local import caches. */
export class BootstrapMetadataStore {
  constructor(private readonly store: Pick<DaemonStateStore, 'kvGetSync' | 'kvUpdateSync'>) {}
  private key(bootstrap: string): string { return `topology:bootstrap:${hash(path.resolve(bootstrap))}`; }
  readState(bootstrap: string): MetadataState {
    const state = this.store.kvGetSync<MetadataState>(this.key(bootstrap), { strict: true });
    if (state && (state.version !== 1 || state.bootstrap !== path.resolve(bootstrap) ||
        !Object.hasOwn(state, 'metadata') || !Object.hasOwn(state, 'failure')))
      throw new Error('Invalid persisted bootstrap metadata state');
    const value = state?.metadata;
    if (value && (value.version !== 1 || value.bootstrap !== path.resolve(bootstrap) ||
        !value.source || typeof value.source.path !== 'string' || !path.isAbsolute(value.source.path) ||
        !/^[a-f0-9]{64}$/.test(value.source.sha256) ||
        !Number.isFinite(Date.parse(value.capturedAt)) || !value.definition || typeof value.definition !== 'object' || Array.isArray(value.definition)))
      throw new Error('Invalid persisted bootstrap metadata');
    if (state?.failure && (typeof state.failure.reason !== 'string' || !Number.isFinite(Date.parse(state.failure.at))))
      throw new Error('Invalid persisted bootstrap metadata failure');
    return state ?? { version: 1, bootstrap: path.resolve(bootstrap), metadata: null, failure: null };
  }
  read(bootstrap: string): BootstrapMetadata | null {
    return this.readState(bootstrap).metadata;
  }
  save(metadata: BootstrapMetadata): void {
    this.store.kvUpdateSync<MetadataState>(this.key(metadata.bootstrap), () => ({ version: 1,
      bootstrap: metadata.bootstrap, metadata: structuredClone(metadata), failure: null }));
  }
  fail(bootstrap: string): void {
    this.store.kvUpdateSync<MetadataState>(this.key(bootstrap), () => ({ ...this.readState(bootstrap),
      failure: { at: new Date().toISOString(), reason: 'Declaration refresh failed; previous snapshot retained. Inspect the daemon log.' } }));
  }
}
