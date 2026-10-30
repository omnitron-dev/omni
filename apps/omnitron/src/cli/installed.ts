#!/usr/bin/env node
import { selectedBackend } from '../daemon/runtime-installation.js';
import { runRuntimeEntry } from '../daemon/runtime-launcher.js';

try {
  // Recovery commands must remain available while ordinary cold starts are fenced.
  const artifact = await selectedBackend(undefined, 'control');
  if (!artifact) throw new Error('No runtime is selected. Install and select a sealed backend before using this launcher.');
  await runRuntimeEntry(artifact, 'cli', process.argv.slice(2));
} catch (error) {
  process.stderr.write(`Omnitron runtime: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
