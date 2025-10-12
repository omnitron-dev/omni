import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MetricsCollector } from '../src/metrics';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector({
      slowThreshold: 100,
      sampleRate: 1,
      trackMemory: true,
    });
  });

  describe('enable/disable', () => {
    it('should start disabled', () => {
      expect(metrics.isEnabled()).toBe(false);
    });

    it('should enable and disable', () => {
      metrics.enable();
      expect(metrics.isEnabled()).toBe(true);

      metrics.disable();
      expect(metrics.isEnabled()).toBe(false);
    });
  });

  describe('recordEmission', () => {
    beforeEach(() => {
      metrics.enable();
    });

    it('should not record when disabled', () => {
      metrics.disable();
      metrics.recordEmission('test', true, 10);

      const data = metrics.getMetrics();
      expect(data.eventsEmitted).toBe(0);
    });

    it('should record successful emissions', () => {
      metrics.recordEmission('event1', true, 10);
      metrics.recordEmission('event1', true, 20);
      metrics.recordEmission('event2', true, 30);

      const data = metrics.getMetrics();
      expect(data.eventsEmitted).toBe(3);
      expect(data.eventsFailed).toBe(0);
      expect(data.eventCounts.get('event1')).toBe(2);
      expect(data.eventCounts.get('event2')).toBe(1);
    });

    it('should record failed emissions', () => {
      metrics.recordEmission('event1', false);
      metrics.recordEmission('event2', false);
      metrics.recordEmission('event2', false);

      const data = metrics.getMetrics();
      expect(data.eventsEmitted).toBe(3);
      expect(data.eventsFailed).toBe(3);
      expect(data.errorCounts.get('event1')).toBe(1);
      expect(data.errorCounts.get('event2')).toBe(2);
    });

    it('should track processing times', () => {
      metrics.recordEmission('event1', true, 10);
      metrics.recordEmission('event1', true, 20);
      metrics.recordEmission('event1', true, 30);

      const data = metrics.getMetrics();
      expect(data.avgProcessingTime.get('event1')).toBe(20); // (10 + 20 + 30) / 3
    });

    it('should track slow events', () => {
      metrics.recordEmission('fast', true, 50);
      metrics.recordEmission('slow1', true, 150);
      metrics.recordEmission('slow2', true, 200);
      metrics.recordEmission('slower', true, 300);

      const data = metrics.getMetrics();
      expect(data.slowestEvents).toHaveLength(3);
      expect(data.slowestEvents[0]).toEqual({ event: 'slower', duration: 300 });
      expect(data.slowestEvents[1]).toEqual({ event: 'slow2', duration: 200 });
      expect(data.slowestEvents[2]).toEqual({ event: 'slow1', duration: 150 });
    });

    it('should keep only top 10 slowest events', () => {
      for (let i = 1; i <= 15; i++) {
        metrics.recordEmission(`event${i}`, true, 100 + i * 10);
      }

      const data = metrics.getMetrics();
      expect(data.slowestEvents).toHaveLength(10);
      expect(data.slowestEvents[0]?.duration).toBe(250); // event15: 100 + 15*10
      expect(data.slowestEvents[9]?.duration).toBe(160); // event6: 100 + 6*10
    });

    it('should respect sample rate', () => {
      // Create metrics with 50% sample rate
      metrics = new MetricsCollector({ sampleRate: 0.5 });
      metrics.enable();

      // Mock Math.random to control sampling
      const originalRandom = Math.random;
      let callCount = 0;
      Math.random = jest.fn(
        () =>
          // Alternate between sampled (< 0.5) and not sampled (>= 0.5)
          (callCount++ % 2) * 0.6
      );

      for (let i = 0; i < 10; i++) {
        metrics.recordEmission('test', true, 10);
      }

      const data = metrics.getMetrics();
      expect(data.eventsEmitted).toBe(5); // Only half should be recorded

      Math.random = originalRandom;
    });

    it('should limit stored processing times per event', () => {
      // Record more than 100 times for same event
      for (let i = 0; i < 150; i++) {
        metrics.recordEmission('test', true, i);
      }

      // Internal check - processing times array should be capped at 100
      const data = metrics.getMetrics();
      expect(data.avgProcessingTime.get('test')).toBeDefined();
      // Average should be of last 100 values (50-149)
      const expectedAvg = Array.from({ length: 100 }, (_, i) => 50 + i).reduce((sum, n) => sum + n, 0) / 100;
      expect(data.avgProcessingTime.get('test')).toBeCloseTo(expectedAvg, 0);
    });
  });

  describe('updateListenerCount', () => {
    beforeEach(() => {
      metrics.enable();
    });

    it('should update listener counts', () => {
      metrics.updateListenerCount('event1', 5);
      metrics.updateListenerCount('event2', 3);

      const data = metrics.getMetrics();
      expect(data.listenerCount.get('event1')).toBe(5);
      expect(data.listenerCount.get('event2')).toBe(3);
    });

    it('should overwrite previous counts', () => {
      metrics.updateListenerCount('event1', 5);
      metrics.updateListenerCount('event1', 10);

      const data = metrics.getMetrics();
      expect(data.listenerCount.get('event1')).toBe(10);
    });
  });

  describe('export', () => {
    beforeEach(() => {
      metrics.enable();
      metrics.recordEmission('event1', true, 50);
      metrics.recordEmission('event2', false);
      metrics.updateListenerCount('event1', 2);
    });

    it('should export metrics as JSON', () => {
      const json = metrics.export('json');
      const parsed = JSON.parse(json);

      expect(parsed).toMatchObject({
        timestamp: expect.any(Number),
        uptime: expect.any(Number),
        metrics: {
          eventsEmitted: 2,
          eventsFailed: 1,
          listenerCount: {
            event1: 2,
          },
          eventCounts: {
            event1: 1,
            event2: 1,
          },
          errorCounts: {
            event2: 1,
          },
        },
      });
    });

    it('should export metrics in Prometheus format', () => {
      const prometheus = metrics.export('prometheus');

      expect(prometheus).toContain('# HELP eventemitter_events_emitted_total');
      expect(prometheus).toContain('# TYPE eventemitter_events_emitted_total counter');
      expect(prometheus).toContain('eventemitter_events_emitted_total 2');
      expect(prometheus).toContain('eventemitter_events_failed_total 1');
      expect(prometheus).toContain('eventemitter_event_count{event="event1"} 1');
      expect(prometheus).toContain('eventemitter_listener_count{event="event1"} 2');
      expect(prometheus).toContain('eventemitter_avg_processing_time_ms{event="event1"} 50');
    });

    it('should return empty string for invalid format', () => {
      const result = metrics.export('invalid' as any);
      expect(result).toBe('');
    });
  });

  describe('getSummary', () => {
    it('should generate summary report', () => {
      metrics.enable();
      metrics.recordEmission('event1', true, 50);
      metrics.recordEmission('event2', false);
      metrics.recordEmission('slow', true, 200);

      const summary = metrics.getSummary();

      expect(summary).toContain('EventEmitter Metrics Summary');
      expect(summary).toContain('Total Events: 3');
      expect(summary).toContain('Failed Events: 1');
      expect(summary).toContain('Failure Rate: 33.33%');
      expect(summary).toContain('Unique Events: 3');
      expect(summary).toContain('Slowest Event: slow (200ms)');
    });

    it('should handle empty metrics', () => {
      metrics.enable();
      const summary = metrics.getSummary();

      expect(summary).toContain('Total Events: 0');
      expect(summary).toContain('Failed Events: 0');
      expect(summary).toContain('Failure Rate: 0.00%');
      expect(summary).toContain('Slowest Event: N/A (0ms)');
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      metrics.enable();
      metrics.recordEmission('event1', true, 50);
      metrics.recordEmission('event2', false);
      metrics.updateListenerCount('event1', 5);

      metrics.reset();

      const data = metrics.getMetrics();
      expect(data.eventsEmitted).toBe(0);
      expect(data.eventsFailed).toBe(0);
      expect(data.listenerCount.size).toBe(0);
      expect(data.eventCounts.size).toBe(0);
      expect(data.errorCounts.size).toBe(0);
      expect(data.slowestEvents).toHaveLength(0);
    });
  });

  describe('memory tracking', () => {
    it('should track memory usage when enabled', () => {
      if (typeof process === 'undefined' || !process.memoryUsage) {
        // Skip in environments without process.memoryUsage
        return;
      }

      metrics = new MetricsCollector({ trackMemory: true });
      metrics.enable();

      const data = metrics.getMetrics();
      expect(data.memoryUsage).toBeGreaterThan(0);
    });

    it('should not track memory when disabled', () => {
      metrics = new MetricsCollector({ trackMemory: false });
      metrics.enable();

      const data = metrics.getMetrics();
      expect(data.memoryUsage).toBe(0);
    });
  });
});
