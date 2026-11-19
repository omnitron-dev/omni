import os from 'node:os';
import path from 'node:path';
import { access, realpath, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { log } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import {
  STUDIO_PROVIDERS,
  type IOmnitronStudioService,
  type StudioProvider,
  type StudioTask,
} from '../shared/dto/studio.js';
import { runStudioTurn, studioCatalog } from '../studio/adapters.js';

async function executable(provider: StudioProvider, explicit?: string): Promise<string> {
  const candidates = explicit
    ? [explicit]
    : (process.env['PATH'] ?? '')
        .split(path.delimiter)
        .filter((dir) => path.isAbsolute(dir) && !dir.split(path.sep).includes('node_modules'))
        .map((dir) => path.join(dir, process.platform === 'win32' ? provider + '.exe' : provider));
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) throw Error('--binary requires an absolute path');
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      /* Try the next installed executable on PATH. */
    }
  }
  throw Error('Provider executable unavailable. Select the installed CLI with --binary.');
}

export async function handleStudioTask(
  svc: IOmnitronStudioService,
  connection: string,
  provider: StudioProvider,
  binary: string,
  scratch: string,
  task: StudioTask,
  signal: AbortSignal
) {
  const stop = new AbortController();
  const combined = AbortSignal.any([stop.signal, signal]);
  let text = '';
  let sent = '';
  let renewalFailed = false;
  const monitor = (async () => {
    while (!combined.aborted) {
      await delay(900, undefined, { signal: combined });
      const sample = text;
      const { active } = await svc.heartbeat({
        connection,
        turnId: task.turnId,
        ...(sample !== sent && { preview: sample }),
      });
      if (!active) {
        stop.abort();
        return;
      }
      sent = sample;
    }
  })().catch(() => {
    if (!combined.aborted) renewalFailed = true;
    stop.abort();
  });
  try {
    const result = await runStudioTurn(provider, binary, scratch, task, combined, (value) => {
      text = value;
    });
    if (!combined.aborted) await svc.finishTurn({ connection, turnId: task.turnId, result });
  } finally {
    stop.abort();
    await monitor;
  }
  if (renewalFailed)
    throw Error('The daemon could not confirm the current turn. Reconnect and inspect the recorded outcome.');
}

export async function connectStudio(
  project: string | undefined,
  options: { planning?: boolean; account: string; provider: StudioProvider; binary?: string; modelPolicy?: string }
): Promise<void> {
  if (process.getuid?.() === 0)
    throw Error('Run the connector as the local account that owns the provider subscription');
  if (!STUDIO_PROVIDERS.includes(options.provider)) throw Error('Choose codex or agy');
  const binary = await executable(options.provider, options.binary);
  if (Boolean(project) === Boolean(options.planning)) throw Error('Select a registered project or use --planning');
  const directory = options.planning ? null : await realpath(process.cwd());
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'omnitron-studio-'));
  const client = createDaemonClient();
  const stop = new AbortController();
  const interrupt = () => stop.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let close: (() => Promise<void>) | undefined;
  try {
    const catalog = await studioCatalog(options.provider, binary, scratch, options.modelPolicy);
    const svc = await client.service<IOmnitronStudioService>('OmnitronStudio');
    if (stop.signal.aborted) return;
    const { connection } = await svc.connectAdapter({
      project: project ?? null,
      account: options.account,
      catalog,
      directory,
    });
    close = () => svc.disconnectAdapter({ connection });
    log.info(
      `${options.provider} connected to ${project ?? 'project planning'} · ${catalog.models.length} models. Press Ctrl+C to disconnect.`
    );
    while (!stop.signal.aborted) {
      const task = await svc.nextTurn({ connection });
      if (task) await handleStudioTask(svc, connection, options.provider, binary, scratch, task, stop.signal);
      else await delay(1200, undefined, { signal: stop.signal });
    }
  } catch (error) {
    if (!stop.signal.aborted) throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    try {
      await close?.();
    } finally {
      await client.disconnect();
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
