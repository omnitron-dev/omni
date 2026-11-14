import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { BackendArtifact } from './backend-candidate.js';
import type { InstalledRuntimeCli } from './runtime-installation.js';

/** A stable launcher follows the verified selector; signals and exit status retain OS supervision semantics. */
export function runRuntimeEntry(artifact: InstalledRuntimeCli, kind: 'cli', args: string[]): Promise<void>;
export function runRuntimeEntry(artifact: BackendArtifact, kind: 'cli' | 'daemon', args: string[]): Promise<void>;
export async function runRuntimeEntry(artifact: BackendArtifact | InstalledRuntimeCli, kind: 'cli' | 'daemon', args: string[]): Promise<void> {
  if ('cliEntry' in artifact && kind !== 'cli') throw new Error('A control-client selection cannot admit a daemon start');
  const entry = 'cliEntry' in artifact ? artifact.cliEntry : kind === 'cli' ? path.join(artifact.directory, 'cli/omnitron.js') : artifact.entry;
  const argv = kind === 'daemon' ? ['--import', 'tsx/esm', entry, ...args] : [entry, ...args];
  const child = spawn(artifact.execPath, argv, {
    stdio: 'inherit',
    cwd: kind === 'daemon' && 'directory' in artifact ? path.dirname(artifact.directory) : process.cwd(),
    env: { ...process.env, ...(kind === 'daemon' ? { OMNITRON_CWD: process.env['OMNITRON_CWD'] ?? process.cwd() } : {}) },
  });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const forwarders = signals.map(signal => ({ signal, handler: () => { child.kill(signal); } }));
  for (const { signal, handler } of forwarders) process.on(signal, handler);
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    for (const { signal, handler } of forwarders) process.off(signal, handler);
    if (result.signal) process.kill(process.pid, result.signal);
    process.exitCode = result.code ?? 1;
  } finally { for (const { signal, handler } of forwarders) process.off(signal, handler); }
}

/** Explicit handoffs and preflight select their candidate themselves and must never be redirected. */
export async function forwardSelectedRuntime(kind: 'cli' | 'daemon', currentEntry: string, args: string[]): Promise<boolean> {
  const { selectedBackend } = await import('./runtime-installation.js');
  const artifact = await selectedBackend();
  if (!artifact) return false;
  const target = kind === 'cli' ? path.join(artifact.directory, 'cli/omnitron.js') : artifact.entry;
  if (await fs.realpath(currentEntry) === target && await fs.realpath(process.execPath) === artifact.execPath) return false;
  await runRuntimeEntry(artifact, kind, args);
  return true;
}
