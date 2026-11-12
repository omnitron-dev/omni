import { guardEntry } from './entry-guard.js';
import { writeEmergencyStderr } from '../shared/emergency-output.js';
import type { BackendPreflightProgress } from './backend-candidate.js';

const preflight = process.argv[2] === '--check-backend';
const started = performance.now();
const progress = (phase: BackendPreflightProgress['phase']): void => {
  if (!preflight) return;
  const event: BackendPreflightProgress = { event: 'omnitron.backend.preflight', protocol: 1,
    pid: process.pid, phase, elapsedMs: Math.round(performance.now() - started) };
  writeEmergencyStderr(Buffer.from(JSON.stringify(event) + '\n'));
};

await guardEntry('daemon', async () => {
  progress('loading-runtime');
  await import('./daemon-main.js');
  progress('runtime-loaded');
}, { persistFailure: !preflight });
