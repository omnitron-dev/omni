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
import type { IOmnitronSecretsService } from '../shared/dto/services.js';

/**
 * Decide whether to fall back to direct file access, and say so when the
 * fallback is hiding something.
 *
 * The four commands below each carried `catch { /* Fall through *\/ }`. A
 * daemon that is not running is the case the fallback exists for, and
 * silence there is right. A daemon that IS running and whose RPC failed is a
 * different event entirely, and it was reported as success: `omnitron secret
 * list` printed the keys it read from disk while the daemon could not
 * decrypt the same file — the two sides had different default passphrases,
 * and the CLI's silent fallback is why that could persist unnoticed while
 * the console and the MCP tools failed.
 *
 * Returns true when the caller should read the file directly.
 */
function warnIfHidingAFailure(err: unknown, reachable: boolean): void {
  if (!reachable) return;
  log.warn(
    `Daemon is running but its secrets RPC failed: ${(err as Error)?.message ?? String(err)}`
  );
  log.warn('Falling back to direct file access — these two can disagree; the daemon\'s answer is what the console and MCP tools see.');
}

export async function secretSetCommand(key: string, value: string): Promise<void> {
  // Try daemon RPC first, fall back to direct file access
  const client = createDaemonClient();

  let reachable = false;
  try {
    reachable = await client.isReachable();
    if (reachable) {
      await (await secretsRpc(client)).set({ key, value });
      log.success(`Secret '${key}' set`);
      await client.disconnect();
      return;
    }
  } catch (err) {
    warnIfHidingAFailure(err, reachable);
  }
  await client.disconnect();

  // Direct file access (daemon offline)
  const secrets = await createDirectService();
  await secrets.set(key, value);
  log.success(`Secret '${key}' set (direct mode)`);
}

export async function secretGetCommand(key: string): Promise<void> {
  const client = createDaemonClient();

  let reachable = false;
  try {
    reachable = await client.isReachable();
    if (reachable) {
      const result = await (await secretsRpc(client)).get({ key });
      if (result.value !== null) {
        // Output raw value to stdout for scripting compatibility
        process.stdout.write(result.value + '\n');
      } else {
        log.warn(`Secret '${key}' not found`);
      }
      await client.disconnect();
      return;
    }
  } catch (err) {
    warnIfHidingAFailure(err, reachable);
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

  let reachable = false;
  try {
    reachable = await client.isReachable();
    if (reachable) {
      const result = await (await secretsRpc(client)).list();
      printKeys(result.keys);
      await client.disconnect();
      return;
    }
  } catch (err) {
    warnIfHidingAFailure(err, reachable);
  }
  await client.disconnect();

  // Direct file access
  const secrets = await createDirectService();
  const keys = await secrets.list();
  printKeys(keys);
}

export async function secretDeleteCommand(key: string): Promise<void> {
  const client = createDaemonClient();

  let reachable = false;
  try {
    reachable = await client.isReachable();
    if (reachable) {
      const result = await (await secretsRpc(client)).delete({ key });
      if (result.existed) {
        log.success(`Secret '${key}' deleted`);
      } else {
        log.warn(`Secret '${key}' not found`);
      }
      await client.disconnect();
      return;
    }
  } catch (err) {
    warnIfHidingAFailure(err, reachable);
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

/**
 * The daemon's secrets service.
 *
 * Through `client.service()`, the way every other command reaches a service.
 * This used to reach into the client's privates — `client['netron']`,
 * `getPeers()` — walk the peers itself and swallow every error with
 * `continue`, so a lookup that failed for any reason at all ended as
 *
 *     Daemon is running but its secrets RPC failed: OmnitronSecrets service not found
 *
 * on a daemon that exposes `OmnitronSecrets` unconditionally at startup.
 * Every write then went through the file fallback, which the warning beside
 * it says can disagree with what the console and the MCP tools see — and six
 * writes made that way in one sequence landed as none.
 */
/**
 * `omnitron secret rotate-rpcauth <passwordKey> --user-key <key> --auth-key <key>`
 *
 * A new RPC password, and the `rpcauth` value bitcoind keeps in its place,
 * written as a pair — the one writer of both, so the two cannot disagree.
 *
 * The password is born in this process and goes to the vault and nowhere
 * else: not on a command line (`secret set` takes its value as an argument,
 * which puts it in the shell history and the process table), not on the
 * terminal. What is printed is the key names and the user.
 */
export async function secretRotateRpcauthCommand(
  passwordKey: string,
  opts: { userKey: string; authKey: string },
): Promise<void> {
  const { randomBytes } = await import('node:crypto');
  const { rpcauth, rpcauthAccepts } = await import('../shared/rpcauth.js');

  const client = createDaemonClient();
  let reachable = false;
  try {
    reachable = await client.isReachable();
    const vault = reachable
      ? await (async () => {
          const rpc = await secretsRpc(client);
          return {
            get: async (key: string) => (await rpc.get({ key })).value,
            set: async (key: string, value: string) => void (await rpc.set({ key, value })),
          };
        })()
      : await (async () => {
          const direct = await createDirectService();
          return { get: (key: string) => direct.get(key), set: (key: string, value: string) => direct.set(key, value) };
        })();

    const user = await vault.get(opts.userKey);
    if (!user) {
      log.error(`'${opts.userKey}' is not in the vault — the rpcauth value names a user, and there is none to name.`);
      process.exitCode = 1;
      return;
    }

    // 32 random bytes, URL-safe: it may travel in a URL's userinfo.
    const password = randomBytes(32).toString('base64url');
    const auth = rpcauth(user, password);
    await vault.set(passwordKey, password);
    await vault.set(opts.authKey, auth);

    const [storedPassword, storedAuth] = [await vault.get(passwordKey), await vault.get(opts.authKey)];
    if (storedPassword !== password || !storedAuth || !rpcauthAccepts(storedAuth, user, password)) {
      log.error(`The vault did not keep the pair: '${passwordKey}' and '${opts.authKey}' may disagree — rotate again.`);
      process.exitCode = 1;
      return;
    }
    log.success(
      `Rotated '${passwordKey}' for user ${user}; '${opts.authKey}' holds its rpcauth value${reachable ? '' : ' (direct mode)'}. ` +
        'A deployment writes both where they go.',
    );
  } catch (err) {
    warnIfHidingAFailure(err, reachable);
    log.error(`Could not rotate '${passwordKey}': ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

async function secretsRpc(
  client: ReturnType<typeof createDaemonClient>,
): Promise<IOmnitronSecretsService> {
  return client.service<IOmnitronSecretsService>('OmnitronSecrets');
}

async function createDirectService(): Promise<import('../services/secrets.service.js').SecretsService> {
  const { SecretsService } = await import('../services/secrets.service.js');
  const { DaemonStateStore } = await import('../daemon/daemon-state-store.service.js');
  const { DEFAULT_DAEMON_CONFIG, DEFAULT_SECRETS_PASSPHRASE } = await import('../config/defaults.js');
  const { expandPath } = await import('../shared/paths.js');
  const dc = DEFAULT_DAEMON_CONFIG;

  // T-7 — the CLI doesn't have a daemon DI container, so we
  // construct a DaemonStateStore inline against the same SQLite
  // file the daemon uses. WAL mode + busy_timeout means a
  // concurrent daemon writer is safe; the CLI just waits up to 5s.
  const noopLogger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
     
  } as any;
  noopLogger.child = () => noopLogger;
  const store = new DaemonStateStore(noopLogger);

  const legacyPath = expandPath(dc.secrets?.path ?? '~/.omnitron/secrets.enc');
  const passphrase = dc.secrets?.passphrase ?? DEFAULT_SECRETS_PASSPHRASE;

  return new SecretsService(store, passphrase, legacyPath);
}
