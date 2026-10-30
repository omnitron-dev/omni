import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { BackendArtifact } from './backend-candidate.js';
import { selectedBackend } from './runtime-installation.js';

/** A stable launcher follows the verified selector; signals and exit status retain OS supervision semantics. */
export async function runRuntimeEntry(artifact: BackendArtifact, kind: 'cli' | 'daemon', args: string[]): Promise<void> {
  const entry = kind === 'cli' ? path.join(artifact.directory, 'cli/omnitron.js') : artifact.entry;
  const argv = kind === 'daemon' ? ['--import', 'tsx/esm', entry, ...args] : [entry, ...args];
  const child = spawn(artifact.execPath, argv, {
    stdio: 'inherit',
    cwd: kind === 'daemon' ? path.dirname(artifact.directory) : process.cwd(),
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
  const artifact = await selectedBackend();
  if (!artifact) return false;
  const target = kind === 'cli' ? path.join(artifact.directory, 'cli/omnitron.js') : artifact.entry;
  if (await fs.realpath(currentEntry) === target && await fs.realpath(process.execPath) === artifact.execPath) return false;
  await runRuntimeEntry(artifact, kind, args);
  return true;
}
