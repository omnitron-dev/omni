import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readdir, realpath, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { log } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import {
  STUDIO_PROVIDERS,
  type IOmnitronStudioService,
  type StudioProvider,
  type StudioTask,
  type StudioResult,
} from '../shared/dto/studio.js';
import { runStudioTurn, studioCatalog } from '../studio/adapters.js';
import { openStudioMcp, type StudioMcpEndpoint } from '../studio/team-mcp.js';

async function providerInstallation(
  provider: StudioProvider,
  scratch: string,
  explicit?: string,
  modelPolicy?: string
) {
  if (!STUDIO_PROVIDERS.includes(provider)) throw Error('Choose a Studio provider: ' + STUDIO_PROVIDERS.join(', '));
  if (explicit && !path.isAbsolute(explicit)) throw Error('--binary requires an absolute path');
  const paths = explicit
    ? [explicit]
    : (process.env['PATH'] ?? '')
        .split(path.delimiter)
        .filter((dir) => path.isAbsolute(dir) && !dir.split(path.sep).includes('node_modules'))
        .map((dir) => path.join(dir, process.platform === 'win32' ? provider + '.exe' : provider));
  if (!explicit && provider === 'codex' && process.platform === 'darwin')
    paths.push('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  const seen = new Set<string>();
  let issue: unknown;
  for (const candidate of paths) {
    let binary: string;
    try {
      await access(candidate, constants.X_OK);
      binary = await realpath(candidate);
    } catch {
      continue;
    }
    if (seen.has(binary)) continue;
    seen.add(binary);
    try {
      return { binary, catalog: await studioCatalog(provider, binary, scratch, modelPolicy) };
    } catch (error) {
      issue = error;
    }
  }
  throw issue ?? Error(provider + ' executable unavailable. Select an installed CLI with --binary.');
}

/** Status uses the same local binary, subscription and catalog checks as connect. */
export async function doctorStudio(options: { provider?: StudioProvider; binary?: string }) {
  if (options.binary && !options.provider) throw Error('Select --provider when checking an explicit binary');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'omnitron-studio-check-'));
  try {
    for (const provider of options.provider ? [options.provider] : STUDIO_PROVIDERS) {
      try {
        const { catalog } = await providerInstallation(provider, scratch, options.binary);
        log.info(
          provider +
            ' · ' +
            catalog.models.length +
            ' listed models · ' +
            (catalog.teamTools ? 'room MCP available' : 'member without tools')
        );
      } catch (error) {
        log.warn((error as Error).message);
        if (options.provider) process.exitCode = 1;
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

type StudioWorker = Pick<IOmnitronStudioService, 'heartbeat' | 'finishTurn' | 'teamTool'>;

export async function handleStudioTask(
  svc: StudioWorker,
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
  let endpoint: StudioMcpEndpoint | undefined;
  let cwd: string | undefined;
  try {
    let result: StudioResult;
    try {
      // Claude indexes native sessions by cwd. Recreate the same empty, private directory for its UUID.
      const initialSession = provider === 'claude' && !task.conversation ? randomUUID() : undefined;
      if (provider === 'claude') {
        const digest = createHash('sha256')
          .update(task.conversation ?? initialSession!)
          .digest('hex');
        const dir = path.join(os.tmpdir(), 'omnitron-studio-claude-' + digest);
        try {
          await mkdir(dir, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          // A terminated connector may have left the private cwd behind. Reject links and unexpected contents.
          const existing = await lstat(dir);
          if (
            !existing.isDirectory() ||
            (process.getuid && (existing.uid !== process.getuid() || (existing.mode & 0o077) !== 0)) ||
            (await readdir(dir)).length
          )
            throw Error('Claude session working directory is unavailable');
        }
        cwd = dir;
      } else cwd = await mkdtemp(path.join(scratch, 'turn-'));
      if (task.teamTools)
        endpoint = await openStudioMcp(combined, (name, args) =>
          svc.teamTool({ connection, turnId: task.turnId, name, arguments: args })
        );
      result = await runStudioTurn(
        provider,
        binary,
        cwd,
        task,
        combined,
        (value) => {
          text = value;
        },
        endpoint,
        initialSession
      );
    } catch {
      result = { status: 'failed', failure: 'protocol' };
    } finally {
      await endpoint?.close();
    }
    if (!combined.aborted) await svc.finishTurn({ connection, turnId: task.turnId, result });
  } finally {
    stop.abort();
    await monitor;
    if (cwd) await rm(cwd, { recursive: true, force: true });
  }
  if (renewalFailed)
    throw Error('The daemon could not confirm the current turn. Reconnect and inspect the recorded outcome.');
}

export async function serveStudioConnection(
  svc: StudioWorker & Pick<IOmnitronStudioService, 'nextTurn'>,
  connection: string,
  provider: StudioProvider,
  binary: string,
  scratch: string,
  capacity: number,
  signal: AbortSignal
) {
  const stop = new AbortController();
  const combined = AbortSignal.any([signal, stop.signal]);
  const active = new Set<Promise<void>>();
  let failure: unknown;
  try {
    while (!combined.aborted) {
      if (active.size >= capacity) {
        await Promise.race(active);
        continue;
      }
      const task = await svc.nextTurn({ connection });
      if (!task) {
        await delay(450, undefined, { signal: combined });
        continue;
      }
      const handling = handleStudioTask(svc, connection, provider, binary, scratch, task, combined)
        .catch((error: unknown) => {
          failure ??= error;
          stop.abort();
        })
        .finally(() => {
          active.delete(handling);
        });
      active.add(handling);
    }
  } catch (error) {
    if (!combined.aborted) throw error;
  } finally {
    stop.abort();
    await Promise.allSettled(active);
  }
  if (failure) throw failure;
}

export async function connectStudio(
  project: string | undefined,
  options: {
    planning?: boolean;
    account: string;
    provider: StudioProvider;
    binary?: string;
    modelPolicy?: string;
    jobs?: string;
  }
) {
  if (process.getuid?.() === 0)
    throw Error('Run the connector as the local account that owns the provider subscription');
  const capacity = Number(options.jobs ?? 1);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) throw Error('--jobs must be an integer from 1 to 8');
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
    const { binary, catalog } = await providerInstallation(
      options.provider,
      scratch,
      options.binary,
      options.modelPolicy
    );
    const svc = await client.service<IOmnitronStudioService>('OmnitronStudio');
    if (stop.signal.aborted) return;
    const { connection } = await svc.connectAdapter({
      project: project ?? null,
      account: options.account,
      catalog,
      directory,
      capacity,
    });
    close = () => svc.disconnectAdapter({ connection });
    log.info(
      options.provider +
        ' connected to ' +
        (project ?? 'project planning') +
        ' · ' +
        catalog.models.length +
        ' models · ' +
        capacity +
        ' concurrent slot(s) · ' +
        (catalog.teamTools ? 'room MCP available' : 'member without tools') +
        '. Press Ctrl+C to disconnect.'
    );
    await serveStudioConnection(svc, connection, options.provider, binary, scratch, capacity, stop.signal);
  } catch (error) {
    if (!stop.signal.aborted) throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    try {
      await close?.();
    } finally {
      try {
        await client.disconnect();
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
  }
}
