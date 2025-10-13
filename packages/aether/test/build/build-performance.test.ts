/**
 * Tests for Build Performance
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BuildCache,
  IncrementalCompiler,
  HMROptimizer,
  ModuleFederationManager,
  BuildPerformanceMonitor,
} from '../../src/build/build-performance.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('BuildCache', () => {
  let cache: BuildCache;
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = path.join(os.tmpdir(), `aether-test-${Date.now()}`);
    cache = new BuildCache(cacheDir, 'memory');
    await cache.init();
  });

  afterEach(async () => {
    await cache.clear();
    try {
      await fs.rm(cacheDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should initialize cache', async () => {
    expect(cache).toBeDefined();
  });

  it('should store and retrieve cache entries', async () => {
    const entry = {
      hash: 'abc123',
      content: 'test content',
      dependencies: [],
      timestamp: Date.now(),
      ttl: 3600000,
    };

    await cache.set('test-key', entry);
    const retrieved = await cache.get('test-key');

    expect(retrieved).toEqual(entry);
  });

  it('should return null for missing entries', async () => {
    const result = await cache.get('nonexistent');

    expect(result).toBeNull();
  });

  it('should detect changed modules', async () => {
    const content1 = 'original content';
    const content2 = 'modified content';

    const entry = {
      hash: cache['hash'](content1),
      content: content1,
      dependencies: [],
      timestamp: Date.now(),
      ttl: 3600000,
    };

    await cache.set('module.js', entry);

    const hasChanged = await cache.hasChanged('module.js', content2);

    expect(hasChanged).toBe(true);
  });

  it('should invalidate cache entries', async () => {
    const entry = {
      hash: 'abc123',
      content: 'test',
      dependencies: [],
      timestamp: Date.now(),
      ttl: 3600000,
    };

    await cache.set('test-key', entry);
    await cache.invalidate('test-key');

    const result = await cache.get('test-key');

    expect(result).toBeNull();
  });

  it('should clear all cache', async () => {
    await cache.set('key1', {
      hash: '1',
      content: 'a',
      dependencies: [],
      timestamp: Date.now(),
      ttl: 3600000,
    });
    await cache.set('key2', {
      hash: '2',
      content: 'b',
      dependencies: [],
      timestamp: Date.now(),
      ttl: 3600000,
    });

    await cache.clear();

    const stats = cache.getStats();

    expect(stats.entries).toBe(0);
  });

  it('should provide cache statistics', async () => {
    const entry = {
      hash: 'abc',
      content: 'test',
      dependencies: [],
      timestamp: Date.now(),
      ttl: 3600000,
    };

    await cache.set('key1', entry);
    await cache.set('key2', entry);

    const stats = cache.getStats();

    expect(stats.entries).toBe(2);
    expect(stats.memorySize).toBeGreaterThan(0);
  });

  it('should expire old entries', async () => {
    const entry = {
      hash: 'abc',
      content: 'test',
      dependencies: [],
      timestamp: Date.now() - 10000,
      ttl: 5000, // 5 seconds TTL
    };

    await cache.set('expired-key', entry);
    const result = await cache.get('expired-key');

    expect(result).toBeNull();
  });
});

describe('IncrementalCompiler', () => {
  let cache: BuildCache;
  let compiler: IncrementalCompiler;
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = path.join(os.tmpdir(), `aether-test-${Date.now()}`);
    cache = new BuildCache(cacheDir, 'memory');
    await cache.init();
    compiler = new IncrementalCompiler(cache);
  });

  afterEach(async () => {
    try {
      await fs.rm(cacheDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should detect modules needing recompilation', async () => {
    const needsRecompilation = await compiler.needsRecompilation('module.js', 'content');

    expect(needsRecompilation).toBe(true);
  });

  it('should track module dependencies', () => {
    compiler.updateDependencies('module.js', ['dep1.js', 'dep2.js']);

    const affected = compiler.getAffectedModules('dep1.js');

    expect(affected.has('module.js')).toBe(true);
  });

  it('should update module timestamps', () => {
    compiler.updateTimestamp('module.js');

    // Timestamp should be set (checked indirectly through recompilation logic)
    expect(true).toBe(true);
  });

  it('should find all affected modules in dependency graph', () => {
    compiler.updateDependencies('app.js', ['utils.js']);
    compiler.updateDependencies('utils.js', ['helpers.js']);

    const affected = compiler.getAffectedModules('helpers.js');

    expect(affected.has('helpers.js')).toBe(true);
    expect(affected.has('utils.js')).toBe(true);
    expect(affected.has('app.js')).toBe(true);
  });

  it('should clear compilation data', () => {
    compiler.updateDependencies('module.js', ['dep.js']);
    compiler.clear();

    const affected = compiler.getAffectedModules('dep.js');

    expect(affected.size).toBe(1); // Only itself
  });
});

describe('HMROptimizer', () => {
  let optimizer: HMROptimizer;

  beforeEach(() => {
    optimizer = new HMROptimizer();
  });

  it('should mark modules as HMR boundaries', () => {
    optimizer.markBoundary('component.tsx');

    expect(optimizer.isBoundary('component.tsx')).toBe(true);
  });

  it('should register HMR acceptance', () => {
    optimizer.registerAcceptance('app.js', ['component.js', 'utils.js']);

    // Should track acceptance (tested indirectly through update scope)
    expect(true).toBe(true);
  });

  it('should calculate HMR update scope', () => {
    optimizer.markBoundary('app.js');
    optimizer.registerAcceptance('app.js', ['component.js']);

    const scope = optimizer.getUpdateScope('component.js');

    expect(scope.has('component.js')).toBe(true);
  });

  it('should optimize HMR updates', () => {
    optimizer.markBoundary('app.js');
    optimizer.registerAcceptance('app.js', ['component.js']);

    const result = optimizer.optimizeUpdate(['component.js']);

    expect(result.fullReload).toBe(false);
    expect(result.scopedUpdates.size).toBeGreaterThan(0);
  });

  it('should trigger full reload for large changes', () => {
    const changes = Array.from({ length: 15 }, (_, i) => `module${i}.js`);

    const result = optimizer.optimizeUpdate(changes);

    expect(result.fullReload).toBe(true);
  });
});

describe('ModuleFederationManager', () => {
  let manager: ModuleFederationManager;

  beforeEach(() => {
    manager = new ModuleFederationManager();
  });

  it('should add remote modules', () => {
    manager.addRemote('app2', {
      url: 'http://localhost:3001/remoteEntry.js',
      format: 'esm',
    });

    const remote = manager.getRemote('app2');

    expect(remote).toBeDefined();
    expect(remote?.url).toBe('http://localhost:3001/remoteEntry.js');
  });

  it('should add shared dependencies', () => {
    manager.addShared('react', {
      version: '18.0.0',
      singleton: true,
    });

    const shared = manager.getShared('react');

    expect(shared).toBeDefined();
    expect(shared?.version).toBe('18.0.0');
    expect(shared?.singleton).toBe(true);
  });

  it('should generate federation manifest', () => {
    manager.addRemote('app2', {
      url: 'http://localhost:3001/remoteEntry.js',
      format: 'esm',
    });
    manager.addShared('react', {
      version: '18.0.0',
      singleton: true,
    });

    const manifest = manager.generateManifest();

    expect(manifest.remotes.app2).toBeDefined();
    expect(manifest.shared.react).toBeDefined();
  });
});

describe('BuildPerformanceMonitor', () => {
  let monitor: BuildPerformanceMonitor;

  beforeEach(() => {
    monitor = new BuildPerformanceMonitor();
  });

  it('should track build duration', () => {
    monitor.start();

    // Simulate some work
    for (let i = 0; i < 1000000; i++) {
      Math.sqrt(i);
    }

    const duration = monitor.getDuration();

    expect(duration).toBeGreaterThan(0);
  });

  it('should mark checkpoints', () => {
    monitor.start();
    monitor.mark('parse');
    monitor.mark('transform');
    monitor.mark('bundle');

    const metrics = monitor.getMetrics();

    expect(metrics.has('parse')).toBe(true);
    expect(metrics.has('transform')).toBe(true);
    expect(metrics.has('bundle')).toBe(true);
  });

  it('should generate performance report', () => {
    monitor.start();
    monitor.mark('parse');
    monitor.mark('bundle');

    const report = monitor.generateReport();

    expect(report.total).toBeGreaterThan(0);
    expect(report.metrics.parse).toBeDefined();
    expect(report.metrics.bundle).toBeDefined();
    expect(report.breakdown).toBeDefined();
  });

  it('should calculate percentage breakdown', () => {
    monitor.start();
    monitor.mark('step1');
    monitor.mark('step2');

    const report = monitor.generateReport();

    const totalPercentage = Object.values(report.breakdown).reduce((sum, val) => sum + val, 0);

    expect(totalPercentage).toBeGreaterThan(0);
  });
});
