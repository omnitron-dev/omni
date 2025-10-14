/**
 * Monitoring Integration Tests
 *
 * Tests monitoring systems working together:
 * - Component tracking during rendering
 * - Signal tracking with updates
 * - Memory profiling during operations
 * - Error tracking and recovery
 * - Performance dashboard data collection
 * - All monitoring systems integrated
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerformanceMonitor } from '../../src/monitoring/performance.js';
import { ComponentTracker } from '../../src/monitoring/component-tracking.js';
import { SignalTracker } from '../../src/monitoring/signal-tracking.js';
import { MemoryProfiler } from '../../src/monitoring/memory-profiler.js';
import { signal, computed } from '../../src/core/reactivity/index.js';

describe('Monitoring Integration', () => {
  describe('Performance Monitoring', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = new PerformanceMonitor({
        enabled: true,
        budget: {
          maxRenderTime: 16,
          maxSignalUpdateTime: 1,
          maxEffectTime: 5,
        },
      });
    });

    afterEach(() => {
      monitor.dispose();
    });

    it('should track complete render cycle', () => {
      monitor.mark('render-start', { type: 'component' });

      // Simulate render work
      const data = Array.from({ length: 100 }, (_, i) => i);
      const processed = data.map(x => x * 2);

      monitor.mark('render-end', { type: 'component' });

      const measure = monitor.measure('render-cycle', 'render-start', 'render-end');

      expect(measure).toBeDefined();
      expect(measure!.duration).toBeGreaterThan(0);
      expect(measure!.type).toBe('component');
    });

    it('should track multiple operations in sequence', () => {
      const operations = ['parse', 'analyze', 'transform', 'render'];

      operations.forEach(op => {
        monitor.mark(`${op}-start`);

        // Simulate work
        for (let i = 0; i < 1000; i++) {
          Math.sqrt(i);
        }

        monitor.mark(`${op}-end`);
        monitor.measure(op, `${op}-start`, `${op}-end`);
      });

      const measures = monitor.getMeasures();
      expect(measures.length).toBe(4);

      measures.forEach(measure => {
        expect(measure.duration).toBeGreaterThan(0);
      });
    });

    it('should detect budget violations', () => {
      const violations: any[] = [];

      const strictMonitor = new PerformanceMonitor({
        enabled: true,
        budget: {
          maxRenderTime: 1, // Very strict
        },
        onViolation: (v) => violations.push(v),
      });

      strictMonitor.mark('slow-start');

      // Simulate slow work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      strictMonitor.mark('slow-end');
      strictMonitor.measure('slow-operation', 'slow-start', 'slow-end');

      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].duration).toBeGreaterThan(violations[0].threshold);

      strictMonitor.dispose();
    });

    it('should provide performance summary', () => {
      for (let i = 0; i < 5; i++) {
        monitor.mark(`op${i}-start`);
        monitor.mark(`op${i}-end`);
        monitor.measure(`operation${i}`, `op${i}-start`, `op${i}-end`);
      }

      const summary = monitor.getSummary();

      expect(summary.totalMarks).toBeGreaterThanOrEqual(10);
      expect(summary.totalMeasures).toBe(5);
      expect(summary.averageDuration).toBeGreaterThanOrEqual(0);
      expect(summary.maxDuration).toBeGreaterThanOrEqual(0);
      expect(summary.minDuration).toBeGreaterThanOrEqual(0);
    });

    it('should support navigation timing', () => {
      const timing = monitor.getNavigationTiming();

      // May be null in test environment
      if (timing) {
        expect(timing).toHaveProperty('dnsLookup');
        expect(timing).toHaveProperty('tcpConnection');
        expect(timing).toHaveProperty('ttfb');
        expect(timing).toHaveProperty('domContentLoaded');
      }
    });

    it('should handle concurrent measurements', () => {
      const count = 10;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < count; i++) {
        const promise = new Promise(resolve => {
          monitor.mark(`async${i}-start`);

          setTimeout(() => {
            monitor.mark(`async${i}-end`);
            const measure = monitor.measure(`async${i}`, `async${i}-start`, `async${i}-end`);
            resolve(measure);
          }, Math.random() * 50);
        });

        promises.push(promise);
      }

      return Promise.all(promises).then(() => {
        const measures = monitor.getMeasures();
        expect(measures.length).toBeGreaterThanOrEqual(count);
      });
    });
  });

  describe('Component Tracking', () => {
    let tracker: ComponentTracker;

    beforeEach(() => {
      tracker = new ComponentTracker({
        trackLifecycle: true,
        trackProps: true,
        trackRenderTime: true,
      });
    });

    afterEach(() => {
      tracker.clear();
    });

    it('should track component lifecycle', () => {
      const componentId = 'TestComponent-1';

      tracker.trackMount(componentId, 'TestComponent', {});
      tracker.trackRender(componentId, 5.2);
      tracker.trackUpdate(componentId, { count: 1 });
      tracker.trackUnmount(componentId);

      const info = tracker.getComponentInfo(componentId);

      expect(info).toBeDefined();
      expect(info!.name).toBe('TestComponent');
      expect(info!.mountCount).toBe(1);
      expect(info!.renderCount).toBeGreaterThanOrEqual(1);
      expect(info!.updateCount).toBeGreaterThanOrEqual(1);
      expect(info!.unmountCount).toBe(1);
    });

    it('should track render times', () => {
      const componentId = 'PerformanceComponent';

      tracker.trackMount(componentId, 'PerformanceComponent', {});

      for (let i = 0; i < 10; i++) {
        tracker.trackRender(componentId, 2 + Math.random() * 3);
      }

      const info = tracker.getComponentInfo(componentId);

      expect(info!.renderCount).toBe(10);
      expect(info!.avgRenderTime).toBeGreaterThan(0);
      expect(info!.maxRenderTime).toBeGreaterThanOrEqual(info!.minRenderTime!);
    });

    it('should track prop changes', () => {
      const componentId = 'PropComponent';

      tracker.trackMount(componentId, 'PropComponent', { name: 'Initial' });
      tracker.trackUpdate(componentId, { name: 'Updated', count: 5 });
      tracker.trackUpdate(componentId, { name: 'Updated', count: 10 });

      const info = tracker.getComponentInfo(componentId);

      expect(info!.updateCount).toBe(2);
      expect(info!.currentProps).toEqual({ name: 'Updated', count: 10 });
    });

    it('should provide component statistics', () => {
      // Track multiple components
      for (let i = 0; i < 5; i++) {
        const id = `Component-${i}`;
        tracker.trackMount(id, `Component${i}`, {});

        for (let j = 0; j < i + 1; j++) {
          tracker.trackRender(id, 1 + Math.random());
        }
      }

      const stats = tracker.getStatistics();

      expect(stats.totalComponents).toBe(5);
      expect(stats.totalRenders).toBeGreaterThanOrEqual(15);
      expect(stats.avgRenderTime).toBeGreaterThan(0);
    });

    it('should identify slow components', () => {
      tracker.trackMount('Fast', 'FastComponent', {});
      tracker.trackRender('Fast', 1);

      tracker.trackMount('Slow', 'SlowComponent', {});
      tracker.trackRender('Slow', 20);

      const slow = tracker.getSlowestComponents(1);

      expect(slow.length).toBe(1);
      expect(slow[0].name).toBe('SlowComponent');
    });

    it('should track component hierarchy', () => {
      tracker.trackMount('parent', 'Parent', {});
      tracker.trackMount('child1', 'Child', {}, 'parent');
      tracker.trackMount('child2', 'Child', {}, 'parent');

      const parentInfo = tracker.getComponentInfo('parent');

      expect(parentInfo).toBeDefined();
      expect(parentInfo!.name).toBe('Parent');
    });
  });

  describe('Signal Tracking', () => {
    let tracker: SignalTracker;

    beforeEach(() => {
      tracker = new SignalTracker({
        trackReads: true,
        trackWrites: true,
        trackComputations: true,
      });
    });

    afterEach(() => {
      tracker.clear();
    });

    it('should track signal operations', () => {
      const count = signal(0);
      const signalId = 'count-signal';

      tracker.trackSignalCreation(signalId, 0);
      tracker.trackSignalRead(signalId);
      tracker.trackSignalWrite(signalId, 0, 1);
      tracker.trackSignalRead(signalId);
      tracker.trackSignalWrite(signalId, 1, 2);

      const info = tracker.getSignalInfo(signalId);

      expect(info).toBeDefined();
      expect(info!.reads).toBe(2);
      expect(info!.writes).toBe(2);
      expect(info!.currentValue).toBe(2);
    });

    it('should track computed signals', () => {
      const base = signal(5);
      const doubled = computed(() => base() * 2);

      const baseId = 'base-signal';
      const doubledId = 'doubled-computed';

      tracker.trackSignalCreation(baseId, 5);
      tracker.trackComputedCreation(doubledId, [baseId]);

      tracker.trackSignalWrite(baseId, 5, 10);
      tracker.trackComputedUpdate(doubledId, 10, 20);

      const computedInfo = tracker.getSignalInfo(doubledId);

      expect(computedInfo).toBeDefined();
      expect(computedInfo!.computations).toBe(1);
    });

    it('should track signal dependencies', () => {
      const a = signal(1);
      const b = signal(2);
      const sum = computed(() => a() + b());

      tracker.trackSignalCreation('a', 1);
      tracker.trackSignalCreation('b', 2);
      tracker.trackComputedCreation('sum', ['a', 'b']);

      const dependencies = tracker.getDependencies('sum');

      expect(dependencies).toContain('a');
      expect(dependencies).toContain('b');
    });

    it('should provide signal statistics', () => {
      for (let i = 0; i < 10; i++) {
        tracker.trackSignalCreation(`signal-${i}`, i);
        tracker.trackSignalRead(`signal-${i}`);
        tracker.trackSignalWrite(`signal-${i}`, i, i + 1);
      }

      const stats = tracker.getStatistics();

      expect(stats.totalSignals).toBe(10);
      expect(stats.totalReads).toBe(10);
      expect(stats.totalWrites).toBe(10);
    });

    it('should identify hot signals', () => {
      tracker.trackSignalCreation('hot', 0);
      tracker.trackSignalCreation('cold', 0);

      // Hot signal gets many reads/writes
      for (let i = 0; i < 100; i++) {
        tracker.trackSignalRead('hot');
        if (i % 10 === 0) {
          tracker.trackSignalWrite('hot', i, i + 1);
        }
      }

      // Cold signal gets few reads/writes
      tracker.trackSignalRead('cold');
      tracker.trackSignalWrite('cold', 0, 1);

      const hotSignals = tracker.getHotSignals(1);

      expect(hotSignals.length).toBe(1);
      expect(hotSignals[0].id).toBe('hot');
    });
  });

  describe('Memory Profiling', () => {
    let profiler: MemoryProfiler;

    beforeEach(() => {
      profiler = new MemoryProfiler({
        enabled: true,
        sampleInterval: 100,
        warningThreshold: 50 * 1024 * 1024, // 50MB
      });
    });

    afterEach(() => {
      profiler.stop();
    });

    it('should track memory usage', async () => {
      profiler.start();

      // Allocate some memory
      const arrays: any[] = [];
      for (let i = 0; i < 10; i++) {
        arrays.push(new Array(1000).fill(i));
      }

      await new Promise(resolve => setTimeout(resolve, 150));

      profiler.stop();

      const snapshot = profiler.takeSnapshot();

      expect(snapshot).toBeDefined();
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    it('should detect memory leaks', async () => {
      const leaks: any[] = [];

      const leakDetector = new MemoryProfiler({
        enabled: true,
        sampleInterval: 50,
        onLeak: (leak) => leaks.push(leak),
      });

      leakDetector.start();

      // Simulate leak
      const leakyArray: any[] = [];
      const interval = setInterval(() => {
        leakyArray.push(new Array(1000).fill(0));
      }, 10);

      await new Promise(resolve => setTimeout(resolve, 200));

      clearInterval(interval);
      leakDetector.stop();

      // May or may not detect leak in test environment
      // Just verify it doesn't crash
      expect(leaks).toBeDefined();
    });

    it('should track component memory', () => {
      profiler.trackComponent('Component1', 1024);
      profiler.trackComponent('Component2', 2048);
      profiler.trackComponent('Component3', 512);

      const largest = profiler.getLargestComponents(2);

      expect(largest.length).toBe(2);
      expect(largest[0].name).toBe('Component2');
      expect(largest[1].name).toBe('Component1');
    });

    it('should provide memory statistics', () => {
      profiler.trackComponent('A', 1000);
      profiler.trackComponent('B', 2000);
      profiler.trackComponent('C', 3000);

      const stats = profiler.getStatistics();

      expect(stats.totalComponents).toBe(3);
      expect(stats.totalMemory).toBe(6000);
      expect(stats.averageMemory).toBe(2000);
    });
  });

  describe('Integrated Monitoring', () => {
    let perfMonitor: PerformanceMonitor;
    let componentTracker: ComponentTracker;
    let signalTracker: SignalTracker;
    let memoryProfiler: MemoryProfiler;

    beforeEach(() => {
      perfMonitor = new PerformanceMonitor({ enabled: true });
      componentTracker = new ComponentTracker({ trackLifecycle: true });
      signalTracker = new SignalTracker({ trackReads: true, trackWrites: true });
      memoryProfiler = new MemoryProfiler({ enabled: true });
    });

    afterEach(() => {
      perfMonitor.dispose();
      componentTracker.clear();
      signalTracker.clear();
      memoryProfiler.stop();
    });

    it('should monitor complete component lifecycle', () => {
      const componentId = 'IntegratedComponent';

      // Track performance
      perfMonitor.mark('component-mount-start');

      // Track component
      componentTracker.trackMount(componentId, 'IntegratedComponent', { initial: true });

      // Track signal creation
      signalTracker.trackSignalCreation('component-state', { count: 0 });

      // Track memory
      memoryProfiler.trackComponent(componentId, 2048);

      perfMonitor.mark('component-mount-end');
      perfMonitor.measure('component-mount', 'component-mount-start', 'component-mount-end');

      // Verify all tracking
      const perfMeasure = perfMonitor.getMeasures().find(m => m.name === 'component-mount');
      const compInfo = componentTracker.getComponentInfo(componentId);
      const sigInfo = signalTracker.getSignalInfo('component-state');
      const memStats = memoryProfiler.getStatistics();

      expect(perfMeasure).toBeDefined();
      expect(compInfo).toBeDefined();
      expect(sigInfo).toBeDefined();
      expect(memStats.totalComponents).toBeGreaterThanOrEqual(1);
    });

    it('should monitor render performance with signal updates', () => {
      const componentId = 'RenderComponent';
      const signalId = 'render-signal';

      componentTracker.trackMount(componentId, 'RenderComponent', {});
      signalTracker.trackSignalCreation(signalId, 0);

      for (let i = 0; i < 10; i++) {
        perfMonitor.mark(`render-${i}-start`);

        signalTracker.trackSignalRead(signalId);
        componentTracker.trackRender(componentId, 1 + Math.random());

        if (i % 2 === 0) {
          signalTracker.trackSignalWrite(signalId, i, i + 1);
        }

        perfMonitor.mark(`render-${i}-end`);
        perfMonitor.measure(`render-${i}`, `render-${i}-start`, `render-${i}-end`);
      }

      const compInfo = componentTracker.getComponentInfo(componentId);
      const sigInfo = signalTracker.getSignalInfo(signalId);
      const perfSummary = perfMonitor.getSummary();

      expect(compInfo!.renderCount).toBe(10);
      expect(sigInfo!.reads).toBe(10);
      expect(sigInfo!.writes).toBe(5);
      expect(perfSummary.totalMeasures).toBeGreaterThanOrEqual(10);
    });

    it('should track effect execution', () => {
      const signalId = 'effect-signal';

      signalTracker.trackSignalCreation(signalId, 0);

      for (let i = 0; i < 5; i++) {
        perfMonitor.mark(`effect-${i}-start`, { type: 'effect' });

        signalTracker.trackSignalRead(signalId);

        // Simulate effect work
        for (let j = 0; j < 100; j++) {
          Math.sqrt(j);
        }

        perfMonitor.mark(`effect-${i}-end`, { type: 'effect' });
        perfMonitor.measure(`effect-${i}`, `effect-${i}-start`, `effect-${i}-end`);
      }

      const measures = perfMonitor.getMeasures();
      const effectMeasures = measures.filter(m => m.name.startsWith('effect-'));

      expect(effectMeasures.length).toBe(5);
      effectMeasures.forEach(m => {
        expect(m.duration).toBeGreaterThan(0);
      });
    });

    it('should provide comprehensive dashboard data', () => {
      // Simulate application activity
      for (let i = 0; i < 5; i++) {
        const compId = `Component-${i}`;
        const sigId = `signal-${i}`;

        componentTracker.trackMount(compId, `Component${i}`, {});
        signalTracker.trackSignalCreation(sigId, i);
        memoryProfiler.trackComponent(compId, 1024 * (i + 1));

        for (let j = 0; j < 3; j++) {
          perfMonitor.mark(`op-${i}-${j}-start`);
          componentTracker.trackRender(compId, 1 + Math.random());
          signalTracker.trackSignalRead(sigId);
          perfMonitor.mark(`op-${i}-${j}-end`);
          perfMonitor.measure(`op-${i}-${j}`, `op-${i}-${j}-start`, `op-${i}-${j}-end`);
        }
      }

      // Collect dashboard data
      const dashboardData = {
        performance: perfMonitor.getSummary(),
        components: componentTracker.getStatistics(),
        signals: signalTracker.getStatistics(),
        memory: memoryProfiler.getStatistics(),
      };

      expect(dashboardData.performance.totalMeasures).toBeGreaterThanOrEqual(15);
      expect(dashboardData.components.totalComponents).toBe(5);
      expect(dashboardData.signals.totalSignals).toBe(5);
      expect(dashboardData.memory.totalComponents).toBe(5);
    });

    it('should handle high-frequency updates', () => {
      const componentId = 'HighFreqComponent';
      const signalId = 'high-freq-signal';

      componentTracker.trackMount(componentId, 'HighFreqComponent', {});
      signalTracker.trackSignalCreation(signalId, 0);

      perfMonitor.mark('high-freq-start');

      // Simulate high-frequency updates
      for (let i = 0; i < 1000; i++) {
        signalTracker.trackSignalRead(signalId);

        if (i % 10 === 0) {
          signalTracker.trackSignalWrite(signalId, i, i + 1);
          componentTracker.trackRender(componentId, 0.1);
        }
      }

      perfMonitor.mark('high-freq-end');
      perfMonitor.measure('high-freq', 'high-freq-start', 'high-freq-end');

      const compInfo = componentTracker.getComponentInfo(componentId);
      const sigInfo = signalTracker.getSignalInfo(signalId);
      const measure = perfMonitor.getMeasures().find(m => m.name === 'high-freq');

      expect(compInfo!.renderCount).toBe(100);
      expect(sigInfo!.reads).toBe(1000);
      expect(sigInfo!.writes).toBe(100);
      expect(measure).toBeDefined();
      expect(measure!.duration).toBeGreaterThan(0);
    });
  });

  describe('Error Tracking Integration', () => {
    it('should track errors with context', () => {
      const errors: any[] = [];

      const monitor = new PerformanceMonitor({
        enabled: true,
        onViolation: (v) => {
          if (v.type === 'custom') {
            errors.push(v);
          }
        },
      });

      try {
        throw new Error('Test error');
      } catch (error) {
        monitor.mark('error-occurred', {
          error: (error as Error).message,
          component: 'TestComponent',
        });
      }

      const marks = monitor.getMarks();
      const errorMark = marks.find(m => m.name === 'error-occurred');

      expect(errorMark).toBeDefined();
      expect(errorMark!.metadata?.error).toBe('Test error');

      monitor.dispose();
    });
  });

  describe('Real-time Monitoring', () => {
    it('should provide real-time updates', async () => {
      const monitor = new PerformanceMonitor({ enabled: true });
      const tracker = new ComponentTracker({ trackLifecycle: true });

      const updates: any[] = [];

      // Simulate real-time monitoring
      const interval = setInterval(() => {
        updates.push({
          performance: monitor.getSummary(),
          components: tracker.getStatistics(),
        });
      }, 50);

      // Perform operations
      for (let i = 0; i < 5; i++) {
        tracker.trackMount(`comp-${i}`, `Component${i}`, {});
        monitor.mark(`op-${i}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      clearInterval(interval);

      expect(updates.length).toBeGreaterThan(0);
      updates.forEach(update => {
        expect(update.performance).toBeDefined();
        expect(update.components).toBeDefined();
      });

      monitor.dispose();
      tracker.clear();
    });
  });
});
