#!/usr/bin/env node
import { selectedControlClient } from '../daemon/runtime-installation.js';
import { runRuntimeEntry } from '../daemon/runtime-launcher.js';

try {
  // Recovery commands must remain available while ordinary cold starts are fenced.
  const args = process.argv.slice(2);
  const command = args.find(argument => !argument.startsWith('-'));
  const artifact = await selectedControlClient(undefined, command === 'backend' || command === 'runtime' ? 'management' : 'control');
  if (!artifact) throw new Error('No runtime is selected. Install and select a sealed backend before using this launcher.');
  await runRuntimeEntry(artifact, 'cli', args);
} catch (error) {
  process.stderr.write(`Omnitron runtime: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
