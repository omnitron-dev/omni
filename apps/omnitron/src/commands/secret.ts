/**
 * omnitron secret set|get|list|delete — Encrypted secrets management
 *
 * Two operation modes:
 * 1. Daemon running: uses RPC to OmnitronSecrets service
 * 2. Daemon offline: direct file access via SecretsService
 *
 * Secrets are stored encrypted at ~/.omnitron/secrets.enc using AES-256-GCM.
 */

import { log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function secretSetCommand(key: string, value: string): Promise<void> {
  // Try daemon RPC first, fall back to direct file access
  const client = createDaemonClient();

  try {
    if (await client.isReachable()) {
      await invokeSecretsRpc(client, 'set', { key, value });
      log.success(`Secret '${key}' set`);
      await client.disconnect();
      return;
    }
  } catch {
    // Fall through to direct mode
  }
  await client.disconnect();

  // Direct file access (daemon offline)
  const secrets = await createDirectService();
  await secrets.set(key, value);
  log.success(`Secret '${key}' set (direct mode)`);
}

export async function secretGetCommand(key: string): Promise<void> {
  const client = createDaemonClient();

  try {
    if (await client.isReachable()) {
      const result = await invokeSecretsRpc(client, 'get', { key });
      if (result.value !== null) {
        // Output raw value to stdout for scripting compatibility
        process.stdout.write(result.value + '\n');
      } else {
        log.warn(`Secret '${key}' not found`);
      }
      await client.disconnect();
      return;
    }
  } catch {
    // Fall through
  }
  await client.disconnect();

  // Direct file access
  const secrets = await createDirectService();
  const value = await secrets.get(key);
  if (value !== null) {
    process.stdout.write(value + '\n');
  } else {
    log.warn(`Secret '${key}' not found`);
  }
}

export async function secretListCommand(): Promise<void> {
  const client = createDaemonClient();

  try {
    if (await client.isReachable()) {
      const result = await invokeSecretsRpc(client, 'list');
      printKeys(result.keys);
      await client.disconnect();
      return;
    }
  } catch {
    // Fall through
  }
  await client.disconnect();

  // Direct file access
  const secrets = await createDirectService();
  const keys = await secrets.list();
  printKeys(keys);
}

export async function secretDeleteCommand(key: string): Promise<void> {
  const client = createDaemonClient();

  try {
    if (await client.isReachable()) {
      const result = await invokeSecretsRpc(client, 'delete', { key });
      if (result.existed) {
        log.success(`Secret '${key}' deleted`);
      } else {
        log.warn(`Secret '${key}' not found`);
      }
      await client.disconnect();
      return;
    }
  } catch {
    // Fall through
  }
  await client.disconnect();

  // Direct file access
  const secrets = await createDirectService();
  const existed = await secrets.delete(key);
  if (existed) {
    log.success(`Secret '${key}' deleted (direct mode)`);
  } else {
    log.warn(`Secret '${key}' not found`);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function printKeys(keys: string[]): void {
  if (keys.length === 0) {
    log.info('No secrets stored');
    return;
  }
  log.info(`${prism.bold('Secrets')} (${keys.length}):`);
  for (const key of keys.sort()) {
    log.info(`  ${key}`);
  }
}

async function invokeSecretsRpc(client: any, method: string, data?: any): Promise<any> {
  await client['ensureConnected']();
  const netron = client['netron'];
  const peers = netron.getPeers ? netron.getPeers() : [];
  for (const peer of peers) {
    try {
      const svc = await peer.queryInterface('OmnitronSecrets');
      if (svc && typeof svc[method] === 'function') {
        return data ? await svc[method](data) : await svc[method]();
      }
    } catch {
      continue;
    }
  }
  throw new Error('OmnitronSecrets service not found');
}

async function createDirectService(): Promise<import('../services/secrets.service.js').SecretsService> {
  const { SecretsService } = await import('../services/secrets.service.js');
  const { DEFAULT_DAEMON_CONFIG } = await import('../config/defaults.js');
  const dc = DEFAULT_DAEMON_CONFIG;

  const path = (dc.secrets?.path ?? '~/.omnitron/secrets.enc').replace('~', process.env['HOME'] ?? '');
  const passphrase = dc.secrets?.passphrase ?? 'omnitron-default-passphrase';

  return new SecretsService(path, passphrase);
}
