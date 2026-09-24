/**
 * What a remote check actually reports.
 *
 * The OS row of every remote node card in the console was wrong, and had
 * been since the check was written. Observed live on `acme-test`:
 *
 *   os: { platform: "linux", arch: "acme-cpp", hostname: "x86_64" }
 *
 * `acme-cpp` is the machine's HOSTNAME and `x86_64` is its ARCHITECTURE. The
 * command was `uname -s -m -n` and the parser read the reply as
 * `[platform, arch, hostname]` — but `uname` does not print in the order of
 * its flags. It prints its fields in one fixed order, so the reply was
 * `Linux <nodename> <machine>` every time.
 */

import { describe, it, expect, vi } from 'vitest';

const sshMock = vi.fn();

vi.mock('../../src/execution/execution.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/execution/execution.service.js')>();
  class MockExecutionService {
    ssh = sshMock;
    exec = vi.fn();
    dispose = vi.fn();
    constructor(_logger: any) {}
  }
  return { ...actual, ExecutionService: MockExecutionService };
});

const { RemoteOpsService } = await import('../../src/services/remote-ops.service.js');

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
};

const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, duration: 1 });

describe('checkSsh — reading a remote machine', () => {
  it('does not swap the hostname and the architecture', async () => {
    sshMock.mockReset();
    // One field per line, in the order asked for — which is the point: the
    // reply can no longer be read in an order the command does not promise.
    sshMock.mockResolvedValue(ok('ok\nLinux\nacme-cpp\nx86_64\n6.8.0-51-generic'));

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkSsh({ host: '37.27.130.185' });

    expect(result.connected).toBe(true);
    expect(result.os).toEqual({
      platform: 'linux',
      hostname: 'acme-cpp',
      arch: 'x86_64',
      release: '6.8.0-51-generic',
    });
  });

  it('carries the kernel release rather than an empty string', async () => {
    sshMock.mockReset();
    sshMock.mockResolvedValue(ok('ok\nDarwin\nmac-1\narm64\n24.4.0'));

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkSsh({ host: 'mac-1.example' });

    // The worker used to write `release: ''` unconditionally, so the field
    // existed on every row and said nothing on all of them.
    expect(result.os?.release).toBe('24.4.0');
  });

  it('reports a failure with its reason on one line', async () => {
    sshMock.mockReset();
    sshMock.mockResolvedValue({
      stdout: '',
      stderr: 'Permission denied (publickey).\nsome trailing noise',
      exitCode: 255,
      duration: 3,
    });

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkSsh({ host: 'node.example' });

    expect(result.connected).toBe(false);
    expect(result.error).toBe('Permission denied (publickey).');
  });
});

/**
 * What a node's answer looks like on the wire since it travels the data
 * channel: `throughDataChannel` hex-encodes the command's stdout on the node,
 * so the masker has nothing to match (`execution/data-channel.ts`).
 */
const answered = (text: string) => ok(Buffer.from(text, 'utf8').toString('hex'));

describe('checkRemoteOmnitron — absent is not the same as down', () => {
  it('says so when omnitron is not installed', async () => {
    sshMock.mockReset();
    sshMock.mockResolvedValue({
      stdout: '', stderr: 'omnitron: command not found', exitCode: 127, duration: 2,
    });

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkRemoteOmnitron({ host: 'node.example' });

    // The console has a "Not installed" dot state it reaches by matching this
    // text. Every failure used to come back as a bare `{ connected: false }`,
    // so that state was unreachable and the dot always said "offline".
    expect(result.connected).toBe(false);
    expect(result.error).toMatch(/command not found/);
  });

  it('reads a running daemon', async () => {
    // The answer a node actually gives. This test used to assert a flat
    // `{pid, version, uptime, role}` — a shape nobody had measured — and
    // passed against a reader that could never recognise a real node. The
    // fleet listed every daemon `○ offline` for as long as both existed.
    sshMock.mockReset();
    sshMock.mockResolvedValue(
      answered(
        JSON.stringify({
          ok: true,
          data: { version: '0.2.0', pid: 42, uptime: 1000, role: 'slave', appsTotal: 6, appsOnline: 6, apps: [] },
        }),
      ),
    );

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkRemoteOmnitron({ host: 'node.example' });

    expect(result).toMatchObject({ connected: true, pid: 42, version: '0.2.0', role: 'slave' });
    expect(result.error).toBeUndefined();
  });

  it('does not read a flat object as a daemon', async () => {
    // Not a node's answer in any version that has shipped. Accepting one
    // would make any JSON with the right field names read as a healthy
    // daemon, and this check runs against whatever `omnitron` happens to be
    // on the far end of an SSH session.
    sshMock.mockReset();
    sshMock.mockResolvedValue(answered(JSON.stringify({ pid: 42, version: '0.2.0' })));

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkRemoteOmnitron({ host: 'node.example' });

    expect(result.connected).toBe(false);
    expect(result.error).toMatch(/no running daemon/);
  });

  it('distinguishes "answered with nonsense" from "is not running"', async () => {
    sshMock.mockReset();
    sshMock.mockResolvedValue(answered('<html>a proxy ate this</html>'));

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkRemoteOmnitron({ host: 'node.example' });

    expect(result.connected).toBe(false);
    expect(result.error).toMatch(/did not return JSON/);
  });

  it('asks through the data channel, so an answer the masker would rewrite arrives whole', async () => {
    // A daemon's `errors` can quote anything an app said — `"token": …`
    // included — and through the masker that became `"token": [REDACTED]`,
    // which is not JSON: a running daemon read as «did not return JSON».
    sshMock.mockReset();
    sshMock.mockResolvedValue(
      answered(JSON.stringify({ ok: true, data: { pid: 7, errors: ['{"token":"a1b2","password":"hunter2"}'] } })),
    );

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkRemoteOmnitron({ host: 'node.example' });

    expect(result).toMatchObject({ connected: true, pid: 7 });
    expect(String(sshMock.mock.calls[0]![1])).toContain("od -An -v -tx1");
  });

  it('refuses a channel that came back rewritten, rather than reading it', async () => {
    sshMock.mockReset();
    sshMock.mockResolvedValue(ok('7b226f6b223a[REDACTED]'));

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkRemoteOmnitron({ host: 'node.example' });

    expect(result.connected).toBe(false);
    expect(result.error).toMatch(/data channel came back as something other than its encoding/);
  });

  it('refuses a role it does not recognise instead of passing it through', async () => {
    sshMock.mockReset();
    sshMock.mockResolvedValue(answered(JSON.stringify({ ok: true, data: { pid: 1, role: 'something-else' } })));

    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.checkRemoteOmnitron({ host: 'node.example' });

    expect(result.role).toBeUndefined();
  });
});

describe('ping — the host never reaches a shell', () => {
  it('refuses a host that is not one, without spawning anything', async () => {
    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.ping("x'; touch /tmp/pwned; '");

    expect(result.reachable).toBe(false);
    expect(result.error).toMatch(/Invalid host/);
  });

  it('reaches the loopback address it is given', async () => {
    // A real ICMP ping to 127.0.0.1: no network, no privileges beyond what
    // the daemon already has, and it proves the argument list actually runs.
    const ops = new RemoteOpsService(silentLogger);
    const result = await ops.ping('127.0.0.1', 3_000);

    expect(result.reachable).toBe(true);
    expect(result.latencyMs).not.toBeNull();
  });
});
