import { vi } from 'vitest';
import { EventEmitter } from '../src/emitter';

describe('EventEmitter - emit() optimization', () => {
  describe('hasOnceListener tracking', () => {
    it('should not have hasOnceListener flag when no once listeners exist', () => {
      const emitter = new EventEmitter();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);

      // Access private field to verify tracking
      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();
    });

    it('should set hasOnceListener flag when once listener is added via addListener', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      emitter.addListener('test', listener, undefined, true);

      // Access private field to verify tracking
      expect((emitter as any).hasOnceListener.get('test')).toBe(true);
    });

    it('should clear hasOnceListener flag when last once listener is removed', () => {
      const emitter = new EventEmitter();
      const onceListener = vi.fn();
      const regularListener = vi.fn();

      emitter.on('test', regularListener);
      emitter.addListener('test', onceListener, undefined, true);

      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      // Remove the once listener
      emitter.removeListener('test', onceListener);

      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();
    });

    it('should keep hasOnceListener flag when some once listeners remain', () => {
      const emitter = new EventEmitter();
      const onceListener1 = vi.fn();
      const onceListener2 = vi.fn();

      emitter.addListener('test', onceListener1, undefined, true);
      emitter.addListener('test', onceListener2, undefined, true);

      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      // Remove one once listener
      emitter.removeListener('test', onceListener1);

      // Should still be true because onceListener2 remains
      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      // Remove the last once listener
      emitter.removeListener('test', onceListener2);

      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();
    });

    it('should clear hasOnceListener flag when all listeners are removed', () => {
      const emitter = new EventEmitter();

      emitter.addListener('test', vi.fn(), undefined, true);
      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      emitter.removeAllListeners('test');
      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();
    });

    it('should clear all hasOnceListener flags when removeAllListeners() is called without event', () => {
      const emitter = new EventEmitter();

      emitter.addListener('event1', vi.fn(), undefined, true);
      emitter.addListener('event2', vi.fn(), undefined, true);

      expect((emitter as any).hasOnceListener.size).toBe(2);

      emitter.removeAllListeners();

      expect((emitter as any).hasOnceListener.size).toBe(0);
    });
  });

  describe('emit behavior with optimization', () => {
    it('should emit correctly with regular listeners (no array copy)', () => {
      const emitter = new EventEmitter();
      const results: number[] = [];

      emitter.on('test', (n: number) => results.push(n * 2));
      emitter.on('test', (n: number) => results.push(n * 3));
      emitter.on('test', (n: number) => results.push(n * 4));

      emitter.emit('test', 5);

      expect(results).toEqual([10, 15, 20]);
      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();
    });

    it('should emit correctly with once listeners (array copy)', () => {
      const emitter = new EventEmitter();
      const results: number[] = [];

      emitter.on('test', (n: number) => results.push(n * 2));
      emitter.addListener('test', (n: number) => results.push(n * 3), undefined, true);

      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      emitter.emit('test', 5);

      expect(results).toEqual([10, 15]);

      // After emit, once listener should be removed
      emitter.emit('test', 5);

      expect(results).toEqual([10, 15, 10]); // Only regular listener fires
      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();
    });

    it('should handle mixed once and regular listeners correctly', () => {
      const emitter = new EventEmitter();
      const callOrder: string[] = [];

      emitter.on('test', () => callOrder.push('regular1'));
      emitter.addListener('test', () => callOrder.push('once1'), undefined, true);
      emitter.on('test', () => callOrder.push('regular2'));
      emitter.addListener('test', () => callOrder.push('once2'), undefined, true);

      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      emitter.emit('test');

      expect(callOrder).toEqual(['regular1', 'once1', 'regular2', 'once2']);

      callOrder.length = 0;
      emitter.emit('test');

      expect(callOrder).toEqual(['regular1', 'regular2']); // Only regular listeners
      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();
    });

    it('should handle removal during emit with optimization', () => {
      const emitter = new EventEmitter();
      const callOrder: string[] = [];
      const listener2 = () => callOrder.push('listener2');

      emitter.on('test', () => {
        callOrder.push('listener1');
        emitter.removeListener('test', listener2);
      });
      emitter.on('test', listener2);
      emitter.on('test', () => callOrder.push('listener3'));

      // No once listeners, so no array copy
      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();

      emitter.emit('test');

      // listener2 should still be called because we're not copying array
      expect(callOrder).toEqual(['listener1', 'listener2', 'listener3']);
    });

    it('should handle removal during emit with once listeners (array copy)', () => {
      const emitter = new EventEmitter();
      const callOrder: string[] = [];
      const listener2 = () => callOrder.push('listener2');

      emitter.on('test', () => {
        callOrder.push('listener1');
        emitter.removeListener('test', listener2);
      });
      emitter.on('test', listener2);
      emitter.addListener('test', () => callOrder.push('once1'), undefined, true);

      // Has once listeners, so array will be copied
      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      emitter.emit('test');

      // listener2 should still be called because we're iterating over a copy
      expect(callOrder).toEqual(['listener1', 'listener2', 'once1']);
    });
  });

  describe('optimization behavior verification', () => {
    it('should avoid array copy when no once listeners exist', () => {
      const emitter = new EventEmitter();
      const NUM_LISTENERS = 10;
      const calls: number[] = [];

      // Add regular listeners
      for (let i = 0; i < NUM_LISTENERS; i++) {
        emitter.on('data', () => calls.push(i));
      }

      // Verify no hasOnceListener flag
      expect((emitter as any).hasOnceListener.get('data')).toBeUndefined();

      // Emit - should NOT copy array
      emitter.emit('data');
      expect(calls.length).toBe(NUM_LISTENERS);
    });

    it('should copy array when once listeners exist', () => {
      const emitter = new EventEmitter();
      const NUM_LISTENERS = 10;
      const calls: number[] = [];

      // Add regular listeners
      for (let i = 0; i < NUM_LISTENERS - 1; i++) {
        emitter.on('data', () => calls.push(i));
      }

      // Add one once listener
      emitter.addListener('data', () => calls.push(99), undefined, true);

      // Verify hasOnceListener flag is set
      expect((emitter as any).hasOnceListener.get('data')).toBe(true);

      // Emit - should copy array
      emitter.emit('data');
      expect(calls.length).toBe(NUM_LISTENERS);

      // After emit, once listener is removed
      expect((emitter as any).hasOnceListener.get('data')).toBeUndefined();
    });

    it('optimization reduces unnecessary operations for high-frequency events', () => {
      // This test verifies the optimization works correctly over many iterations
      const emitter = new EventEmitter();
      const ITERATIONS = 1000;
      let callCount = 0;

      emitter.on('data', () => callCount++);
      emitter.on('data', () => callCount++);
      emitter.on('data', () => callCount++);

      // No once listeners - optimized path
      expect((emitter as any).hasOnceListener.get('data')).toBeUndefined();

      for (let i = 0; i < ITERATIONS; i++) {
        emitter.emit('data');
      }

      // All listeners should have been called
      expect(callCount).toBe(ITERATIONS * 3);
    });
  });

  describe('edge cases', () => {
    it('should handle single listener with once flag', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      emitter.addListener('test', listener, undefined, true);

      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      emitter.emit('test');
      expect(listener).toHaveBeenCalledTimes(1);

      emitter.emit('test');
      expect(listener).toHaveBeenCalledTimes(1); // Still only once

      // Should be cleaned up
      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();
    });

    it('should handle Symbol event names with optimization', () => {
      const emitter = new EventEmitter();
      const sym = Symbol('test');
      const listener = vi.fn();

      emitter.on(sym, listener);

      expect((emitter as any).hasOnceListener.get(sym)).toBeUndefined();

      emitter.addListener(sym, vi.fn(), undefined, true);

      expect((emitter as any).hasOnceListener.get(sym)).toBe(true);
    });

    it('should properly track after removing and re-adding once listeners', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      emitter.addListener('test', listener, undefined, true);
      expect((emitter as any).hasOnceListener.get('test')).toBe(true);

      emitter.removeListener('test', listener);
      expect((emitter as any).hasOnceListener.get('test')).toBeUndefined();

      emitter.addListener('test', listener, undefined, true);
      expect((emitter as any).hasOnceListener.get('test')).toBe(true);
    });
  });
});
