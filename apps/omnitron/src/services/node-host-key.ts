import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { INode } from '../shared/dto/nodes.js';

type SshNode = Pick<INode, 'id' | 'host' | 'sshPort' | 'sshUser'>;
interface HostPin { target: string; fingerprint: string }

export function nodeSshIdentity(node: Omit<SshNode, 'id'>): string {
  return JSON.stringify([node.host, node.sshPort, node.sshUser]);
}

export const isSshHostFingerprint = (value: unknown): value is string =>
  typeof value === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(value);

// Keep the existing KV namespace so previous approvals apply to the exact same endpoint.
export function nodeHostPinKey(id: string): string {
  return `terminal:host-key:${id}`;
}

export function nodeHostFingerprint(store: Pick<DaemonStateStore, 'kvGetSync'>, node: SshNode): string | null {
  const pin = store.kvGetSync<HostPin>(nodeHostPinKey(node.id), { strict: true });
  if (pin == null) return null;
  if (typeof pin.target !== 'string' || !isSshHostFingerprint(pin.fingerprint))
    throw new Error('Invalid stored SSH host key approval');
  return pin.target === nodeSshIdentity(node) ? pin.fingerprint : null;
}
