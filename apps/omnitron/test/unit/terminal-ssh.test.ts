import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { XecTerminalDriver } from '../../src/services/terminal-ssh.js';

const driver = vi.hoisted(() => ({
  probe: vi.fn(), connect: vi.fn(), open: vi.fn(), dispose: vi.fn(),
  lifecycle: null as EventEmitter | null,
}));
vi.mock('@xec-sh/ssh', () => ({
  SSHClient: class {
    static probeHostKey = driver.probe;
    connect = driver.connect;
    requestShell = driver.open;
    dispose = driver.dispose;
    get connection() { return driver.lifecycle; }
  },
}));

class Shell extends Duplex {
  stderr = new PassThrough();
  setWindow = vi.fn();
  writes: Array<{ bytes: Buffer; done: (error?: Error | null) => void }> = [];
  override _read(): void {}
  override _write(bytes: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.writes.push({ bytes, done });
  }
}

const target = { host: 'terminal.invalid', port: 2222, username: 'operator', password: 'synthetic' };
const fingerprint = `SHA256:${'a'.repeat(43)}`;
const shells: Shell[] = [];
const signals: AbortController[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  driver.lifecycle = new EventEmitter();
  driver.connect.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const signal of signals.splice(0)) signal.abort();
  for (const shell of shells.splice(0)) { shell.destroy(); shell.stderr.destroy(); }
  vi.useRealTimers();
});

function fixture() {
  const shell = new Shell(), controller = new AbortController();
  shells.push(shell); signals.push(controller);
  driver.open.mockResolvedValue(shell);
  const onData = vi.fn(), onClose = vi.fn();
  const terminal = new XecTerminalDriver();
  const connect = () => terminal.connect(target, fingerprint, 100, 30, onData, onClose, controller.signal);
  return { shell, controller, onData, onClose, terminal, connect };
}

describe('terminal uses the public Xec SSH client', () => {
  it('observes the host key without opening an authenticated terminal', async () => {
    driver.probe.mockResolvedValue(fingerprint);
    await expect(new XecTerminalDriver().probe({ host: target.host })).resolves.toBe(fingerprint);
    expect(driver.probe).toHaveBeenCalledWith({ host: target.host, port: 22 });
    expect(driver.connect).not.toHaveBeenCalled();
    expect(driver.open).not.toHaveBeenCalled();
  });

  it('binds the selected host, verified key, cancellation and PTY dimensions', async () => {
    const f = fixture(), terminal = await f.connect();
    expect(driver.connect).toHaveBeenCalledWith(expect.objectContaining({
      ...target, expectedHostFingerprint: fingerprint, signal: f.controller.signal,
      readyTimeout: 15_000,
    }));
    expect(driver.open).toHaveBeenCalledWith(
      { term: 'xterm-256color', cols: 100, rows: 30, width: 0, height: 0 },
      { signal: f.controller.signal, timeoutMs: 15_000 },
    );
    const output = Buffer.from([0, 255, 10]);
    f.shell.push(output); f.shell.stderr.write('diagnostic');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.onData).toHaveBeenCalledWith(output);
    expect(f.onData).toHaveBeenCalledWith(Buffer.from('diagnostic'));
    terminal.resize(120, 40);
    expect(f.shell.setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
    terminal.close(); terminal.close();
    expect(driver.dispose).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.onClose).toHaveBeenCalledExactlyOnceWith('closed_by_operator', undefined);
  });

  it('waits for the channel write callback and rejects pending input on cancellation', async () => {
    const f = fixture(), terminal = await f.connect();
    const input = Buffer.from([0, 27, 65, 255]);
    const written = terminal.write(input);
    let completed = false;
    void written.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(f.shell.writes[0]?.bytes).toEqual(input);
    f.shell.writes[0]!.done();
    await written;
    const interrupted = terminal.write(Buffer.from('next'));
    const rejection = expect(interrupted).rejects.toThrow('SSH input failed');
    f.controller.abort();
    await rejection;
    expect(driver.dispose).toHaveBeenCalledExactlyOnceWith(true);
    await expect(terminal.write(Buffer.from('late'))).rejects.toThrow('closed');
  });

  it.each([0, 9, null])('preserves numeric exit status and accepts signal-only exit (%s)', async code => {
    const f = fixture();
    await f.connect();
    f.shell.emit('exit', code, code === null ? 'TERM' : undefined);
    f.shell.emit('close');
    expect(f.onClose).toHaveBeenCalledExactlyOnceWith('shell_exited', code ?? undefined);
    expect(driver.dispose).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('disposes a late channel when cancellation wins the opening race', async () => {
    const f = fixture();
    const opening = Promise.withResolvers<Shell>();
    driver.open.mockReturnValue(opening.promise);
    const connected = f.connect();
    const rejected = expect(connected).rejects.toThrow('ssh_connection_failed');
    await vi.waitFor(() => expect(driver.open).toHaveBeenCalledOnce());
    f.controller.abort();
    opening.resolve(f.shell);
    await rejected;
    expect(f.shell.destroyed).toBe(true);
    expect(driver.dispose).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.onClose).toHaveBeenCalledOnce();
  });

  it('rejects a failed pin without opening a shell or losing the cause', async () => {
    const f = fixture();
    const cause = Object.assign(new Error('host key rejected'), { code: 'EHOSTKEY' });
    driver.connect.mockRejectedValue(cause);
    await expect(f.connect()).rejects.toMatchObject({ message: 'ssh_host_key_mismatch', cause });
    expect(driver.open).not.toHaveBeenCalled();
    expect(driver.dispose).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('rejects an already cancelled session before authentication', async () => {
    const f = fixture();
    f.controller.abort();
    await expect(f.connect()).rejects.toThrow('SSH session cancelled');
    expect(driver.connect).not.toHaveBeenCalled();
    expect(driver.open).not.toHaveBeenCalled();
  });
});
