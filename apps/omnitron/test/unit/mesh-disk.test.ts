import { describe, expect, it, vi } from 'vitest';
import { readMeshDisk } from '../../src/flows/mesh-disk.js';
import type { SystemSnapshot } from '../../src/shared/dto/system-info.js';

const volume = { mount: '/data', available: 0, size: 100 };
const snapshot = (changes = {}) =>
  ({ timestamp: Date.now(), disks: [volume], unanswered: {}, ...changes }) as SystemSnapshot;
describe('observations used to control a mesh flow', () => {
  it('retains real zero bytes, the enrolled identity and the time of observation', async () => {
    const observed = snapshot();
    const mesh = { identity: () => 'approved', snapshot: vi.fn(async () => observed) };
    expect(await readMeshDisk(mesh, 'worker', '/data', 'approved')).toEqual({
      nodeId: 'worker',
      nodeIdentity: 'approved',
      mount: '/data',
      freeBytes: 0,
      totalBytes: 100,
      observedAt: observed.timestamp,
    });
    expect(mesh.snapshot).toHaveBeenCalledExactlyOnceWith('worker');
  });
  it.each([
    ['missed deadline', { unanswered: { disks: 'timeout' } }],
    ['previous sample', { timestamp: 1 }],
    ['unusable clock', { timestamp: Date.now() + 86400000 }],
    ['missing mount', { disks: [{ ...volume, mount: '/' }] }],
    ['ambiguous mount', { disks: [volume, volume] }],
    ['invalid free space', { disks: [{ ...volume, available: 999 }] }],
  ])('rejects a %s as a source error', async (_label, change) => {
    const mesh = { identity: () => 'approved', snapshot: async () => snapshot(change) };
    await expect(readMeshDisk(mesh, 'worker', '/data', 'approved')).rejects.toThrow();
  });
  it('discards an in-flight reading when the approved machine changes', async () => {
    let identity = 'approved';
    const mesh = {
      identity: () => identity,
      snapshot: async () => {
        identity = 'replacement';
        return snapshot();
      },
    };
    await expect(readMeshDisk(mesh, 'worker', '/data', 'approved')).rejects.toThrow('changed');
  });
});
