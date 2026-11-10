import { readSavedDaemonConfig } from '../config/saved.js';
import { parseStoreConfig, releaseStoreLocation, resolveStore, S3ObjectStore, type ReleaseStoreConfig } from './artifact-store.js';

/** The CLI and the controller use the same configured destination and the same secret references. */
export function configuredStoreConfig(): ReleaseStoreConfig {
  return parseStoreConfig(readSavedDaemonConfig()?.releaseStore, '~/.omnitron/config.json');
}

export function releaseStoreStatus(): NonNullable<import('../shared/dto/services.js').ReleasePreflightDto['store']> {
  try {
    const raw = readSavedDaemonConfig()?.releaseStore;
    if (raw === undefined) return { state: 'unconfigured' };
    return { state: 'configured', location: releaseStoreLocation(parseStoreConfig(raw, 'daemon configuration')) };
  } catch {
    // Addresses and unknown values from a malformed document can contain credentials.
    return { state: 'invalid' };
  }
}

export async function configuredReleaseStore(
  config: ReleaseStoreConfig,
  readSecret: (key: string) => Promise<string | null>,
  signal?: AbortSignal,
): Promise<S3ObjectStore> {
  signal?.throwIfAborted();
  const store = await resolveStore(config, readSecret);
  const route = store.ssh;
  if (!route) return new S3ObjectStore(store);
  const privateKey = await readSecret(route.privateKey.secret);
  if (!privateKey || !/^-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\r\n]/.test(privateKey))
    throw new Error('The S3 SSH identity must be a private key in the referenced vault entry');
  const passphrase = route.passphrase ? await readSecret(route.passphrase.secret) : undefined;
  if (route.passphrase && !passphrase) throw new Error('The S3 SSH passphrase is missing from the vault');
  signal?.throwIfAborted();
  const { NodeSSH } = await import('@xec-sh/core/ssh');
  const ssh = new NodeSSH();
  const abort = () => ssh.dispose(true);
  try {
    await ssh.connect({
      host: route.host, port: route.port, username: route.username, privateKey, ...(passphrase && { passphrase }),
      hostKeyChecking: 'strict', expectedHostFingerprint: route.hostFingerprint,
      ...(signal && { signal }), readyTimeout: 15_000, keepaliveInterval: 10_000, keepaliveCountMax: 3,
    });
    signal?.addEventListener('abort', abort, { once: true });
    signal?.throwIfAborted();
    const tunnel = await ssh.createTunnel({ localHost: '127.0.0.1', localPort: 0,
      remoteHost: store.endpoint.hostname === '[::1]' ? '::1' : '127.0.0.1', remotePort: Number(store.endpoint.port || 80) });
    const closed = tunnel.closed.finally(() => { signal?.removeEventListener('abort', abort); ssh.dispose(true); });
    return new S3ObjectStore(store, { route: { port: tunnel.localPort, closed, close: () => tunnel.close() } });
  } catch (error) {
    signal?.removeEventListener('abort', abort);
    ssh.dispose(true);
    throw error;
  }
}
