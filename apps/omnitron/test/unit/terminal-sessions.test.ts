import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalRpcService, TERMINAL_LIMITS, terminalPolicy } from '../../src/services/terminal.rpc-service.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import { AuditService } from '../../src/services/audit.service.js';
import type { TerminalDriver } from '../../src/services/terminal-ssh.js';

const fingerprint = `SHA256:${'a'.repeat(43)}`;
const actor = (userId = 'alice', sessionId = 'session-a', role = 'admin') => ({
  userId,
  roles: [role],
  permissions: [],
  metadata: { sessionId },
});
const instances: TerminalRpcService[] = [];
afterEach(() => {
  for (const service of instances.splice(0)) service.dispose();
});

function fixture(policy = {}) {
  let now = 1000,
    role = 'admin';
  const node = { id: 'n1', name: 'test-node', host: 'test.invalid', sshUser: 'deploy', sshPort: 22, isLocal: false };
  const pins = new Map<string, unknown>();
  let output: (bytes: Buffer) => void = () => {};
  const pty = { write: vi.fn(async () => {}), resize: vi.fn(), close: vi.fn() };
  const driver: TerminalDriver = {
    probe: vi.fn(async () => fingerprint),
    connect: vi.fn(async (_target, _pin, _cols, _rows, onData) => {
      output = onData;
      return pty;
    }),
  };
  const audit = { record: vi.fn(async () => {}) };
  const auth = {
    validateSession: vi.fn(async (id: string) => (role ? { id: id === 'session-b' ? 'bob' : 'alice', role } : null)),
  };
  const service = new TerminalRpcService(
    {
      getNode: () => node,
      nodeToSshTarget: async () => ({ host: node.host, username: node.sshUser, password: 'private-password' }),
    } as any,
    auth as any,
    {
      kvGetSync: (key: string) => pins.get(key) ?? null,
      kvSetSync: (key: string, value: unknown) => {
        pins.set(key, value);
      },
    } as any,
    audit,
    policy,
    driver,
    () => now
  );
  instances.push(service);
  const as = <T>(fn: () => T) => runWithAuth(actor(), fn);
  const trust = () => as(() => service.trustHost({ nodeId: node.id, fingerprint, previous: null }));
  const open = () => as(() => service.open({ nodeId: node.id, cols: 80, rows: 24 }));
  return {
    service,
    node,
    driver,
    pty,
    audit,
    auth,
    trust,
    open,
    as,
    output: (bytes: Buffer) => output(bytes),
    setRole: (value: string) => {
      role = value;
    },
    time: (value: number) => {
      now = value;
    },
  };
}

describe('SSH terminal policy and lifecycle', () => {
  it('allows closing a pruned session while still checking current authority', async () => {
    const f = fixture();
    await f.trust();
    const session = await f.open();
    await f.as(() => f.service.close({ id: session.id }));
    f.time(62_000);
    await f.service.sweep();
    expect(await f.as(() => f.service.list())).toEqual([]);
    await expect(f.as(() => f.service.close({ id: session.id }))).resolves.toBeUndefined();
    expect(f.pty.close).toHaveBeenCalledTimes(1);
    f.setRole('viewer');
    await expect(f.as(() => f.service.close({ id: session.id }))).rejects.toThrow(/revoked|administrator/);
  });
  it('refuses anonymous, viewer, operator and non-session admins before any network action', async () => {
    const f = fixture();
    await expect(f.service.capabilities()).rejects.toThrow();
    for (const role of ['viewer', 'operator', 'service_role'])
      await expect(
        runWithAuth(actor('alice', 'session-a', role), () => f.service.inspectHost({ nodeId: 'n1' }))
      ).rejects.toThrow();
    await expect(
      runWithAuth({ userId: 'alice', roles: ['admin'], permissions: [] }, () => f.service.capabilities())
    ).rejects.toThrow();
    expect(f.driver.probe).not.toHaveBeenCalled();
  });

  it('requires trusted host identity and a successful required audit write before connecting', async () => {
    const f = fixture();
    await expect(f.open()).rejects.toThrow(/host key/);
    await f.trust();
    f.audit.record.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(f.open()).rejects.toThrow('audit unavailable');
    expect(f.driver.connect).not.toHaveBeenCalled();
    expect(f.audit.record.mock.calls[0]?.[1]).toBe(true);
  });

  it('does not expose, read, write, resize or close another browser session’s shell', async () => {
    const f = fixture();
    await f.trust();
    const session = await f.open();
    await runWithAuth(actor('bob', 'session-b'), async () => {
      expect(await f.service.list()).toEqual([]);
      await expect(f.service.read({ id: session.id, cursor: 0, wait: false })).rejects.toThrow();
      await expect(f.service.write({ id: session.id, sequence: 0, data: 'id\r' })).rejects.toThrow();
      await expect(f.service.resize({ id: session.id, cols: 100, rows: 30 })).rejects.toThrow();
      await expect(f.service.close({ id: session.id })).rejects.toThrow();
    });
    await expect(
      runWithAuth(actor('alice', 'different-session'), () => f.service.close({ id: session.id }))
    ).rejects.toThrow();
    expect(f.pty.close).not.toHaveBeenCalled();
  });

  it('reserves capacity across concurrent opens and validates geometry', async () => {
    const f = fixture({ maxSessionsPerOwner: 1 });
    await f.trust();
    const results = await Promise.allSettled([f.open(), f.open()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.driver.connect).toHaveBeenCalledTimes(1);
    await expect(f.as(() => f.service.open({ nodeId: 'n1', cols: NaN, rows: 24 }))).rejects.toThrow(/cols/);
  });

  it('keeps binary output bounded and explicitly reports lost bytes with resumable cursors', async () => {
    const f = fixture();
    await f.trust();
    const session = await f.open();
    const bytes = Buffer.alloc(TERMINAL_LIMITS.outputBytes + 17, 0xff);
    f.output(bytes);
    const first = await f.as(() => f.service.read({ id: session.id, cursor: 0, wait: false }));
    expect(first.droppedBytes).toBe(17);
    expect(first.cursor).toBe(17 + TERMINAL_LIMITS.readBytes);
    expect(Buffer.from(first.data, 'base64')).toEqual(bytes.subarray(17, first.cursor));
    const replay = await f.as(() => f.service.read({ id: session.id, cursor: 0, wait: false }));
    expect(replay.data).toBe(first.data);
  });

  it('deduplicates an acknowledged write and refuses different or out-of-order replays', async () => {
    const f = fixture();
    await f.trust();
    const session = await f.open();
    const input = { id: session.id, sequence: 0, data: Buffer.from('echo hello\r').toString('base64') };
    await f.as(() => f.service.write(input));
    await f.as(() => f.service.write(input));
    expect(f.pty.write).toHaveBeenCalledTimes(1);
    await expect(
      f.as(() => f.service.write({ ...input, data: Buffer.from('other\r').toString('base64') }))
    ).rejects.toThrow(/order/);
    await expect(f.as(() => f.service.write({ ...input, sequence: 2 }))).rejects.toThrow(/order/);
    await expect(
      f.as(() => f.service.write({ ...input, sequence: 1, data: Buffer.alloc(8193).toString('base64') }))
    ).rejects.toThrow(/8192/);
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain('echo hello');
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain('private-password');
  });

  it('preserves binary input and drains retained output after shell exit', async () => {
    const f = fixture();
    await f.trust();
    const s = await f.open();
    const binary = Buffer.from([0x1b, 0x5b, 0x4d, 0xff, 0x80, 0x00]);
    await f.as(() => f.service.write({ id: s.id, sequence: 0, data: binary.toString('base64') }));
    expect(f.pty.write).toHaveBeenCalledWith(binary);
    await expect(f.as(() => f.service.write({ id: s.id, sequence: 1, data: '%%%=' }))).rejects.toThrow(/base64/);
    const bytes = Buffer.alloc(TERMINAL_LIMITS.readBytes + 19, 0x61);
    f.output(bytes);
    await f.as(() => f.service.close({ id: s.id }));
    const first = await f.as(() => f.service.read({ id: s.id, cursor: 0 }));
    expect(first.session.state).toBe('closed');
    expect(first.hasMore).toBe(true);
    const last = await f.as(() => f.service.read({ id: s.id, cursor: first.cursor }));
    expect(last.hasMore).toBe(false);
    expect(Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(last.data, 'base64')])).toEqual(bytes);
  });

  it('wakes pending reads on revocation without leaking retained output', async () => {
    const f = fixture();
    await f.trust();
    const s = await f.open();
    const pending = f.as(() => f.service.read({ id: s.id, cursor: 0 }));
    const rejected = expect(pending).rejects.toThrow(/revoked|administrator/);
    f.setRole('viewer');
    await f.service.sweep();
    await rejected;
    expect(f.pty.close).toHaveBeenCalledTimes(1);
  });

  it('closes on demotion, even without another browser request', async () => {
    const f = fixture();
    await f.trust();
    await f.open();
    f.setRole('viewer');
    await f.service.sweep();
    expect(f.pty.close).toHaveBeenCalledTimes(1);
    await expect(f.as(() => f.service.list())).rejects.toThrow(/lost administrator/);
  });

  it('closes when the session store fails, without treating the failure as permission', async () => {
    const f = fixture();
    await f.trust();
    await f.open();
    f.auth.validateSession.mockRejectedValueOnce(new Error('database unavailable'));
    await f.service.sweep();
    expect(f.pty.close).toHaveBeenCalledTimes(1);
  });

  it('does not extend idle lifetime by reading output', async () => {
    const f = fixture({ idleTimeoutMs: 1000 });
    await f.trust();
    const s = await f.open();
    f.time(2100);
    await f.as(() => f.service.read({ id: s.id, cursor: 0, wait: false }));
    await f.service.sweep();
    expect(f.pty.close).toHaveBeenCalledTimes(1);
  });

  it('closes a disappeared browser and terminates sockets on daemon disposal', async () => {
    const f = fixture({ disconnectTimeoutMs: 1000 });
    await f.trust();
    await f.open();
    f.time(2100);
    await f.service.sweep();
    expect(f.pty.close).toHaveBeenCalledTimes(1);
    await f.open();
    f.service.dispose();
    expect(f.pty.close).toHaveBeenCalledTimes(2);
  });

  it('host changes invalidate trust and close established terminals', async () => {
    const f = fixture();
    await f.trust();
    await f.open();
    f.node.host = 'other.invalid';
    await f.service.sweep();
    expect(f.pty.close).toHaveBeenCalledTimes(1);
    await expect(f.open()).rejects.toThrow(/host key/);
  });

  it('a required audit cannot silently succeed without a database', async () => {
    const audit = new AuditService({ error: vi.fn() } as any, null);
    await expect(audit.record({ action: 'terminal.open', resourceType: 'terminal' }, true)).rejects.toThrow(/required/);
    await expect(audit.record({ action: 'read', resourceType: 'app' })).resolves.toBeUndefined();
    expect(() => terminalPolicy({ maxSessions: Infinity })).toThrow();
  });
});
