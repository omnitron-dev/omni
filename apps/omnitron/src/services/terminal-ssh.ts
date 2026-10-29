import type { SSHTarget } from '../execution/execution.service.js';

export interface TerminalPty {
  write(data: Buffer): Promise<void>;
  resize(cols: number, rows: number): void;
  close(): void;
}
export interface TerminalDriver {
  probe(target: Pick<SSHTarget, 'host' | 'port'>): Promise<string>;
  connect(
    target: SSHTarget,
    fingerprint: string,
    cols: number,
    rows: number,
    onData: (data: Buffer) => void,
    onClose: (reason: string, exitCode?: number) => void,
    signal: AbortSignal
  ): Promise<TerminalPty>;
}

/** A policy boundary around Xec's existing NodeSSH; no independent SSH transport. */
export class XecTerminalDriver implements TerminalDriver {
  async probe(target: Pick<SSHTarget, 'host' | 'port'>): Promise<string> {
    const { NodeSSH } = await import('@xec-sh/core/ssh');
    try {
      return await NodeSSH.probeHostKey({ host: target.host, port: target.port ?? 22 });
    } catch {
      throw new Error('SSH host key inspection failed');
    }
  }

  async connect(
    target: SSHTarget,
    fingerprint: string,
    cols: number,
    rows: number,
    onData: (data: Buffer) => void,
    onClose: (reason: string, exitCode?: number) => void,
    signal: AbortSignal
  ): Promise<TerminalPty> {
    const { NodeSSH } = await import('@xec-sh/core/ssh');
    const ssh = new NodeSSH();
    let channel: Awaited<ReturnType<typeof ssh.requestShell>> | undefined;
    let done = false,
      exitCode: number | undefined;
    const pendingWrites = new Set<(error: Error) => void>();
    const finish = (reason: string) => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', abort);
      for (const fail of pendingWrites) fail(new Error('SSH input interrupted'));
      channel?.destroy();
      ssh.dispose(true);
      onClose(reason, exitCode);
    };
    const abort = () => finish('closed_by_operator');
    if (signal.aborted) throw new Error('SSH session cancelled');
    signal.addEventListener('abort', abort, { once: true });
    try {
      await ssh.connect({
        ...target,
        username: target.username ?? 'root',
        expectedHostFingerprint: fingerprint,
        signal,
        readyTimeout: 15_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
      });
      if (done) throw new Error('SSH session cancelled');
      ssh.connection?.once('error', () => finish('ssh_connection_failed'));
      ssh.connection?.once('close', () => finish('ssh_connection_closed'));
      channel = await ssh.requestShell(
        { term: 'xterm-256color', cols, rows, width: 0, height: 0 },
        { signal, timeoutMs: 15_000 }
      );
      if (done) {
        channel.destroy();
        throw new Error('SSH session cancelled');
      }
      channel.on('data', onData);
      channel.stderr.on('data', onData);
      channel.once('exit', (code: number) => {
        if (typeof code === 'number') exitCode = code;
      });
      channel.once('close', () => finish('shell_exited'));
      channel.once('error', () => finish('ssh_channel_failed'));
      const shell = channel;
      return {
        write: (data) =>
          new Promise<void>((resolve, reject) => {
            if (done) {
              reject(new Error('SSH session is closed'));
              return;
            }
            const finishWrite = (error?: Error | null) => {
              clearTimeout(timer);
              pendingWrites.delete(finishWrite);
              if (error) reject(new Error('SSH input failed'));
              else resolve();
            };
            const timer = setTimeout(() => {
              finishWrite(new Error('Input timed out'));
              finish('input_timeout');
            }, 10_000);
            pendingWrites.add(finishWrite);
            try {
              shell.write(data, finishWrite);
            } catch {
              finishWrite(new Error('SSH input failed'));
            }
          }),
        resize: (c, r) => {
          if (!done) shell.setWindow(r, c, 0, 0);
        },
        close: () => finish('closed_by_operator'),
      };
    } catch (error) {
      const reason =
        (error as { code?: string }).code === 'EHOSTKEY' ? 'ssh_host_key_mismatch' : 'ssh_connection_failed';
      finish(reason);
      throw new Error(reason, { cause: error });
    }
  }
}
