import { describe, expect, it, vi } from 'vitest';
import { assertSafeNetworkPublication, isLoopbackHost } from '../../src/daemon/network-publication.js';

describe('network publication admission', () => {
  it.each(['127.attacker.example', '127.0.0.1.example', '127.999.0.1', '', '0.0.0.0'])('does not mistake %s for a loopback address', host => {
    expect(isLoopbackHost(host)).toBe(false);
  });
  it('keeps local recovery available without a database credential check', async () => {
    const check = vi.fn(async () => { throw new Error('database unavailable'); });
    await assertSafeNetworkPublication(['127.0.0.1', '::1'], check);
    expect(check).not.toHaveBeenCalled();
  });
  it('refuses external publication with seeded credentials', async () => {
    await expect(assertSafeNetworkPublication(['0.0.0.0'], async () => true)).rejects.toThrow('seeded');
  });
  it('refuses an unavailable policy check instead of treating it as a changed password', async () => {
    await expect(assertSafeNetworkPublication(['10.0.0.1'], async () => { throw new Error('offline'); })).rejects.toThrow('could not be verified');
  });
  it('waits for explicit confirmation before allowing external ingress', async () => {
    let complete!: (value: boolean) => void;
    let admitted = false;
    const waiting = assertSafeNetworkPublication(['0.0.0.0'], () => new Promise(resolve => { complete = resolve; })).then(() => { admitted = true; });
    await Promise.resolve();
    expect(admitted).toBe(false);
    complete(false);
    await waiting;
    expect(admitted).toBe(true);
  });
});
