import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadEcosystemConfig, loadEcosystemConfigSafe } from '../../src/config/loader.js';

describe('ConfigLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadEcosystemConfig', () => {
    it('loads omnitron.config.ts', async () => {
      const configContent = `
        export default {
          apps: [{ name: 'main', bootstrap: './apps/main/src/bootstrap.ts' }],
          supervision: { strategy: 'one_for_one', maxRestarts: 5, window: 60000, backoff: {} },
          monitoring: { healthCheck: { interval: 15000, timeout: 5000 }, metrics: { interval: 5000, retention: 3600 } },
          logging: { directory: '/tmp/logs', maxSize: '50mb', maxFiles: 10, compress: true, format: 'json' },
          daemon: { port: 9700, host: '127.0.0.1', pidFile: '/tmp/daemon.pid', stateFile: '/tmp/state.json' },
          env: 'test',
        };
      `;
      fs.writeFileSync(path.join(tmpDir, 'omnitron.config.ts'), configContent);

      const config = await loadEcosystemConfig(tmpDir);
      expect(config.apps).toHaveLength(1);
      expect(config.apps[0]!.name).toBe('main');
    });

    it('loads omnitron.config.js', async () => {
      const configContent = `
        module.exports = {
          apps: [{ name: 'test', script: './main.js' }],
          supervision: { strategy: 'one_for_one', maxRestarts: 5, window: 60000, backoff: {} },
          monitoring: { healthCheck: { interval: 15000, timeout: 5000 }, metrics: { interval: 5000, retention: 3600 } },
          logging: { directory: '/tmp/logs', maxSize: '50mb', maxFiles: 10, compress: true, format: 'json' },
          daemon: { port: 9700, host: '127.0.0.1', pidFile: '/tmp/daemon.pid', stateFile: '/tmp/state.json' },
          env: 'test',
        };
      `;
      fs.writeFileSync(path.join(tmpDir, 'omnitron.config.js'), configContent);

      const config = await loadEcosystemConfig(tmpDir);
      expect(config.apps[0]!.name).toBe('test');
    });

    it('throws when no config file found', async () => {
      await expect(loadEcosystemConfig(tmpDir)).rejects.toThrow('No omnitron config found');
    });

    it('throws for invalid config without apps array', async () => {
      fs.writeFileSync(path.join(tmpDir, 'omnitron.config.js'), 'module.exports = { notApps: true };');
      await expect(loadEcosystemConfig(tmpDir)).rejects.toThrow("'apps' must be an array");
    });

    it('throws for app entry missing name', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'omnitron.config.js'),
        'module.exports = { apps: [{ bootstrap: "./test" }] };'
      );
      await expect(loadEcosystemConfig(tmpDir)).rejects.toThrow("missing 'name'");
    });

    it('throws for app entry missing both bootstrap and script', async () => {
      fs.writeFileSync(path.join(tmpDir, 'omnitron.config.js'), 'module.exports = { apps: [{ name: "test" }] };');
      await expect(loadEcosystemConfig(tmpDir)).rejects.toThrow("must have either 'bootstrap' or 'script'");
    });
  });

  describe('loadEcosystemConfigSafe', () => {
    it('returns null when no config found', async () => {
      const result = await loadEcosystemConfigSafe(tmpDir);
      expect(result).toBeNull();
    });

    it('returns config when valid', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'omnitron.config.js'),
        `module.exports = {
          apps: [{ name: 'test', script: './test.js' }],
          supervision: { strategy: 'one_for_one', maxRestarts: 5, window: 60000, backoff: {} },
          monitoring: { healthCheck: { interval: 15000, timeout: 5000 }, metrics: { interval: 5000, retention: 3600 } },
          logging: { directory: '/tmp/logs', maxSize: '50mb', maxFiles: 10, compress: true, format: 'json' },
          daemon: { port: 9700, host: '127.0.0.1', pidFile: '/tmp/daemon.pid', stateFile: '/tmp/state.json' },
          env: 'test',
        };`
      );
      const result = await loadEcosystemConfigSafe(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.apps[0]!.name).toBe('test');
    });
  });
});
