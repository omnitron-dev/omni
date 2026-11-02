import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { LeaseGrant } from '@omnitron-dev/titan-database/coordination';
import { ClusterRecipient, ClusterSigner, type StackEffectPlan } from '../../src/cluster/stop-authority.js';
import type { NodeStackStopPlan } from '../../src/project/node-stack-stop.js';

const audience = { clusterId: 'west', nodeId: 'edge-7' };
const scope = { project: 'sample', stack: 'production' };

function lease(signer: ClusterSigner, epoch = '12'): LeaseGrant {
  return { key: 'omnitron/cluster/west', owner: 'leader', incarnation: signer.incarnation, epoch,
    remainingMs: 10_000, expiresAt: new Date(Date.now() + 10_000).toISOString() };
}

function recipientState() {
  const records = new Map<string, unknown>();
  return {
    kvUpdateSync<T>(key: string, update: (old: T | null) => T): T {
      const result = update((records.get(key) ?? null) as T | null);
      records.set(key, result);
      return result;
    },
  };
}

function plans() {
  const start: StackEffectPlan = { ...scope, audience, operation: 'stack.resume-installed', operationId: 'prepared-on-worker',
    definition: 'a'.repeat(64), expiresAt: Date.now() + 10_000 };
  const stop: NodeStackStopPlan = { ...scope, audience, protocol: 1, definition: start.definition, operationId: start.operationId,
    expiresAt: start.expiresAt, applications: true, execution: null, containers: [{ id: 'b'.repeat(64), name: 'sample-service' }] };
  return { start, stop };
}

describe('recipient-bound stack effect authority', () => {
  it('preserves the original stop protocol and separates its signature from installed recovery at the same scope', async () => {
    const signer = new ClusterSigner(), grant = lease(signer);
    const node = new ClusterRecipient(audience, { read: async () => grant }, recipientState());
    const { start, stop } = plans();
    const stopPermit = signer.issue(stop, grant), startPermit = signer.issueEffect(start, grant);
    const legacy = ['omnitron/stack.stop/v1', 'west', 'edge-7', grant.owner, grant.incarnation, grant.epoch, 'sample',
      'production', true, stop.operationId, stop.expiresAt, stop.definition, null, stop.containers.map(c => [c.id, c.name])];
    const key = createPublicKey({ key: Buffer.from(grant.incarnation, 'base64url'), type: 'spki', format: 'der' });
    expect(verify(null, Buffer.from(JSON.stringify(legacy)), key, Buffer.from(stopPermit.signature, 'base64url'))).toBe(true);
    await node.admit(stop, stopPermit);
    await node.admitEffect(start, startPermit);
    const fields = [audience.clusterId, audience.nodeId, grant.owner, grant.incarnation, grant.epoch, start.project,
      start.stack, start.operationId, start.expiresAt, start.definition];
    for (const [action, valid] of [['stack.resume-installed', true], ['stack.start', false]] as const) {
      expect(verify(null, Buffer.from(JSON.stringify(['omnitron/' + action + '/v1', ...fields])), key,
        Buffer.from(startPermit.signature, 'base64url'))).toBe(valid);
    }
    expect(() => signer.issueEffect({ ...start, operation: 'stack.start' as never }, grant)).toThrow('stack.resume-installed');
    await expect(node.admit(stop, startPermit)).rejects.toThrow('signature');
    await expect(node.admitEffect(start, stopPermit)).rejects.toThrow('signature');
  });

  it('binds the installed digest, scope, execution identity, deadline, recipient and operation', async () => {
    const signer = new ClusterSigner(), grant = lease(signer);
    const node = new ClusterRecipient(audience, { read: async () => grant }, recipientState());
    const { start } = plans();
    const permit = signer.issueEffect(start, grant);
    expect(() => signer.issueEffect({ ...start, expiresAt: Date.now() + 3_600_000 }, grant)).toThrow('signing window');
    for (const changed of [{ definition: 'b'.repeat(64) }, { project: 'another' }, { stack: 'staging' },
      { operationId: 'new-plan' }, { expiresAt: start.expiresAt + 1 }]) {
      await expect(node.admitEffect({ ...start, ...changed }, permit)).rejects.toThrow('signature');
    }
    await expect(node.admitEffect({ ...start, audience: { ...audience, nodeId: 'edge-8' } }, permit)).rejects.toThrow('recipient');
    await expect(node.admitEffect({ ...start, operation: 'stack.provision' as never }, permit)).rejects.toThrow('stack.resume-installed');
    await expect(node.admitEffect({ ...start, expiresAt: Date.now() - 1 }, permit)).rejects.toThrow('expired');
    await expect(node.admitEffect(start)).rejects.toThrow('leader-signed');
  });

  it('rejects an old permit after replacement and retains the same durable epoch across operations and recipient restart', async () => {
    const first = new ClusterSigner(), old = lease(first, '9007199254740992');
    const second = new ClusterSigner(), next = lease(second, '9007199254740993');
    const { start, stop } = plans();
    const read = vi.fn().mockResolvedValue(old), saved = recipientState();
    const node = new ClusterRecipient(audience, { read }, saved);
    const stale = first.issueEffect(start, old);
    await node.admitEffect(start, stale);
    read.mockResolvedValue(next);
    await expect(node.admitEffect(start, stale)).rejects.toThrow('no longer holds');
    await node.admit(stop, second.issue(stop, next));
    const restarted = new ClusterRecipient(audience, { read: async () => old }, saved);
    await expect(restarted.admitEffect(start, stale)).rejects.toThrow('durable node fence');
  });

  it('fails closed when confirmation expires, the primary fails, or persisted authority is corrupt', async () => {
    const signer = new ClusterSigner(), grant = lease(signer);
    const { start } = plans();
    const permit = signer.issueEffect(start, grant), saved = recipientState();
    const read = vi.fn().mockResolvedValue({ ...grant, remainingMs: 0 });
    const node = new ClusterRecipient(audience, { read }, saved);
    await expect(node.admitEffect(start, permit)).rejects.toThrow('expired in transit');
    read.mockRejectedValueOnce(new Error('primary offline'));
    await expect(node.admitEffect(start, permit)).rejects.toThrow('primary offline');
    saved.kvUpdateSync('lifecycle:cluster-epoch:west', () => ({ ...permit, epoch: 12 }));
    read.mockResolvedValue(grant);
    await expect(node.admitEffect(start, permit)).rejects.toThrow('durable node fence');
  });
});
