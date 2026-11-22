import type { Duplex } from 'node:stream';
import type { HostConfigGrant, HostConfigReceipt } from '../shared/dto/host-bindings.js';
import type { SSHTarget } from '../execution/execution.service.js';
import { resolveSecretRefs } from '../project/config-resolver.js';
import type { hostBindingMaterial } from './host-binding-review.js';
import { checkHello, checkInstallReceipt, fields, hostConfigAuthenticationFailure, hostConfigForwardFailure, HostConfigFrames, renderInstalledConfigs, required, sameGrant, socketPath } from './host-config-transfer.js';

export async function connectHostConfigInstaller(target: SSHTarget, ticket: string, signal: AbortSignal) {
  required(target.username === 'root' && target.expectedHostFingerprint && /^SHA256:[A-Za-z0-9+/]{43}$/.test(target.expectedHostFingerprint));
  const { SSHClient } = await import('@xec-sh/ssh');
  const ssh = new SSHClient();
  try { await ssh.connect({ ...target, username: 'root', signal, readyTimeout: 10000 }); }
  catch { ssh.dispose(true); throw Error(hostConfigAuthenticationFailure); }
  try {
    const stream = await ssh.forwardOutStreamLocal(socketPath(ticket), { signal, timeoutMs: 5000 });
    return { stream, close: () => { stream.destroy(); ssh.dispose(true); } };
  } catch { ssh.dispose(true); throw Error(hostConfigForwardFailure); }
}

export async function installOverHostConfigChannel(grant: HostConfigGrant, material: ReturnType<typeof hostBindingMaterial>,
  channel: Duplex, recheck: () => Promise<void>, vault: (key: string) => Promise<string | null>): Promise<HostConfigReceipt> {
  const hello = { grant, review: material.review, templates: material.templates };
  checkHello(hello, grant);
  const frames = new HostConfigFrames(channel);
  await recheck();
  await frames.send(hello);
  const reply = await frames.read();
  if (fields(reply, ['done'])) { await recheck(); return checkInstallReceipt(reply['done'] as HostConfigReceipt, grant); }
  required(fields(reply, ['ticket', 'nodeId', 'review', 'nonce', 'expires']) && sameGrant(reply as HostConfigGrant, grant) &&
    typeof reply['nonce'] === 'string' && /^[a-f0-9-]{36}$/.test(reply['nonce']) && typeof reply['expires'] === 'number' &&
    Number.isSafeInteger(reply['expires']) && reply['expires'] <= Date.now() + 600000);
  const expires = reply['expires'];
  const fresh = () => required(!channel.destroyed && !channel.readableEnded && !channel.writableEnded && Date.now() < expires);
  await recheck();
  let values: Record<string, unknown>;
  try { fresh(); values = await resolveSecretRefs(material.references, key => { fresh(); return vault(key); }); renderInstalledConfigs(hello, values); }
  catch { throw Error('A required approved service binding is unavailable or cannot be represented by its native configuration directive'); }
  await recheck();
  fresh();
  try {
    await frames.send({ nonce: reply['nonce'], values });
    const result = await frames.read();
    required(fields(result, ['done'])); return checkInstallReceipt(result['done'] as HostConfigReceipt, grant);
  } catch { throw Error('Installation acknowledgement is unavailable. Reconcile the original reviewed ticket before starting any further installation'); }
}
