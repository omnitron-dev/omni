import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SecretsLayer } from '../../../src/secrets/secrets-layer.js';
import { LocalSecretsProvider } from '../../../src/secrets/providers/local.js';
import { EnvSecretsProvider } from '../../../src/secrets/providers/env.js';

describe('SecretsLayer', () => {
  const testDir = path.join(process.cwd(), 'test-data', 'secrets');
  const storagePath = path.join(testDir, 'test-secrets.json');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  describe('with LocalSecretsProvider', () => {
    it('should set and get secrets', async () => {
      const provider = new LocalSecretsProvider({
        storagePath,
        password: 'test-password'
      });

      await provider.initialize();
      const layer = new SecretsLayer(provider);

      await layer.set('api.key', 'secret-value');
      const value = await layer.get('api.key');

      expect(value).toBe('secret-value');
    });

    it('should check if secret exists', async () => {
      const provider = new LocalSecretsProvider({
        storagePath,
        password: 'test-password'
      });

      await provider.initialize();
      const layer = new SecretsLayer(provider);

      await layer.set('test.secret', 'value');

      expect(await layer.has('test.secret')).toBe(true);
      expect(await layer.has('nonexistent')).toBe(false);
    });

    it('should delete secrets', async () => {
      const provider = new LocalSecretsProvider({
        storagePath,
        password: 'test-password'
      });

      await provider.initialize();
      const layer = new SecretsLayer(provider);

      await layer.set('temp.secret', 'value');
      expect(await layer.has('temp.secret')).toBe(true);

      await layer.delete('temp.secret');
      expect(await layer.has('temp.secret')).toBe(false);
    });

    it('should get and set all secrets', async () => {
      const provider = new LocalSecretsProvider({
        storagePath,
        password: 'test-password'
      });

      await provider.initialize();
      const layer = new SecretsLayer(provider);

      const secrets = {
        'secret1': 'value1',
        'secret2': 'value2',
        'secret3': 'value3'
      };

      await layer.setAll(secrets);
      const retrieved = await layer.getAll();

      expect(retrieved).toEqual(secrets);
    });

    it('should interpolate secret references', async () => {
      const provider = new LocalSecretsProvider({
        storagePath,
        password: 'test-password'
      });

      await provider.initialize();
      const layer = new SecretsLayer(provider);

      await layer.set('db.password', 'super-secret');

      const template = 'postgresql://user:${secret:db.password}@localhost/db';
      const result = await layer.interpolate(template);

      expect(result).toBe('postgresql://user:super-secret@localhost/db');
    });

    it('should persist secrets encrypted', async () => {
      const provider = new LocalSecretsProvider({
        storagePath,
        password: 'test-password'
      });

      await provider.initialize();
      const layer = new SecretsLayer(provider);

      await layer.set('test.key', 'sensitive-data');

      // Create new provider to read from disk
      const provider2 = new LocalSecretsProvider({
        storagePath,
        password: 'test-password'
      });

      await provider2.initialize();
      const layer2 = new SecretsLayer(provider2);

      const value = await layer2.get('test.key');
      expect(value).toBe('sensitive-data');
    });
  });

  describe('with EnvSecretsProvider', () => {
    it('should get secrets from environment variables', async () => {
      process.env.SECRET_TEST_KEY = 'env-value';

      const provider = new EnvSecretsProvider({ prefix: 'SECRET_' });
      await provider.initialize();
      const layer = new SecretsLayer(provider);

      const value = await layer.get('test.key');
      expect(value).toBe('env-value');

      delete process.env.SECRET_TEST_KEY;
    });

    it('should set and get environment variables', async () => {
      const provider = new EnvSecretsProvider({ prefix: 'SECRET_' });
      await provider.initialize();
      const layer = new SecretsLayer(provider);

      await layer.set('temp.var', 'temp-value');
      const value = await layer.get('temp.var');

      expect(value).toBe('temp-value');
      expect(process.env.SECRET_TEMP_VAR).toBe('temp-value');

      delete process.env.SECRET_TEMP_VAR;
    });
  });

  describe('access logging', () => {
    it('should log secret access', async () => {
      const provider = new LocalSecretsProvider({
        storagePath,
        password: 'test-password'
      });

      await provider.initialize();
      const layer = new SecretsLayer(provider);

      await layer.set('logged.secret', 'value');
      await layer.get('logged.secret');

      const logs = await layer.getAccessLog('logged.secret');

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some(log => log.action === 'write')).toBe(true);
      expect(logs.some(log => log.action === 'read')).toBe(true);
    });
  });
});
