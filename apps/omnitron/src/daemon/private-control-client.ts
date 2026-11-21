import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Netron, type RemotePeer } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

export async function withControlDeadline<T>(work: Promise<T>, ms: number, message: string | (() => string)): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>(resolve => { timer = setTimeout(resolve, ms); });
  try {
    return await Promise.race([work, deadline.then(() => {
      throw new Error(typeof message === 'function' ? message() : message);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function assertPrivateControlSocket(socket: string): Promise<void> {
  const stat = await fs.lstat(socket);
  if (!stat.isSocket() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('Backend control requires a private Unix socket owned by this user');
  }
}

/** Local UID authority only; never turns a public bearer token into host execution rights. */
export async function privateControlClient<T>(socket: string, service: string, requestTimeout = 150_000): Promise<{ service: T; close(): Promise<void> }> {
  await assertPrivateControlSocket(socket);
  const netron = new Netron(createNullLogger(), { id: `local-control-${randomUUID()}` });
  netron.registerTransport('unix', () => new UnixSocketTransport());
  netron.setTransportOptions('unix', { requestTimeout });
  const close = () => withControlDeadline(netron.stop(), 2000, 'Private control disconnect timed out').catch(() => undefined);
  try {
    await netron.start();
    const peer = await withControlDeadline(netron.connect(`unix://${socket}`, false), 15_000, 'Private backend control handshake timed out') as RemotePeer;
    return { service: await peer.queryInterface<T>(service), close };
  } catch (error) { await close(); throw error; }
}
