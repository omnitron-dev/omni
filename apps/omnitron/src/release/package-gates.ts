import fs from 'node:fs';
import path from 'node:path';

import type { GateOutcome } from './manifest.js';

/** Read the package scripts declared as release gates from the checked-out workspace. */
export function readPackageGates(workspace: string): string[] | undefined {
  const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
  const gates: unknown = manifest.omnitron?.release?.gates;
  if (gates === undefined) return undefined;
  if (fs.existsSync(path.join(workspace, 'scripts/gates.mjs')))
    throw Error('Choose one release gate definition: package.json omnitron.release.gates or scripts/gates.mjs');
  if (!Array.isArray(gates) || !gates.length || gates.length > 64)
    throw Error('omnitron.release.gates must list 1–64 package script names');
  const seen = new Set<string>();
  for (const name of gates) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,63}$/.test(name) || seen.has(name))
      throw Error('Release gate script names must be unique, at most 64 characters, and contain no switches, paths or whitespace');
    if (!manifest.scripts || !Object.hasOwn(manifest.scripts, name) ||
        typeof manifest.scripts[name] !== 'string' || !manifest.scripts[name].trim())
      throw Error('Release gate names an undeclared or empty package script: ' + name);
    seen.add(name);
  }
  return [...seen];
}

/** The build's step runner owns its process group, deadline, cwd and logs. */
export async function runPackageGates(
  names: readonly string[],
  run: (name: string, index: number) => Promise<{ code: number | null; timedOut: boolean }>,
  signal?: AbortSignal,
): Promise<GateOutcome[]> {
  const gates: GateOutcome[] = [];
  for (const [index, name] of names.entries()) {
    if (signal?.aborted) {
      gates.push({ name, status: 'not-run', detail: 'Build stopped before this package script ran' });
      continue;
    }
    const start = Date.now();
    const result = await run(name, index);
    const status = result.timedOut ? 'timed-out' : result.code === null || signal?.aborted ? 'killed'
      : result.code === 0 ? 'passed' : 'failed';
    const detail = result.timedOut ? 'Package script exceeded its deadline' : status === 'killed' ? 'Package script was interrupted'
      : 'pnpm run ' + name + ' exited ' + result.code;
    gates.push({ name, status, detail, durationMs: Date.now() - start });
  }
  return gates;
}
