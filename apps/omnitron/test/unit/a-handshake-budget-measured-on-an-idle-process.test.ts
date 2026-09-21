/**
 * A deploy failed on an SSH handshake against a node with load average 0.02.
 *
 * `omnitron fleet upgrade`, run through a daemon that was starting six
 * applications, failed with `Timed out while waiting for handshake`. The
 * node was idle, accepted a connection from the CLI seconds later, and its
 * sshd logged no refusal — so nothing was wrong at the far end.
 *
 * ssh2's `readyTimeout` defaults to 20 seconds, and a handshake is
 * arithmetic performed in JavaScript, on the same event loop the daemon uses
 * to supervise processes and reconcile containers. Twenty seconds is a
 * generous budget for an idle process and a tight one for a control plane
 * doing its job.
 *
 * The config was also written three times — `ssh`, `tunnel` and
 * `uploadFile` each built it — so a change to any of them would have reached
 * one of the three. These pin it as one thing.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ExecutionService } from '../../src/execution/execution.service.js';

const logger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => logger,
};

/** Captures the config every `engine.ssh()` call is given. */
function serviceWithSpy() {
  const configs: Array<Record<string, unknown>> = [];
  const service = new ExecutionService(logger);

  // The fake answers the one question a real node is asked here: how many
  // bytes landed. `uploadFile` refuses a short file, so a node that answers
  // nothing is a node that failed the transfer — which would make this test
  // about the refusal instead of about the dialling.
  let answer = (_cmd: string): string => '';
  const proc = (cmd: string): any => ({
    nothrow: async () => ({ stdout: answer(cmd), stderr: '', exitCode: 0 }),
    timeout: () => proc(cmd),
    env: () => proc(cmd),
  });
  const handle = {
    raw: (cmd: string[] | string) => proc(Array.isArray(cmd) ? (cmd[0] ?? '') : cmd),
    tunnel: async () => ({ localHost: '127.0.0.1', localPort: 1, close: async () => {} }),
    uploadFile: async () => {},
  };

  (service as unknown as { engine: unknown }).engine = {
    ssh: (config: Record<string, unknown>) => { configs.push(config); return handle; },
    on: () => {},
  };

  return { service, configs, answersWith: (f: (cmd: string) => string) => { answer = f; } };
}

const target = { host: '10.0.0.7', username: 'root', password: 'x' };

describe('every SSH connection this control plane opens', () => {
  it('gives the handshake a budget a busy daemon can meet', async () => {
    const { service, configs } = serviceWithSpy();

    await service.ssh(target, 'true');

    // Not 20 seconds, which is ssh2's default and was measured failing
    // against an idle node.
    expect(configs[0]!['readyTimeout']).toBe(60_000);
  });

  it('keeps a long-held tunnel alive', async () => {
    const { service, configs } = serviceWithSpy();

    await service.tunnel(target, 9700);

    // The mesh holds one of these open for hours across a link that drops
    // idle connections. Four missed probes at fifteen seconds is a minute of
    // silence before the socket is called dead — longer than any pause the
    // event loop has been measured to take.
    expect(configs[0]!['keepaliveInterval']).toBe(15_000);
    expect(configs[0]!['keepaliveCountMax']).toBe(4);
  });

  it('is the same config for a command, a tunnel, an upload and its check', async () => {
    const { service, configs, answersWith } = serviceWithSpy();
    // A real file, because `uploadFile` now reads its size: the transfer is
    // finished when the bytes are there, and the local length is half of
    // that question. The path here used to be `/tmp/a`, which existed only
    // in the sense that nothing looked.
    const local = join(mkdtempSync(join(tmpdir(), 'handshake-')), 'payload');
    writeFileSync(local, 'payload');
    answersWith((cmd) => (cmd.startsWith('wc -c') ? String(statSync(local).size) : ''));

    await service.ssh(target, 'true');
    await service.tunnel(target, 9700);
    await service.uploadFile(target, local, '/tmp/b');

    // Four, not three: the upload opens one connection to send and one to
    // ask the node how much landed. The claim is unchanged and now covers
    // the check as well — a verification that dialled differently from the
    // transfer would be measuring another host's opinion.
    expect(configs).toHaveLength(4);
    for (const c of configs.slice(1)) expect(c).toEqual(configs[0]);
  });

  it('still carries the credential the target holds', async () => {
    const { service, configs } = serviceWithSpy();

    await service.ssh({ host: 'h', username: 'u', privateKey: 'KEY', passphrase: 'PASS' }, 'true');

    expect(configs[0]).toMatchObject({ host: 'h', username: 'u', privateKey: 'KEY', passphrase: 'PASS', port: 22 });
    // A target with no password must not send an empty one: ssh2 reads that
    // as an attempt and fails the auth before trying the key.
    expect(configs[0]).not.toHaveProperty('password');
  });
});
