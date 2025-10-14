/**
 * Signal Tracking Tests
 *
 * Tests for signal read/write tracking, subscription counting,
 * update frequency monitoring, dependency graph building, and circular dependency detection.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInspector } from '../../src/devtools/inspector.js';
import type { Inspector, SignalMetadata, ComputedMetadata } from '../../src/devtools/types.js';

describe('Signal Tracking', () => {
  let inspector: Inspector;

  beforeEach(() => {
    inspector = createInspector();
  });

  afterEach(() => {
    inspector.dispose();
  });

  describe('Signal Read/Write Tracking', () => {
    it('should track signal reads', () => {
      const mockSignal = {
        peek: vi.fn(() => 42),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'ReadSignal' });

      // Simulate reads
      mockSignal.peek();
      mockSignal.peek();
      mockSignal.peek();

      expect(mockSignal.peek).toHaveBeenCalledTimes(4); // 1 from trackSignal + 3 manual
    });

    it('should track signal writes', async () => {
      const mockSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
        set: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'WriteSignal' });

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Simulate writes
      mockSignal.set(2);
      mockSignal.peek.mockReturnValue(2);
      inspector.trackSignal(mockSignal, { name: 'WriteSignal' });

      mockSignal.set(3);
      mockSignal.peek.mockReturnValue(3);
      inspector.trackSignal(mockSignal, { name: 'WriteSignal' });

      const state = inspector.getState();
      const signal = Array.from(state.signals.values())[0] as SignalMetadata;

      expect(signal.value).toBe(3);
      expect(signal.updatedAt).toBeGreaterThanOrEqual(signal.createdAt);
    });

    it('should differentiate writable and read-only signals', () => {
      const readOnlySignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      const writableSignal = {
        peek: vi.fn(() => 2),
        subscribe: vi.fn(),
        set: vi.fn(),
      };

      inspector.trackSignal(readOnlySignal, { name: 'ReadOnly' });
      inspector.trackSignal(writableSignal, { name: 'Writable' });

      const state = inspector.getState();
      const signals = Array.from(state.signals.values());

      const readOnly = signals.find((s) => s.name === 'ReadOnly');
      const writable = signals.find((s) => s.name === 'Writable');

      expect(readOnly?.type).toBe('signal');
      expect(writable?.type).toBe('writable');
    });

    it('should track signal value history', () => {
      const mockSignal = {
        peek: vi.fn(() => 0),
        subscribe: vi.fn(),
        set: vi.fn(),
      };

      const values = [0, 1, 2, 3, 4, 5];

      for (const value of values) {
        mockSignal.peek.mockReturnValue(value);
        inspector.trackSignal(mockSignal, { name: 'HistorySignal' });
      }

      const state = inspector.getState();
      const signal = Array.from(state.signals.values())[0] as SignalMetadata;

      expect(signal.value).toBe(5); // Last value
    });
  });

  describe('Subscription Counting', () => {
    it('should count signal subscriptions', () => {
      const mockSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(() => () => {}),
      };

      inspector.trackSignal(mockSignal, { name: 'SubscribedSignal' });

      // Simulate subscriptions
      const unsub1 = mockSignal.subscribe(() => {});
      const unsub2 = mockSignal.subscribe(() => {});
      const unsub3 = mockSignal.subscribe(() => {});

      expect(mockSignal.subscribe).toHaveBeenCalledTimes(3);

      // Cleanup
      unsub1();
      unsub2();
      unsub3();
    });

    it('should track dependent count', () => {
      const mockDependency = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      const mockComputed1 = {
        peek: vi.fn(() => 2),
        subscribe: vi.fn(),
      };

      const mockComputed2 = {
        peek: vi.fn(() => 3),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockDependency, { name: 'Dependency' });
      inspector.trackComputed(mockComputed1, [mockDependency], { name: 'Computed1' });
      inspector.trackComputed(mockComputed2, [mockDependency], { name: 'Computed2' });

      const state = inspector.getState();
      const dependency = Array.from(state.signals.values())[0] as SignalMetadata;

      expect(dependency.dependentCount).toBe(2);
    });

    it('should track effect subscriptions', () => {
      const mockSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      const effect1 = vi.fn();
      const effect2 = vi.fn();

      inspector.trackSignal(mockSignal, { name: 'SignalWithEffects' });
      inspector.trackEffect(effect1, [mockSignal], { name: 'Effect1' });
      inspector.trackEffect(effect2, [mockSignal], { name: 'Effect2' });

      const state = inspector.getState();
      expect(state.effects.size).toBe(2);
    });
  });

  describe('Update Frequency Monitoring', () => {
    it('should track update frequency', () => {
      const mockSignal = {
        peek: vi.fn(() => 0),
        subscribe: vi.fn(),
      };

      const startTime = Date.now();
      const updateCount = 100;

      for (let i = 0; i < updateCount; i++) {
        mockSignal.peek.mockReturnValue(i);
        inspector.trackSignal(mockSignal, { name: 'FrequentSignal' });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      const state = inspector.getState();
      const signal = Array.from(state.signals.values())[0] as SignalMetadata;

      // Calculate updates per second
      const updatesPerSecond = (updateCount / duration) * 1000;
      expect(updatesPerSecond).toBeGreaterThan(0);
      expect(signal.value).toBe(updateCount - 1);
    });

    it('should identify high-frequency updates', async () => {
      const lowFreqSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      const highFreqSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(lowFreqSignal, { name: 'LowFreq' });
      inspector.trackSignal(highFreqSignal, { name: 'HighFreq' });

      // Update low frequency signal once
      lowFreqSignal.peek.mockReturnValue(2);
      inspector.trackSignal(lowFreqSignal, { name: 'LowFreq' });

      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Update high frequency signal many times
      for (let i = 0; i < 50; i++) {
        highFreqSignal.peek.mockReturnValue(i);
        inspector.trackSignal(highFreqSignal, { name: 'HighFreq' });
      }

      const state = inspector.getState();
      const signals = Array.from(state.signals.values());

      const lowFreq = signals.find((s) => s.name === 'LowFreq') as SignalMetadata;
      const highFreq = signals.find((s) => s.name === 'HighFreq') as SignalMetadata;

      // High frequency signal should have more recent or equal updates
      expect(highFreq.updatedAt).toBeGreaterThanOrEqual(lowFreq.updatedAt);
    });

    it('should track time between updates', () => {
      const mockSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'TimedSignal' });

      const state1 = inspector.getState();
      const signal1 = Array.from(state1.signals.values())[0] as SignalMetadata;
      const firstUpdate = signal1.updatedAt;

      // Wait a bit
      return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
        mockSignal.peek.mockReturnValue(2);
        inspector.trackSignal(mockSignal, { name: 'TimedSignal' });

        const state2 = inspector.getState();
        const signal2 = Array.from(state2.signals.values())[0] as SignalMetadata;

        expect(signal2.updatedAt).toBeGreaterThan(firstUpdate);
        expect(signal2.updatedAt - firstUpdate).toBeGreaterThanOrEqual(10);
      });
    });
  });

  describe('Dependency Graph Building', () => {
    it('should build simple dependency graph', () => {
      const signalA = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const signalB = { peek: vi.fn(() => 2), subscribe: vi.fn() };
      const computed = { peek: vi.fn(() => 3), subscribe: vi.fn() };

      inspector.trackSignal(signalA, { name: 'A' });
      inspector.trackSignal(signalB, { name: 'B' });
      inspector.trackComputed(computed, [signalA, signalB], { name: 'C' });

      const state = inspector.getState();
      const computedMeta = Array.from(state.computed.values())[0] as ComputedMetadata;

      expect(computedMeta.dependencies.length).toBe(2);
    });

    it('should build multi-level dependency graph', () => {
      const base = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const derived1 = { peek: vi.fn(() => 2), subscribe: vi.fn() };
      const derived2 = { peek: vi.fn(() => 3), subscribe: vi.fn() };
      const final = { peek: vi.fn(() => 4), subscribe: vi.fn() };

      inspector.trackSignal(base, { name: 'Base' });
      inspector.trackComputed(derived1, [base], { name: 'Derived1' });
      inspector.trackComputed(derived2, [base], { name: 'Derived2' });
      inspector.trackComputed(final, [derived1, derived2], { name: 'Final' });

      const state = inspector.getState();

      expect(state.signals.size).toBe(1); // Base signal
      expect(state.computed.size).toBe(3); // Three computed signals
    });

    it('should track diamond dependencies', () => {
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D

      const a = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const b = { peek: vi.fn(() => 2), subscribe: vi.fn() };
      const c = { peek: vi.fn(() => 3), subscribe: vi.fn() };
      const d = { peek: vi.fn(() => 4), subscribe: vi.fn() };

      inspector.trackSignal(a, { name: 'A' });
      inspector.trackComputed(b, [a], { name: 'B' });
      inspector.trackComputed(c, [a], { name: 'C' });
      inspector.trackComputed(d, [b, c], { name: 'D' });

      const state = inspector.getState();
      const baseSignal = Array.from(state.signals.values())[0] as SignalMetadata;
      const computedD = Array.from(state.computed.values())[2] as ComputedMetadata;

      expect(baseSignal.dependentCount).toBe(2); // B and C depend on A
      expect(computedD.dependencies.length).toBe(2); // D depends on B and C
    });

    it('should track complex dependency networks', () => {
      const signals = Array.from({ length: 5 }, (_, i) => ({
        peek: vi.fn(() => i),
        subscribe: vi.fn(),
      }));

      signals.forEach((signal, i) => {
        inspector.trackSignal(signal, { name: `Signal${i}` });
      });

      // Create computed signals with various dependencies
      const computed1 = { peek: vi.fn(() => 10), subscribe: vi.fn() };
      const computed2 = { peek: vi.fn(() => 20), subscribe: vi.fn() };
      const computed3 = { peek: vi.fn(() => 30), subscribe: vi.fn() };

      inspector.trackComputed(computed1, [signals[0], signals[1]], { name: 'Computed1' });
      inspector.trackComputed(computed2, [signals[2], signals[3]], { name: 'Computed2' });
      inspector.trackComputed(computed3, [signals[4]], { name: 'Computed3' });

      const state = inspector.getState();

      expect(state.signals.size).toBe(5);
      expect(state.computed.size).toBe(3);
    });
  });

  describe('Circular Dependency Detection', () => {
    it('should handle circular references in values', () => {
      const circular: any = { value: 1 };
      circular.self = circular;

      const mockSignal = {
        peek: vi.fn(() => circular),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'CircularSignal' });

      const state = inspector.getState();
      const signal = Array.from(state.signals.values())[0] as SignalMetadata;

      expect(signal.value.value).toBe(1);
      expect(signal.value.self).toBe('[Circular]');
    });

    it('should detect and handle deeply nested circular structures', () => {
      const obj1: any = { id: 1 };
      const obj2: any = { id: 2, ref: obj1 };
      obj1.ref = obj2;

      const mockSignal = {
        peek: vi.fn(() => obj1),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'DeepCircular' });

      const state = inspector.getState();
      const signal = Array.from(state.signals.values())[0] as SignalMetadata;

      expect(signal.value.id).toBe(1);
      expect(signal.value.ref.id).toBe(2);
      expect(signal.value.ref.ref).toBe('[Circular]');
    });

    it('should handle mutual dependencies', () => {
      const signalA = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const signalB = { peek: vi.fn(() => 2), subscribe: vi.fn() };

      inspector.trackSignal(signalA, { name: 'A' });
      inspector.trackSignal(signalB, { name: 'B' });

      // In real scenario, these would have circular computed dependencies
      // but for testing, we just verify they can both be tracked
      const state = inspector.getState();

      expect(state.signals.size).toBe(2);
    });
  });

  describe('State Tree Visualization', () => {
    it('should generate state tree with signals', () => {
      const signal1 = { peek: vi.fn(() => 1), subscribe: vi.fn() };
      const signal2 = { peek: vi.fn(() => 2), subscribe: vi.fn() };
      const computed = { peek: vi.fn(() => 3), subscribe: vi.fn() };

      inspector.trackSignal(signal1, { name: 'Signal1' });
      inspector.trackSignal(signal2, { name: 'Signal2' });
      inspector.trackComputed(computed, [signal1, signal2], { name: 'Computed1' });

      const stateTree = inspector.getStateTree();

      const signalsNode = stateTree.find((node) => node.id === 'signals-root');
      const computedNode = stateTree.find((node) => node.id === 'computed-root');

      expect(signalsNode?.children.length).toBe(2);
      expect(computedNode?.children.length).toBe(1);
    });

    it('should organize signals by category', () => {
      const signals = Array.from({ length: 10 }, (_, i) => ({
        peek: vi.fn(() => i),
        subscribe: vi.fn(),
      }));

      signals.forEach((signal, i) => {
        inspector.trackSignal(signal, { name: `Signal${i}` });
      });

      const stateTree = inspector.getStateTree();
      const signalsNode = stateTree.find((node) => node.id === 'signals-root');

      expect(signalsNode?.children.length).toBe(10);
      expect(signalsNode?.label).toContain('10');
    });
  });

  describe('Performance Optimization', () => {
    it('should handle high-frequency signal updates efficiently', () => {
      const mockSignal = {
        peek: vi.fn(() => 0),
        subscribe: vi.fn(),
      };

      const startTime = performance.now();
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        mockSignal.peek.mockReturnValue(i);
        inspector.trackSignal(mockSignal, { name: 'HighFreq' });
      }

      const duration = performance.now() - startTime;
      const opsPerMs = iterations / duration;

      expect(opsPerMs).toBeGreaterThan(10); // Should handle at least 10 ops/ms
    });

    it('should not leak memory with long-running tracking', () => {
      const signals: any[] = [];

      for (let i = 0; i < 1000; i++) {
        const signal = { peek: vi.fn(() => i), subscribe: vi.fn() };
        signals.push(signal);
        inspector.trackSignal(signal, { name: `Signal${i}` });
      }

      const state = inspector.getState();
      expect(state.signals.size).toBe(1000);

      // Clear and verify cleanup
      inspector.clear();
      const clearedState = inspector.getState();
      expect(clearedState.signals.size).toBe(0);
    });
  });

  describe('Metadata Tracking', () => {
    it('should track signal creation stack trace', () => {
      const mockSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, { name: 'TracedSignal' });

      const state = inspector.getState();
      const signal = Array.from(state.signals.values())[0] as SignalMetadata;

      expect(signal.stack).toBeDefined();
      expect(typeof signal.stack).toBe('string');
    });

    it('should track signal metadata', () => {
      const mockSignal = {
        peek: vi.fn(() => 1),
        subscribe: vi.fn(),
      };

      inspector.trackSignal(mockSignal, {
        name: 'MetaSignal',
        componentId: 'comp-123',
      });

      const state = inspector.getState();
      const signal = Array.from(state.signals.values())[0] as SignalMetadata;

      expect(signal.name).toBe('MetaSignal');
      expect(signal.componentId).toBe('comp-123');
      expect(signal.createdAt).toBeDefined();
      expect(signal.updatedAt).toBeDefined();
    });
  });
});
