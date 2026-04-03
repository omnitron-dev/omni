/**
 * Classic Launcher — Fork existing main.ts as a child process
 *
 * Uses Node's child_process.fork() to spawn the app. The app manages its own
 * lifecycle; the daemon only monitors, restarts, and collects metrics.
 *
 * Readiness detection:
 * 1. IPC message { type: 'ready' } from child (preferred)
 * 2. HTTP health probe on configured port
 * 3. Timeout fallback (assumes ready after N seconds)
 */

import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { IEcosystemAppEntry } from '../config/types.js';
import type { AppHandle } from './app-handle.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
const READY_TIMEOUT = 30_000;

export async function launchClassic(
  entry: IEcosystemAppEntry,
  handle: AppHandle,
  cwd: string,
  logger: ILogger,
  logHandlers: Array<(appName: string, line: string) => void> = []
): Promise<ChildProcess> {
  let scriptPath = path.resolve(cwd, entry.script!);

  // If the script is TypeScript, compile it via esbuild instead of using tsx
  if (scriptPath.endsWith('.ts')) {
    try {
      const { compileTypeScript } = await import('./ts-compiler.js');
      const result = await compileTypeScript(scriptPath);
      scriptPath = result.outputPath;
    } catch {
      // Fall back to tsx if esbuild is not available
      logger.warn({ app: entry.name }, 'esbuild not available for classic script — falling back to tsx');
    }
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...entry.env,
    OMNITRON_MANAGED: '1',
    OMNITRON_APP_NAME: entry.name,
  };

  handle.markStarting();

  const child = fork(scriptPath, [], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    // No tsx execArgv — script is either pre-compiled .js or bundled via esbuild
    ...(scriptPath.endsWith('.ts') ? { execArgv: ['--import', 'tsx/esm'] } : {}),
  });

  handle.childProcess = child;
  handle.pid = child.pid ?? null;

  // Capture stdout/stderr → ring buffer + optional log handlers (disk persistence)
  const captureOutput = (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      handle.appendLog(line);
      // Persist to disk via registered log handlers (LogManager)
      for (const handler of logHandlers) {
        try {
          handler(entry.name, line);
        } catch {
          /* must not break the app */
        }
      }
    }
  };

  child.stdout?.on('data', captureOutput);
  child.stderr?.on('data', captureOutput);

  // Wait for readiness
  await waitForReady(child, handle, logger);

  return child;
}

function waitForReady(child: ChildProcess, handle: AppHandle, logger: ILogger): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Assume ready on timeout
      logger.warn({ app: handle.name }, 'No ready signal received, assuming ready after timeout');
      handle.markOnline(child.pid ?? 0);
      resolve();
    }, READY_TIMEOUT);

    const onMessage = (msg: any) => {
      if (settled) return;
      if (msg && (msg.type === 'ready' || msg === 'ready')) {
        settled = true;
        clearTimeout(timeout);
        handle.markOnline(child.pid ?? 0);
        logger.info({ app: handle.name, pid: child.pid }, 'App ready (IPC signal)');
        resolve();
      }
    };

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      handle.markErrored();
      reject(new Error(`App '${handle.name}' exited during startup with code ${code}`));
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      handle.markErrored();
      reject(err);
    };

    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}
