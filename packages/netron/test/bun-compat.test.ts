/**
 * Bun compatibility test
 * This test verifies that the package works correctly with Bun runtime
 */

// @ts-ignore - Bun global may not be available in Node
const isBun = typeof Bun !== 'undefined';

describe('Bun Compatibility', () => {
  it('should import the package correctly', () => {
    const netron = require('../dist/index.js');
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
      const fs = require('fs');
      const path = require('path');
      const esmPath = path.join(__dirname, '../src/index.js');
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
    const WebSocket = require('ws');
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
