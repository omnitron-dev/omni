/**
 * A factory that passed its arguments by position.
 *
 * The master's daemon built `ProjectService` as
 *
 *     new ProjectService(logger, orchestrator, dStore, fleet, undefined, secrets, audit)
 *
 * from values the container resolved in `inject` order and handed over as
 * `any`. Two lists that must agree position by position — the tokens and the
 * factory's parameters — and a constructor whose optional collaborators were
 * positional too. The fourth, `fleet`, had been read by nothing since the
 * mesh connector stopped writing the fleet table (f785d7f0); taking it out
 * would have moved the vault into the sync service's place and the audit
 * trail into the vault's, and compiled.
 *
 * The optional collaborators are named now, and the provider lives beside the
 * class. This holds the provider to its word: resolve each token the way the
 * container would, call the factory in `inject` order, and the vault must
 * arrive where secrets are resolved, the audit trail where deployments are
 * recorded.
 */

import { describe, it, expect } from 'vitest';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';

import { MASTER_PROJECT_SERVICE_PROVIDER } from '../../src/services/project.service.js';
import {
  AUDIT_SERVICE_TOKEN,
  DAEMON_STATE_STORE_TOKEN,
  FLEET_SERVICE_TOKEN,
  ORCHESTRATOR_TOKEN,
  SECRETS_SERVICE_TOKEN,
} from '../../src/shared/tokens.js';

const silent: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child: () => silent };

/** One distinct value per token, as the container would resolve them. */
function container() {
  const vault = { get: async (key: string) => (key === 'db.password' ? 'the-real-one' : null) };
  const audited: unknown[] = [];
  const audit = { record: async (entry: unknown) => void audited.push(entry) };
  const values = new Map<unknown, unknown>([
    [LOGGER_SERVICE_TOKEN, { logger: silent }],
    [ORCHESTRATOR_TOKEN, { list: () => [], listHandleNames: () => [] }],
    [DAEMON_STATE_STORE_TOKEN, { save() {}, load: () => null, get: () => null, set() {} }],
    [SECRETS_SERVICE_TOKEN, vault],
    [AUDIT_SERVICE_TOKEN, audit],
    // Present in the container, and asked for by nothing any more.
    [FLEET_SERVICE_TOKEN, { heartbeat: async () => 0 }],
  ]);
  return { values, vault, audit };
}

function build(values: Map<unknown, unknown>) {
  const args = MASTER_PROJECT_SERVICE_PROVIDER.inject.map((token) => {
    if (!values.has(token)) throw new Error(`the provider asks for a token the daemon does not provide`);
    return values.get(token);
  });
  return (MASTER_PROJECT_SERVICE_PROVIDER.useFactory as (...a: unknown[]) => unknown)(...args) as unknown as {
    secrets: unknown;
    audit: unknown;
    syncService: unknown;
    resolveOverrideSecrets(project: string, overrides: unknown): Promise<Record<string, unknown>>;
  };
}

describe('a factory that passed its arguments by position', () => {
  it('puts the vault where secrets are resolved, and the audit trail where deployments are recorded', () => {
    const { values, vault, audit } = container();

    const service = build(values);

    expect(service.secrets, 'the vault').toBe(vault);
    expect(service.audit, 'the audit trail').toBe(audit);
    expect(service.syncService, 'never passed on a master').toBeUndefined();
  });

  it('resolves a stack override through the vault it was given', async () => {
    const { values } = container();
    const service = build(values);

    const resolved = (await service.resolveOverrideSecrets('daos', {
      postgres: { external: { host: '10.0.0.5', ports: { main: 5432 }, secrets: { password: { secret: 'db.password' } } } },
    })) as Record<string, { external: { secrets: Record<string, string> } }>;

    expect(resolved['postgres']!.external.secrets['password']).toBe('the-real-one');
  });

  it('does not ask for the fleet service', () => {
    expect(MASTER_PROJECT_SERVICE_PROVIDER.inject).not.toContain(FLEET_SERVICE_TOKEN);
  });
});
