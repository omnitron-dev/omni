/**
 * Tests for Build Profiler
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BuildProfiler, createBuildProfiler, Profile } from '../../src/build/build-profiler.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('BuildProfiler', () => {
  let profiler: BuildProfiler;
  let outputDir: string;

  beforeEach(() => {
    outputDir = path.join(os.tmpdir(), `aether-profiler-test-${Date.now()}`);
    profiler = new BuildProfiler({
      enabled: true,
      outputDir,
      format: 'json',
      open: false,
    });
  });

  afterEach(async () => {
    profiler.clear();
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Basic Operations', () => {
    it('should create profiler', () => {
      expect(profiler).toBeDefined();
    });

    it('should start profiling', () => {
      profiler.start();

      const stats = profiler.getStats();
      expect(stats.elapsedTime).toBeGreaterThanOrEqual(0);
    });

    it('should track metrics', () => {
      profiler.start();
      profiler.startMetric('test-metric');
      profiler.endMetric('test-metric');

      const stats = profiler.getStats();
      expect(stats.totalMetrics).toBe(1);
    });

    it('should track active metrics', () => {
      profiler.start();
      profiler.startMetric('active-metric');

      const stats = profiler.getStats();
      expect(stats.activeMetrics).toBe(1);

      profiler.endMetric('active-metric');

      const statsAfter = profiler.getStats();
      expect(statsAfter.activeMetrics).toBe(0);
    });
  });

  describe('Module Metrics', () => {
    it('should record module compilation', () => {
      profiler.start();
      profiler.recordModule('app.js', 100, 50, 10000, 5);

      const stats = profiler.getStats();
      expect(stats.moduleCount).toBe(1);
    });

    it('should track multiple modules', () => {
      profiler.start();
      profiler.recordModule('app.js', 100, 50, 10000, 5);
      profiler.recordModule('lib.js', 80, 40, 8000, 3);
      profiler.recordModule('utils.js', 60, 30, 6000, 2);

      const stats = profiler.getStats();
      expect(stats.moduleCount).toBe(3);
    });
  });

  describe('Plugin Metrics', () => {
    it('should record plugin execution', () => {
      profiler.start();
      profiler.recordPlugin('my-plugin', 'transform', 25);

      const stats = profiler.getStats();
      expect(stats.pluginCount).toBe(1);
    });

    it('should aggregate multiple plugin calls', () => {
      profiler.start();
      profiler.recordPlugin('my-plugin', 'transform', 25);
      profiler.recordPlugin('my-plugin', 'transform', 30);
      profiler.recordPlugin('my-plugin', 'transform', 20);

      const stats = profiler.getStats();
      // Should only count unique plugin:hook combinations
      expect(stats.pluginCount).toBe(1);
    });

    it('should track different hooks separately', () => {
      profiler.start();
      profiler.recordPlugin('my-plugin', 'transform', 25);
      profiler.recordPlugin('my-plugin', 'load', 15);

      const stats = profiler.getStats();
      expect(stats.pluginCount).toBe(2);
    });
  });

  describe('Report Generation', () => {
    beforeEach(() => {
      profiler.start();
      profiler.startMetric('parse');
      profiler.endMetric('parse');
      profiler.startMetric('transform');
      profiler.endMetric('transform');
      profiler.recordModule('app.js', 100, 50, 10000, 5);
      profiler.recordModule('lib.js', 80, 40, 8000, 3);
      profiler.recordPlugin('esbuild', 'transform', 150);
    });

    it('should generate performance report', async () => {
      const report = await profiler.generateReport();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.totalTime).toBeGreaterThan(0);
      expect(report.phases).toBeDefined();
      expect(report.modules).toBeDefined();
      expect(report.plugins).toBeDefined();
      expect(report.summary).toBeDefined();
    });

    it('should include module statistics in report', async () => {
      const report = await profiler.generateReport();

      expect(report.summary.totalModules).toBe(2);
      expect(report.summary.averageModuleTime).toBeGreaterThan(0);
      expect(report.summary.slowestModule).toBeTruthy();
      expect(report.summary.slowestModuleTime).toBeGreaterThan(0);
    });

    it('should include plugin statistics in report', async () => {
      const report = await profiler.generateReport();

      expect(report.summary.totalPluginTime).toBeGreaterThan(0);
      expect(report.plugins.length).toBe(1);
      expect(report.plugins[0].name).toBe('esbuild');
      expect(report.plugins[0].totalTime).toBe(150);
    });

    it('should sort modules by compilation time', async () => {
      const report = await profiler.generateReport();

      // Modules should be sorted slowest first
      expect(report.modules[0].compilationTime).toBeGreaterThanOrEqual(report.modules[1].compilationTime);
    });

    it('should calculate phases', async () => {
      const report = await profiler.generateReport();

      expect(report.phases.length).toBeGreaterThan(0);

      for (const phase of report.phases) {
        expect(phase.name).toBeTruthy();
        expect(phase.duration).toBeGreaterThanOrEqual(0);
        expect(phase.percentage).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Slow Operations', () => {
    it('should detect slow operations', async () => {
      const slowProfiler = new BuildProfiler({
        enabled: true,
        slowThreshold: 50, // 50ms threshold
      });

      slowProfiler.start();
      slowProfiler.startMetric('slow-operation');

      await new Promise((resolve) => setTimeout(resolve, 60));

      slowProfiler.endMetric('slow-operation');

      const report = await slowProfiler.generateReport();

      expect(report.slowOperations.length).toBeGreaterThan(0);
      expect(report.slowOperations[0].name).toBe('slow-operation');
    });

    it('should not flag fast operations', async () => {
      const fastProfiler = new BuildProfiler({
        enabled: true,
        slowThreshold: 100,
      });

      fastProfiler.start();
      fastProfiler.startMetric('fast-operation');
      fastProfiler.endMetric('fast-operation');

      const report = await fastProfiler.generateReport();

      expect(report.slowOperations.length).toBe(0);
    });
  });

  describe('Memory Tracking', () => {
    it('should track memory usage when enabled', async () => {
      const memoryProfiler = new BuildProfiler({
        enabled: true,
        trackMemory: true,
      });

      memoryProfiler.start();
      memoryProfiler.startMetric('memory-test');
      // Allocate some memory
      const arr = new Array(1000000).fill('test');
      memoryProfiler.endMetric('memory-test');

      const report = await memoryProfiler.generateReport();

      if (report.memory) {
        expect(report.memory.initial).toBeGreaterThan(0);
        expect(report.memory.peak).toBeGreaterThanOrEqual(report.memory.initial);
        expect(report.memory.final).toBeGreaterThan(0);
      }

      // Keep arr in scope to prevent premature GC
      expect(arr.length).toBe(1000000);
    });

    it('should not track memory when disabled', async () => {
      const noMemoryProfiler = new BuildProfiler({
        enabled: true,
        trackMemory: false,
      });

      noMemoryProfiler.start();

      const report = await noMemoryProfiler.generateReport();

      expect(report.memory).toBeUndefined();
    });
  });

  describe('Report Saving', () => {
    it('should save JSON report', async () => {
      profiler.start();
      profiler.recordModule('test.js', 50, 25, 5000, 2);

      const report = await profiler.generateReport();
      await profiler.saveReport(report);

      const files = await fs.readdir(outputDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      expect(jsonFiles.length).toBeGreaterThan(0);
    });

    it('should save HTML report', async () => {
      const htmlProfiler = new BuildProfiler({
        enabled: true,
        outputDir,
        format: 'html',
        open: false,
      });

      htmlProfiler.start();
      htmlProfiler.recordModule('test.js', 50, 25, 5000, 2);

      const report = await htmlProfiler.generateReport();
      await htmlProfiler.saveReport(report);

      const files = await fs.readdir(outputDir);
      const htmlFiles = files.filter((f) => f.endsWith('.html'));

      expect(htmlFiles.length).toBeGreaterThan(0);
    });

    it('should save table report', async () => {
      const tableProfiler = new BuildProfiler({
        enabled: true,
        outputDir,
        format: 'table',
        open: false,
      });

      tableProfiler.start();
      tableProfiler.recordModule('test.js', 50, 25, 5000, 2);

      const report = await tableProfiler.generateReport();
      await tableProfiler.saveReport(report);

      const files = await fs.readdir(outputDir);
      const txtFiles = files.filter((f) => f.endsWith('.txt'));

      expect(txtFiles.length).toBeGreaterThan(0);
    });

    it('should save all formats', async () => {
      const allFormatsProfiler = new BuildProfiler({
        enabled: true,
        outputDir,
        format: 'all',
        open: false,
      });

      allFormatsProfiler.start();
      allFormatsProfiler.recordModule('test.js', 50, 25, 5000, 2);

      const report = await allFormatsProfiler.generateReport();
      await allFormatsProfiler.saveReport(report);

      const files = await fs.readdir(outputDir);

      expect(files.some((f) => f.endsWith('.json'))).toBe(true);
      expect(files.some((f) => f.endsWith('.html'))).toBe(true);
      expect(files.some((f) => f.endsWith('.txt'))).toBe(true);
    });
  });

  describe('Disabled Profiler', () => {
    it('should not profile when disabled', () => {
      const disabledProfiler = new BuildProfiler({
        enabled: false,
      });

      disabledProfiler.start();
      disabledProfiler.startMetric('test');
      disabledProfiler.endMetric('test');

      const stats = disabledProfiler.getStats();

      expect(stats.totalMetrics).toBe(0);
    });

    it('should throw error when generating report while disabled', async () => {
      const disabledProfiler = new BuildProfiler({
        enabled: false,
      });

      await expect(disabledProfiler.generateReport()).rejects.toThrow('Profiler is not enabled');
    });
  });

  describe('Clear', () => {
    it('should clear all data', () => {
      profiler.start();
      profiler.recordModule('test.js', 50, 25, 5000, 2);
      profiler.recordPlugin('plugin', 'hook', 10);

      profiler.clear();

      const stats = profiler.getStats();

      expect(stats.totalMetrics).toBe(0);
      expect(stats.moduleCount).toBe(0);
      expect(stats.pluginCount).toBe(0);
    });
  });

  describe('Nested Metrics', () => {
    it('should track nested metrics', () => {
      profiler.start();
      profiler.startMetric('parent', undefined, { level: 1 });
      profiler.startMetric('child', 'parent', { level: 2 });
      profiler.endMetric('child');
      profiler.endMetric('parent');

      const stats = profiler.getStats();

      expect(stats.totalMetrics).toBe(2);
    });
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', () => {
      profiler.start();
      profiler.startMetric('metric1');
      profiler.startMetric('metric2');
      profiler.endMetric('metric1');

      const stats = profiler.getStats();

      expect(stats.elapsedTime).toBeGreaterThan(0);
      expect(stats.totalMetrics).toBe(2);
      expect(stats.activeMetrics).toBe(1);
    });
  });

  describe('createBuildProfiler factory', () => {
    it('should create profiler instance', () => {
      const factoryProfiler = createBuildProfiler();

      expect(factoryProfiler).toBeInstanceOf(BuildProfiler);
    });

    it('should accept configuration', () => {
      const factoryProfiler = createBuildProfiler({
        enabled: true,
        format: 'json',
        slowThreshold: 200,
      });

      expect(factoryProfiler).toBeInstanceOf(BuildProfiler);
    });
  });

  describe('Profile Decorator', () => {
    it('should profile decorated methods', async () => {
      const testProfiler = new BuildProfiler({ enabled: true });
      testProfiler.start();

      class TestClass {
        @Profile(testProfiler)
        async slowMethod() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'done';
        }
      }

      const instance = new TestClass();
      const result = await instance.slowMethod();

      expect(result).toBe('done');

      const stats = testProfiler.getStats();
      expect(stats.totalMetrics).toBeGreaterThan(0);
    });

    it('should use custom metric name', async () => {
      const testProfiler = new BuildProfiler({ enabled: true });
      testProfiler.start();

      class TestClass {
        @Profile(testProfiler, 'custom-metric')
        async method() {
          return 'result';
        }
      }

      const instance = new TestClass();
      await instance.method();

      const stats = testProfiler.getStats();
      expect(stats.totalMetrics).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty metrics', async () => {
      profiler.start();

      const report = await profiler.generateReport();

      expect(report.modules).toEqual([]);
      expect(report.plugins).toEqual([]);
    });

    it('should handle metrics without end', () => {
      profiler.start();
      profiler.startMetric('incomplete');
      // Don't call endMetric

      const stats = profiler.getStats();

      expect(stats.activeMetrics).toBe(1);
    });

    it('should handle ending non-existent metrics', () => {
      profiler.start();
      profiler.endMetric('does-not-exist');

      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle very short durations', () => {
      profiler.start();
      profiler.startMetric('instant');
      profiler.endMetric('instant');

      const stats = profiler.getStats();

      expect(stats.totalMetrics).toBe(1);
    });
  });

  describe('Flamegraph', () => {
    it('should generate flamegraph data when enabled', async () => {
      const flamegraphProfiler = new BuildProfiler({
        enabled: true,
        outputDir,
        generateFlamegraph: true,
      });

      flamegraphProfiler.start();
      flamegraphProfiler.startMetric('parent');
      flamegraphProfiler.startMetric('child', 'parent');
      flamegraphProfiler.endMetric('child');
      flamegraphProfiler.endMetric('parent');

      const report = await flamegraphProfiler.generateReport();
      await flamegraphProfiler.saveReport(report);

      const files = await fs.readdir(outputDir);
      const flamegraphFiles = files.filter((f) => f.startsWith('flamegraph-'));

      expect(flamegraphFiles.length).toBeGreaterThan(0);
    });

    it('should not generate flamegraph when disabled', async () => {
      const noFlamegraphProfiler = new BuildProfiler({
        enabled: true,
        outputDir,
        generateFlamegraph: false,
      });

      noFlamegraphProfiler.start();
      noFlamegraphProfiler.startMetric('test');
      noFlamegraphProfiler.endMetric('test');

      const report = await noFlamegraphProfiler.generateReport();
      await noFlamegraphProfiler.saveReport(report);

      const files = await fs.readdir(outputDir);
      const flamegraphFiles = files.filter((f) => f.startsWith('flamegraph-'));

      expect(flamegraphFiles.length).toBe(0);
    });
  });

  describe('Report Formats', () => {
    beforeEach(() => {
      profiler.start();
      profiler.recordModule('app.js', 100, 50, 10000, 5);
      profiler.recordPlugin('esbuild', 'transform', 75);
    });

    it('should format HTML report correctly', async () => {
      const report = await profiler.generateReport();
      const htmlProfiler = new BuildProfiler({
        enabled: true,
        format: 'html',
      });

      // Access the private method through type assertion for testing
      const html = await (htmlProfiler as any).formatReport(report, 'html');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Build Performance Report');
      expect(html).toContain('app.js');
      expect(html).toContain('esbuild');
    });

    it('should format table report correctly', async () => {
      const report = await profiler.generateReport();
      const tableProfiler = new BuildProfiler({
        enabled: true,
        format: 'table',
      });

      const table = await (tableProfiler as any).formatReport(report, 'table');

      expect(table).toContain('BUILD PERFORMANCE REPORT');
      expect(table).toContain('Total Build Time');
      expect(table).toContain('app.js');
    });

    it('should format JSON report correctly', async () => {
      const report = await profiler.generateReport();
      const jsonProfiler = new BuildProfiler({
        enabled: true,
        format: 'json',
      });

      const json = await (jsonProfiler as any).formatReport(report, 'json');
      const parsed = JSON.parse(json);

      expect(parsed.timestamp).toBeDefined();
      expect(parsed.totalTime).toBeDefined();
      expect(parsed.modules).toBeDefined();
      expect(parsed.plugins).toBeDefined();
    });
  });
});
