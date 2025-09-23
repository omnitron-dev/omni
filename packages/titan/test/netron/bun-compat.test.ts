/**
 * Bun compatibility test
 * This test verifies that the package works correctly with Bun runtime
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

// @ts-ignore - Bun global may not be available in Node
const isBun = typeof Bun !== 'undefined';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Bun Compatibility', () => {
  it('should import the package correctly', async () => {
    const netron = await import('@omnitron-dev/netron');
    expect(netron).toBeDefined();
    expect(netron.Netron).toBeDefined();
    expect(netron.Packet).toBeDefined();
  });

  it('should import ESM module correctly', async () => {
    // Skip ESM import test in Jest (Node) - it requires additional configuration
    // This test will work correctly when running with Bun
    if (isBun) {
      const netronESM = await import('../src/index.js');
      expect(netronESM).toBeDefined();
      expect(netronESM.Netron).toBeDefined();
      expect(netronESM.Packet).toBeDefined();
    } else {
      // For Node/Jest, just verify the ESM files exist
      const esmPath = path.join(__dirname, '../src/index.ts');
      expect(fs.existsSync(esmPath)).toBe(true);
    }
  });

  it('should detect runtime correctly', () => {
    if (isBun) {
      // @ts-ignore
      expect(Bun.version).toBeDefined();
      console.log('Running in Bun runtime, version:', Bun.version);
    } else {
      expect(process.version).toBeDefined();
      console.log('Running in Node runtime, version:', process.version);
    }
  });

  it('should handle WebSocket correctly', () => {
    expect(WebSocket).toBeDefined();
    expect(WebSocket.WebSocket || WebSocket).toBeDefined();
  });

  it('should handle Buffer operations', () => {
    const buffer = Buffer.from('test');
    expect(buffer).toBeDefined();
    expect(buffer.toString()).toBe('test');
  });

  it('should handle async operations', async () => {
    const promise = new Promise((resolve) => {
      setTimeout(() => resolve('done'), 10);
    });
    const result = await promise;
    expect(result).toBe('done');
  });
});