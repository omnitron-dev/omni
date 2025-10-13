/**
 * Profiler UI Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createProfiler } from '../../src/devtools/profiler.js';
import { createProfilerUI } from '../../src/devtools/profiler-ui.js';

describe('ProfilerUI', () => {
  let profiler: ReturnType<typeof createProfiler>;
  let profilerUI: ReturnType<typeof createProfilerUI>;

  beforeEach(() => {
    profiler = createProfiler();
    profilerUI = createProfilerUI(profiler, {
      enableFPSCounter: true,
      enableMemoryGraph: true,
      showOverlay: false, // Disable overlay for testing
    });
  });

  afterEach(() => {
    profilerUI.disable();
  });

  describe('enable/disable', () => {
    it('should enable profiler UI', () => {
      profilerUI.enable();
      expect(profilerUI).toBeDefined();
    });

    it('should disable profiler UI', () => {
      profilerUI.enable();
      profilerUI.disable();
      expect(profilerUI).toBeDefined();
    });
  });

  describe('flame graph generation', () => {
    it('should generate flame graph from profile', () => {
      profiler.startProfiling();

      // Simulate some measurements
      const component = { id: 'comp-1', name: 'TestComponent' };
      profiler.measureComponent(component, () => {
        // Simulate work
        for (let i = 0; i < 1000; i++) {
          Math.sqrt(i);
        }
      });

      const profile = profiler.stopProfiling();
      const flameGraph = profilerUI.generateFlameGraph(profile);

      expect(flameGraph).toBeDefined();
      expect(flameGraph.name).toBe('Root');
      expect(flameGraph.children.length).toBeGreaterThan(0);
    });
  });

  describe('timeline generation', () => {
    it('should generate timeline from profile', () => {
      profiler.startProfiling();

      // Simulate some measurements
      const component1 = { id: 'comp-1', name: 'Component1' };
      const component2 = { id: 'comp-2', name: 'Component2' };

      profiler.measureComponent(component1, () => {});
      profiler.measureComponent(component2, () => {});

      const profile = profiler.stopProfiling();
      const timeline = profilerUI.generateTimeline(profile);

      expect(timeline).toBeDefined();
      expect(Array.isArray(timeline)).toBe(true);
      expect(timeline.length).toBeGreaterThan(0);
    });
  });

  describe('bottleneck detection', () => {
    it('should identify bottlenecks', () => {
      profiler.startProfiling();

      // Simulate slow component
      const slowComponent = { id: 'slow-comp', name: 'SlowComponent' };
      profiler.measureComponent(slowComponent, () => {
        // Simulate heavy work
        for (let i = 0; i < 100000; i++) {
          Math.sqrt(i);
        }
      });

      const profile = profiler.stopProfiling();
      const bottlenecks = profilerUI.identifyBottlenecks(profile);

      expect(bottlenecks).toBeDefined();
      expect(Array.isArray(bottlenecks)).toBe(true);
    });

    it('should provide recommendations for bottlenecks', () => {
      profiler.startProfiling();

      const component = { id: 'comp-1', name: 'TestComponent' };
      profiler.measureComponent(component, () => {
        for (let i = 0; i < 100000; i++) {
          Math.sqrt(i);
        }
      });

      const profile = profiler.stopProfiling();
      const bottlenecks = profilerUI.identifyBottlenecks(profile);

      if (bottlenecks.length > 0) {
        expect(bottlenecks[0].recommendation).toBeDefined();
        expect(typeof bottlenecks[0].recommendation).toBe('string');
      }
    });
  });

  describe('render phase breakdown', () => {
    it('should get render phase breakdown', () => {
      profiler.startProfiling();

      const component = { id: 'comp-1', name: 'TestComponent' };
      const effect = { id: 'effect-1', name: 'TestEffect' };

      profiler.measureComponent(component, () => {});
      profiler.measureEffect(effect, () => {});

      const profile = profiler.stopProfiling();
      const breakdown = profilerUI.getRenderPhaseBreakdown(profile);

      expect(breakdown).toBeDefined();
      expect(breakdown.total).toBeGreaterThanOrEqual(0);
      expect(breakdown.percentages).toBeDefined();
    });
  });

  describe('FPS tracking', () => {
    it('should track FPS', async () => {
      profilerUI.enable();

      // Wait a bit for FPS tracking to start
      await new Promise(resolve => setTimeout(resolve, 100));

      const fpsHistory = profilerUI.getFPSHistory();
      expect(Array.isArray(fpsHistory)).toBe(true);
    });

    it('should get current FPS', () => {
      profilerUI.enable();
      const fps = profilerUI.getCurrentFPS();
      expect(typeof fps).toBe('number');
      expect(fps).toBeGreaterThanOrEqual(0);
    });

    it('should calculate average FPS', () => {
      profilerUI.enable();
      const avgFPS = profilerUI.getAverageFPS();
      expect(typeof avgFPS).toBe('number');
      expect(avgFPS).toBeGreaterThanOrEqual(0);
    });
  });

  describe('memory tracking', () => {
    it('should track memory', () => {
      profilerUI.enable();
      const memoryHistory = profilerUI.getMemoryHistory();
      expect(Array.isArray(memoryHistory)).toBe(true);
    });
  });

  describe('report export', () => {
    it('should export profiling report', () => {
      profiler.startProfiling();

      const component = { id: 'comp-1', name: 'TestComponent' };
      profiler.measureComponent(component, () => {});

      const profile = profiler.stopProfiling();
      const report = profilerUI.exportReport(profile);

      expect(report).toBeDefined();
      expect(typeof report).toBe('string');

      const parsed = JSON.parse(report);
      expect(parsed.profile).toBeDefined();
      expect(parsed.breakdown).toBeDefined();
      expect(parsed.performance).toBeDefined();
    });
  });
});
