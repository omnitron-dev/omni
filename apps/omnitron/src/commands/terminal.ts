import { once } from 'node:events';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronNodesService, IOmnitronTerminalService } from '../shared/dto/services.js';
import { resolveNodeArgument } from './node.js';
import { emitError, emitJson, isJsonMode } from './output.js';

async function nodeId(client: ReturnType<typeof createDaemonClient>, name: string): Promise<string> {
  const nodes = await client.service<IOmnitronNodesService>('OmnitronNodes');
  const result = resolveNodeArgument(name, await nodes.listNodes());
  if (result.kind !== 'found')
    throw new Error(result.kind === 'ambiguous' ? 'Node is ambiguous; use its full ID' : 'No registered node matches');
  if (result.node.isLocal) throw new Error('Select a registered remote SSH node');
  return result.node.id;
}

export async function nodeHostKeyCommand(name: string, options: { trust?: string } = {}): Promise<void> {
  const client = createDaemonClient();
  try {
    const id = await nodeId(client, name);
    const service = await client.service<IOmnitronTerminalService>('OmnitronTerminal');
    const host = await service.inspectHost({ nodeId: id });
    if (options.trust) {
      if (options.trust !== host.observed)
        throw new Error('Provided fingerprint does not match the observed host key; trust was not changed');
      await service.trustHost({ nodeId: id, fingerprint: options.trust, previous: host.trusted });
    }
    const result = { ...host, ...(options.trust ? { trusted: options.trust } : {}) };
    if (!emitJson(result))
      process.stdout.write(
        `${host.host}:${host.port}\nObserved: ${host.observed}\nTrusted: ${result.trusted ?? '(none)'}\nVerify against an independent trusted inventory before using --trust <fingerprint>.\n`
      );
  } catch (error) {
    emitError((error as Error).message);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

export async function terminalSessionsCommand(id?: string): Promise<void> {
  const client = createDaemonClient();
  try {
    const service = await client.service<IOmnitronTerminalService>('OmnitronTerminal');
    if (id) {
      await service.close({ id });
      if (!emitJson({ closed: id })) process.stdout.write(`Closed ${id}\n`);
    } else {
      const sessions = await service.list();
      if (!emitJson({ sessions }))
        for (const s of sessions) process.stdout.write(`${s.id}  ${s.nodeName}  ${s.username}@${s.host}  ${s.state}\n`);
    }
  } catch (error) {
    emitError((error as Error).message);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

/** Uses the same owner-scoped PTY API as the webapp; no credential export to ssh(1). */
export async function nodeSshCommand(name: string): Promise<void> {
  if (isJsonMode() || !process.stdin.isTTY || !process.stdout.isTTY) {
    emitError(
      'Interactive SSH requires a TTY and does not support --json; use node ssh-key or terminal list for JSON diagnostics'
    );
    process.exitCode = 1;
    return;
  }
  const client = createDaemonClient();
  let service: IOmnitronTerminalService | undefined;
  let id: string | undefined;
  let stopped = false,
    sequence = 0,
    sending = false;
  let pending: Buffer = Buffer.alloc(0);
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const wasRaw = process.stdin.isRaw;
  const stop = () => {
    stopped = true;
    if (id) void service?.close({ id }).catch(() => undefined);
  };
  const fail = (error: unknown) => {
    process.stderr.write(`\r\n${(error as Error).message}\r\n`);
    process.exitCode = 1;
    stop();
  };
  const flush = async () => {
    if (sending || stopped || !id || !service) return;
    sending = true;
    try {
      while (pending.length && !stopped) {
        const data = pending.subarray(0, 8192);
        pending = pending.subarray(data.length);
        sequence = (await service.write({ id, sequence, data: data.toString('base64') })).nextSequence;
      }
    } catch (error) {
      fail(error);
    } finally {
      sending = false;
    }
  };
  const input = (bytes: Buffer) => {
    const data = bytes;
    if (data.includes(0x1d)) {
      stop();
      return;
    }
    if (pending.length + data.length > 32768) {
      fail(new Error('Terminal input queue exceeded 32 KiB'));
      return;
    }
    pending = Buffer.concat([pending, data]);
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => void flush(), 16);
  };
  const resize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (id && !stopped)
        void service
          ?.resize({
            id,
            cols: Math.min(500, Math.max(2, process.stdout.columns || 80)),
            rows: Math.min(500, Math.max(2, process.stdout.rows || 24)),
          })
          .catch(fail);
    }, 100);
  };
  try {
    const selected = await nodeId(client, name);
    service = await client.service<IOmnitronTerminalService>('OmnitronTerminal');
    const session = await service.open({
      nodeId: selected,
      cols: Math.min(500, Math.max(2, process.stdout.columns || 80)),
      rows: Math.min(500, Math.max(2, process.stdout.rows || 24)),
    });
    id = session.id;
    process.stderr.write(`Connected to ${session.username}@${session.host}. Ctrl+] closes this session.\r\n`);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', input);
    process.stdout.on('resize', resize);
    process.on('SIGTERM', stop);
    process.on('SIGHUP', stop);
    process.on('SIGINT', stop);
    let cursor = 0;
    while (!stopped) {
      const result = await service.read({ id, cursor });
      if (result.droppedBytes) process.stderr.write(`\r\n[${result.droppedBytes} output bytes no longer retained]\r\n`);
      if (result.data && !process.stdout.write(Buffer.from(result.data, 'base64'))) await once(process.stdout, 'drain');
      cursor = result.cursor;
      if (result.session.state === 'closed' && !result.hasMore) {
        process.stderr.write(`\r\nSSH session closed: ${result.session.reason ?? 'closed'}\r\n`);
        if (result.session.exitCode) process.exitCode = result.session.exitCode;
        break;
      }
    }
  } catch (error) {
    emitError((error as Error).message);
    process.exitCode = 1;
  } finally {
    stopped = true;
    clearTimeout(sendTimer);
    clearTimeout(resizeTimer);
    process.stdin.removeListener('data', input);
    process.stdout.removeListener('resize', resize);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGHUP', stop);
    process.removeListener('SIGINT', stop);
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    if (id) await service?.close({ id }).catch(() => undefined);
    await client.disconnect();
  }
}
