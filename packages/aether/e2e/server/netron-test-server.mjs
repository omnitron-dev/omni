/**
 * Standalone Netron Test Server for Aether E2E Tests
 * Uses tsx to run TypeScript directly
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = join(__dirname, '../fixtures/titan-app/index.ts');

console.log('[Server] Starting Netron test server...');
console.log('[Server] Server path:', serverPath);

const proc = spawn('npx', ['tsx', serverPath], {
  stdio: 'inherit',
  cwd: join(__dirname, '../..'),
  env: { ...process.env }
});

proc.on('error', (err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});

proc.on('exit', (code) => {
  console.log('[Server] Server exited with code:', code);
  process.exit(code);
});

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM, shutting down...');
  proc.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('[Server] Received SIGINT, shutting down...');
  proc.kill('SIGINT');
  process.exit(0);
});
