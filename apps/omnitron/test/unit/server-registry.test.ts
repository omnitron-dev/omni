import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We need to mock OMNITRON_HOME before importing ServerRegistry
let tmpDir: string;

vi.mock('../../src/config/defaults.js', async () => {
  // tmpDir must be set before this runs
  return {
    OMNITRON_HOME: tmpDir || '/tmp/omnitron-test-fallback',
    CLI_VERSION: '0.1.0',
    DAEMON_SERVICE_ID: 'OmnitronDaemon@1.0.0',
    DEFAULT_PORTS: {},
    DEFAULT_ECOSYSTEM: {},
  };
});

describe('ServerRegistry', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-registry-'));
    // Re-mock with correct tmpDir
    vi.doMock('../../src/config/defaults.js', () => ({
      OMNITRON_HOME: tmpDir,
      CLI_VERSION: '0.1.0',
      DAEMON_SERVICE_ID: 'OmnitronDaemon@1.0.0',
      DEFAULT_PORTS: {},
      DEFAULT_ECOSYSTEM: {},
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Since ServerRegistry reads OMNITRON_HOME at import time,
  // we test its behavior using a direct instantiation approach
  it('list returns empty array when no registry file', async () => {
    const { ServerRegistry } = await import('../../src/infrastructure/server-registry.js');
    const registry = new ServerRegistry();
    // Override registryFile for test
    (registry as any).registryFile = path.join(tmpDir, 'servers.json');
    expect(registry.list()).toEqual([]);
  });

  it('add and list servers', async () => {
    const registryFile = path.join(tmpDir, 'servers.json');
    const { ServerRegistry } = await import('../../src/infrastructure/server-registry.js');
    const registry = new ServerRegistry();
    (registry as any).registryFile = registryFile;

    registry.add({ alias: 'prod-1', host: '10.0.1.1', port: 9700, tags: ['production'] });
    registry.add({ alias: 'prod-2', host: '10.0.1.2', port: 9700, tags: ['production'] });

    const servers = registry.list();
    expect(servers).toHaveLength(2);
    expect(servers[0]!.alias).toBe('prod-1');
    expect(servers[1]!.alias).toBe('prod-2');
  });

  it('add replaces existing server with same alias', async () => {
    const registryFile = path.join(tmpDir, 'servers.json');
    const { ServerRegistry } = await import('../../src/infrastructure/server-registry.js');
    const registry = new ServerRegistry();
    (registry as any).registryFile = registryFile;

    registry.add({ alias: 'prod-1', host: '10.0.1.1', port: 9700, tags: [] });
    registry.add({ alias: 'prod-1', host: '10.0.1.99', port: 9800, tags: ['updated'] });

    const servers = registry.list();
    expect(servers).toHaveLength(1);
    expect(servers[0]!.host).toBe('10.0.1.99');
    expect(servers[0]!.port).toBe(9800);
  });

  it('remove deletes server and returns true', async () => {
    const registryFile = path.join(tmpDir, 'servers.json');
    const { ServerRegistry } = await import('../../src/infrastructure/server-registry.js');
    const registry = new ServerRegistry();
    (registry as any).registryFile = registryFile;

    registry.add({ alias: 'prod-1', host: '10.0.1.1', port: 9700, tags: [] });
    expect(registry.remove('prod-1')).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it('remove returns false for unknown alias', async () => {
    const registryFile = path.join(tmpDir, 'servers.json');
    const { ServerRegistry } = await import('../../src/infrastructure/server-registry.js');
    const registry = new ServerRegistry();
    (registry as any).registryFile = registryFile;

    expect(registry.remove('nonexistent')).toBe(false);
  });

  it('get returns server by alias', async () => {
    const registryFile = path.join(tmpDir, 'servers.json');
    const { ServerRegistry } = await import('../../src/infrastructure/server-registry.js');
    const registry = new ServerRegistry();
    (registry as any).registryFile = registryFile;

    registry.add({ alias: 'staging', host: '10.0.2.1', port: 9700, tags: ['staging'] });
    const server = registry.get('staging');
    expect(server).toBeDefined();
    expect(server!.host).toBe('10.0.2.1');
  });

  it('get returns undefined for unknown alias', async () => {
    const registryFile = path.join(tmpDir, 'servers.json');
    const { ServerRegistry } = await import('../../src/infrastructure/server-registry.js');
    const registry = new ServerRegistry();
    (registry as any).registryFile = registryFile;

    expect(registry.get('unknown')).toBeUndefined();
  });
});
