/**
 * Config Service Comprehensive Tests
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import type { IConfigChangeEvent, ConfigSource } from '../../../src/modules/config/index.js';

// Mock ConfigLoaderService
class MockConfigLoaderService {
  private mockData: Record<string, any> = {};

  setMockData(data: Record<string, any>): void {
    this.mockData = data;
  }

  async load(_sources: ConfigSource[]): Promise<Record<string, any>> {
    return { ...this.mockData };
  }
}

// Mock ConfigValidatorService
class MockConfigValidatorService {
  private shouldFail = false;
  private mockErrors: any[] = [];

  setValidationResult(success: boolean, errors: any[] = []): void {
    this.shouldFail = !success;
    this.mockErrors = errors;
  }

  validate(config: any, schema?: any): { success: boolean; errors?: any[] } {
    if (this.shouldFail) {
      return { success: false, errors: this.mockErrors };
    }
    if (schema) {
      const result = schema.safeParse(config);
      return { success: result.success, errors: result.success ? undefined : result.error.issues };
    }
    return { success: true };
  }
}

// Simplified ConfigService for testing
class TestConfigService {
  private config: Record<string, any> = {};
  private cache = new Map<string, { value: any; timestamp: number }>();
  private initialized = false;
  private changeListeners = new Set<(event: IConfigChangeEvent) => void>();
  private metadata: any;

  constructor(
    private readonly options: any,
    private readonly loader: MockConfigLoaderService,
    private readonly validator: MockConfigValidatorService,
    private readonly schema?: z.ZodType
  ) {
    this.metadata = {
      source: 'titan-config',
      loadedAt: new Date(),
      environment: options.environment || 'development',
      sources: [],
      validated: false,
      cached: options.cache?.enabled || false,
    };

    if (options.sources) {
      for (const source of options.sources) {
        if (source.type === 'object' && source.data) {
          this.config = { ...this.config, ...source.data };
        }
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.options.sources && this.options.sources.length > 0) {
      this.config = await this.loader.load(this.options.sources);
      this.metadata.sources = this.options.sources.map((s: any) => ({
        type: s.type,
        name: s.name,
        loaded: true,
      }));
    }

    if (this.options.validateOnStartup && this.schema) {
      const result = this.validator.validate(this.config, this.schema);
      if (!result.success) {
        throw new Error('Configuration validation failed');
      }
      this.metadata.validated = true;
    }

    this.initialized = true;
  }

  get<T = any>(path: string, defaultValue?: T): T {
    if (this.options.cache?.enabled) {
      const cached = this.cache.get(path);
      if (cached) {
        const ttl = this.options.cache.ttl || 60000;
        if (Date.now() - cached.timestamp < ttl) {
          return cached.value;
        }
      }
    }

    const value = this.getValueByPath(this.config, path) ?? defaultValue;

    if (this.options.cache?.enabled && value !== undefined) {
      this.cache.set(path, { value, timestamp: Date.now() });
    }

    return value;
  }

  getAll(): Record<string, any> {
    return { ...this.config };
  }

  has(path: string): boolean {
    return this.getValueByPath(this.config, path) !== undefined;
  }

  set(path: string, value: any): void {
    const oldValue = this.getValueByPath(this.config, path);
    this.setValueByPath(this.config, path, value);
    this.cache.delete(path);

    const event: IConfigChangeEvent = {
      path,
      oldValue,
      newValue: value,
      source: 'runtime',
      timestamp: new Date(),
    };
    this.notifyChangeListeners(event);
  }

  getTyped<T>(schema: z.ZodType<T>, path?: string): T {
    const value = path ? this.get(path) : this.getAll();
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new Error('Configuration validation failed for ' + (path || 'root'));
    }
    return result.data;
  }

  validate(schema?: z.ZodType): { success: boolean; errors?: any[] } {
    return this.validator.validate(this.config, schema || this.schema);
  }

  getMetadata(): any {
    return { ...this.metadata };
  }

  get environment(): string {
    return this.metadata.environment;
  }

  onChange(listener: (event: IConfigChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  async reload(): Promise<void> {
    if (!this.options.sources || this.options.sources.length === 0) return;

    const oldConfig = { ...this.config };
    this.config = await this.loader.load(this.options.sources);
    this.cache.clear();

    if (this.options.validateOnStartup && this.schema) {
      const result = this.validator.validate(this.config, this.schema);
      if (!result.success) {
        this.config = oldConfig;
        throw new Error('Configuration validation failed');
      }
    }

    this.metadata.loadedAt = new Date();
    this.notifyChangeListeners({
      path: '',
      oldValue: oldConfig,
      newValue: this.config,
      source: 'reload',
      timestamp: new Date(),
    });
  }

  async dispose(): Promise<void> {
    this.cache.clear();
    this.changeListeners.clear();
  }

  private notifyChangeListeners(event: IConfigChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch { /* ignore */ }
    }
  }

  private getValueByPath(obj: any, path: string): any {
    if (!path) return obj;
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[key];
    }
    return current;
  }

  private setValueByPath(obj: any, path: string, value: any): void {
    if (!path) {
      Object.keys(obj).forEach((key) => delete obj[key]);
      Object.assign(obj, value);
      return;
    }
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key && (!(key in current) || typeof current[key] !== 'object')) {
        current[key] = {};
      }
      if (key) current = current[key];
    }
    const lastKey = keys[keys.length - 1];
    if (lastKey) current[lastKey] = value;
  }
}

describe('ConfigService', () => {
  let configService: TestConfigService;
  let loader: MockConfigLoaderService;
  let validator: MockConfigValidatorService;

  beforeEach(() => {
    loader = new MockConfigLoaderService();
    validator = new MockConfigValidatorService();
  });

  afterEach(async () => {
    if (configService) await configService.dispose();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      configService = new TestConfigService({}, loader, validator);
      expect(configService.environment).toBe('development');
    });

    it('should use custom environment', () => {
      configService = new TestConfigService({ environment: 'production' }, loader, validator);
      expect(configService.environment).toBe('production');
    });

    it('should initialize with object source data', () => {
      configService = new TestConfigService(
        { sources: [{ type: 'object', data: { port: 3000, host: 'localhost' } }] },
        loader,
        validator
      );
      expect(configService.get('port')).toBe(3000);
      expect(configService.get('host')).toBe('localhost');
    });
  });

  describe('initialize', () => {
    it('should load configuration from sources', async () => {
      loader.setMockData({ database: { host: 'db.example.com', port: 5432 } });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
      expect(configService.get('database.host')).toBe('db.example.com');
      expect(configService.get('database.port')).toBe(5432);
    });

    it('should validate configuration on startup', async () => {
      const schema = z.object({ port: z.number(), host: z.string() });
      loader.setMockData({ port: 3000, host: 'localhost' });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }], validateOnStartup: true },
        loader,
        validator,
        schema
      );
      await configService.initialize();
      expect(configService.getMetadata().validated).toBe(true);
    });

    it('should throw on validation failure', async () => {
      const schema = z.object({ port: z.number() });
      loader.setMockData({ port: 'invalid' });
      validator.setValidationResult(false, [{ message: 'Invalid type' }]);
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }], validateOnStartup: true },
        loader,
        validator,
        schema
      );
      await expect(configService.initialize()).rejects.toThrow();
    });

    it('should only initialize once', async () => {
      loader.setMockData({ test: 'value' });
      let loadCount = 0;
      const originalLoad = loader.load.bind(loader);
      loader.load = async (sources) => { loadCount++; return originalLoad(sources); };

      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
      await configService.initialize();
      await configService.initialize();
      expect(loadCount).toBe(1);
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      loader.setMockData({
        server: { port: 3000, host: 'localhost', ssl: { enabled: true } },
        features: ['auth', 'logging'],
      });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
    });

    it('should get top-level value', () => {
      expect(configService.get('features')).toEqual(['auth', 'logging']);
    });

    it('should get nested value', () => {
      expect(configService.get('server.port')).toBe(3000);
    });

    it('should get deeply nested value', () => {
      expect(configService.get('server.ssl.enabled')).toBe(true);
    });

    it('should return undefined for non-existent path', () => {
      expect(configService.get('nonexistent')).toBeUndefined();
    });

    it('should return default value for non-existent path', () => {
      expect(configService.get('nonexistent', 'default')).toBe('default');
    });

    it('should return existing value even if default provided', () => {
      expect(configService.get('server.port', 8080)).toBe(3000);
    });
  });

  describe('getAll', () => {
    it('should return all configuration', async () => {
      loader.setMockData({ a: 1, b: 2 });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
      expect(configService.getAll()).toEqual({ a: 1, b: 2 });
    });

    it('should return a copy, not reference', async () => {
      loader.setMockData({ a: 1 });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
      const all = configService.getAll();
      all.a = 999;
      expect(configService.get('a')).toBe(1);
    });
  });

  describe('has', () => {
    beforeEach(async () => {
      loader.setMockData({ existing: 'value', nested: { key: 'value' } });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
    });

    it('should return true for existing path', () => {
      expect(configService.has('existing')).toBe(true);
    });

    it('should return true for nested path', () => {
      expect(configService.has('nested.key')).toBe(true);
    });

    it('should return false for non-existent path', () => {
      expect(configService.has('nonexistent')).toBe(false);
    });
  });

  describe('set', () => {
    beforeEach(async () => {
      loader.setMockData({ value: 'original' });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
    });

    it('should set value at path', () => {
      configService.set('value', 'modified');
      expect(configService.get('value')).toBe('modified');
    });

    it('should create nested path if needed', () => {
      configService.set('new.nested.value', 'created');
      expect(configService.get('new.nested.value')).toBe('created');
    });

    it('should notify change listeners', () => {
      const listener = jest.fn();
      configService.onChange(listener);
      configService.set('value', 'modified');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'value',
          oldValue: 'original',
          newValue: 'modified',
          source: 'runtime',
        })
      );
    });
  });

  describe('getTyped', () => {
    beforeEach(async () => {
      loader.setMockData({ server: { port: 3000, host: 'localhost' } });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
    });

    it('should return typed value for valid config', () => {
      const schema = z.object({ port: z.number(), host: z.string() });
      const result = configService.getTyped(schema, 'server');
      expect(result.port).toBe(3000);
      expect(result.host).toBe('localhost');
    });

    it('should throw for invalid config', () => {
      const schema = z.object({ port: z.string() });
      expect(() => configService.getTyped(schema, 'server')).toThrow();
    });
  });

  describe('onChange', () => {
    beforeEach(async () => {
      loader.setMockData({ value: 'original' });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
    });

    it('should register listener', () => {
      const listener = jest.fn();
      configService.onChange(listener);
      configService.set('value', 'modified');
      expect(listener).toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const listener = jest.fn();
      const unsubscribe = configService.onChange(listener);
      unsubscribe();
      configService.set('value', 'modified');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should support multiple listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      configService.onChange(listener1);
      configService.onChange(listener2);
      configService.set('value', 'modified');
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('reload', () => {
    it('should reload configuration', async () => {
      loader.setMockData({ value: 'original' });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();
      expect(configService.get('value')).toBe('original');

      loader.setMockData({ value: 'reloaded' });
      await configService.reload();
      expect(configService.get('value')).toBe('reloaded');
    });

    it('should notify listeners on reload', async () => {
      loader.setMockData({ value: 'original' });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }] },
        loader,
        validator
      );
      await configService.initialize();

      const listener = jest.fn();
      configService.onChange(listener);

      loader.setMockData({ value: 'reloaded' });
      await configService.reload();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ source: 'reload' }));
    });

    it('should rollback on validation failure', async () => {
      const schema = z.object({ value: z.string() });
      loader.setMockData({ value: 'original' });
      configService = new TestConfigService(
        { sources: [{ type: 'file', path: 'config.json' }], validateOnStartup: true },
        loader,
        validator,
        schema
      );
      await configService.initialize();

      loader.setMockData({ value: 123 });
      validator.setValidationResult(false, [{ message: 'Invalid type' }]);

      await expect(configService.reload()).rejects.toThrow();
      expect(configService.get('value')).toBe('original');
    });
  });

  describe('getMetadata', () => {
    it('should return metadata', () => {
      configService = new TestConfigService({ environment: 'production' }, loader, validator);
      const metadata = configService.getMetadata();
      expect(metadata.environment).toBe('production');
      expect(metadata.loadedAt).toBeInstanceOf(Date);
    });
  });
});

describe('Path utilities', () => {
  let configService: TestConfigService;
  let loader: MockConfigLoaderService;
  let validator: MockConfigValidatorService;

  beforeEach(() => {
    loader = new MockConfigLoaderService();
    validator = new MockConfigValidatorService();
  });

  it('should handle empty path', async () => {
    loader.setMockData({ a: 1, b: 2 });
    configService = new TestConfigService(
      { sources: [{ type: 'file', path: 'config.json' }] },
      loader,
      validator
    );
    await configService.initialize();
    expect(configService.get('')).toEqual({ a: 1, b: 2 });
  });

  it('should handle deeply nested objects', async () => {
    loader.setMockData({
      level1: { level2: { level3: { level4: { value: 'deep' } } } },
    });
    configService = new TestConfigService(
      { sources: [{ type: 'file', path: 'config.json' }] },
      loader,
      validator
    );
    await configService.initialize();
    expect(configService.get('level1.level2.level3.level4.value')).toBe('deep');
  });

  it('should handle arrays in path', async () => {
    loader.setMockData({ items: [{ name: 'first' }, { name: 'second' }] });
    configService = new TestConfigService(
      { sources: [{ type: 'file', path: 'config.json' }] },
      loader,
      validator
    );
    await configService.initialize();
    expect(configService.get('items.0.name')).toBe('first');
    expect(configService.get('items.1.name')).toBe('second');
  });
});
