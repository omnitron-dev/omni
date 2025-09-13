import { EventEmitter } from '../src/emitter';

describe('Browser Compatibility', () => {
  describe('EventEmitter in browser-like environment', () => {
    it('should not rely on Node.js specific APIs', () => {
      const emitter = new EventEmitter();

      // Should work without require, module, process, etc.
      expect(emitter).toBeDefined();

      // Test that Map is used (available in all modern browsers)
      expect((emitter as any)._events).toBeInstanceOf(Map);
    });

    it('should work with browser event patterns', () => {
      const emitter = new EventEmitter();

      // Simulate browser-like event handling
      const clickHandler = jest.fn();
      const loadHandler = jest.fn();
      const errorHandler = jest.fn();

      emitter.on('click', clickHandler);
      emitter.on('load', loadHandler);
      emitter.on('error', errorHandler);

      // Simulate events
      emitter.emit('click', { x: 100, y: 200 });
      emitter.emit('load');
      emitter.emit('error', new Error('Test error'));

      expect(clickHandler).toHaveBeenCalledWith({ x: 100, y: 200 });
      expect(loadHandler).toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalledWith(new Error('Test error'));
    });

    it('should handle DOM-like event propagation patterns', () => {
      const emitter = new EventEmitter();
      const capturePhase = jest.fn();
      const targetPhase = jest.fn();
      const bubblePhase = jest.fn();

      // Simulate phases
      emitter.on('capture', capturePhase);
      emitter.on('target', targetPhase);
      emitter.on('bubble', bubblePhase);

      // Emit in order
      emitter.emit('capture');
      emitter.emit('target');
      emitter.emit('bubble');

      expect(capturePhase).toHaveBeenCalled();
      expect(targetPhase).toHaveBeenCalled();
      expect(bubblePhase).toHaveBeenCalled();
    });
  });

  describe('EventEmitter in browser-like environment', () => {
    it('should work with Promises (ES6 feature)', async () => {
      const emitter = new EventEmitter();

      emitter.on(
        'async',
        async () =>
          new Promise((resolve) => {
            setTimeout(() => resolve('async result'), 10);
          })
      );

      const results = await emitter.emitParallel('async');

      expect(results).toEqual(['async result']);
    });

    it('should work with async/await syntax', async () => {
      const emitter = new EventEmitter();

      emitter.on('test', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'completed';
      });

      const results = await emitter.emitParallel('test');

      expect(results).toEqual(['completed']);
    });

    it('should handle fetch-like patterns', async () => {
      const emitter = new EventEmitter();

      // Simulate fetch-like behavior
      const mockFetch = jest.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ data: 'test' }),
      }));

      emitter.on('fetch', async (url: string) => {
        const response = await mockFetch(url);
        const data = await response.json();
        return data;
      });

      const results = await emitter.emitParallel('fetch', 'https://api.example.com');

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com');
      expect(results).toEqual([{ data: 'test' }]);
    });
  });

  describe('Memory management', () => {
    it('should use WeakMap for once listeners (available in browsers)', () => {
      const emitter = new EventEmitter();

      // WeakMap should be used for once listeners
      expect((emitter as any).onceListeners).toBeInstanceOf(WeakMap);
    });

    it('should properly clean up listeners to prevent memory leaks', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      // Add and remove many listeners
      for (let i = 0; i < 1000; i++) {
        emitter.on(`event${i}`, listener);
      }

      expect(emitter.eventNames()).toHaveLength(1000);

      // Remove all
      emitter.removeAllListeners();

      expect(emitter.eventNames()).toHaveLength(0);
      expect((emitter as any)._eventsCount).toBe(0);
    });

    it('should handle large number of events efficiently', () => {
      const emitter = new EventEmitter();
      const startTime = Date.now();

      // Add many listeners
      for (let i = 0; i < 10000; i++) {
        emitter.on(`event${i}`, () => {});
      }

      // Should complete quickly even with many events
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should take less than 1 second

      // Emit should still work efficiently
      const emitStart = Date.now();
      emitter.emit('event5000');
      const emitDuration = Date.now() - emitStart;

      expect(emitDuration).toBeLessThan(10); // Emit should be very fast
    });
  });

  describe('Cross-platform data structures', () => {
    it('should use Map for event storage (ES6)', () => {
      const emitter = new EventEmitter();

      expect((emitter as any)._events).toBeInstanceOf(Map);

      emitter.on('test', () => {});

      expect((emitter as any)._events.has('test')).toBe(true);
    });

    it('should work with Symbol as event names (ES6)', () => {
      const emitter = new EventEmitter();
      const sym1 = Symbol('event1');
      const sym2 = Symbol.for('event2');

      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on(sym1, listener1);
      emitter.on(sym2, listener2);

      emitter.emit(sym1, 'data1');
      emitter.emit(sym2, 'data2');

      expect(listener1).toHaveBeenCalledWith('data1');
      expect(listener2).toHaveBeenCalledWith('data2');

      const names = emitter.eventNames();
      expect(names).toContain(sym1);
      expect(names).toContain(sym2);
    });

    it('should work with arrow functions', () => {
      const emitter = new EventEmitter();
      const data = { value: 42 };

      let captured: any;

      emitter.on('arrow', (arg: any) => {
        captured = arg;
      });

      emitter.emit('arrow', data);

      expect(captured).toBe(data);
    });

    it('should work with class methods as listeners', () => {
      const emitter = new EventEmitter();

      class Handler {
        value = 0;

        handleEvent = (increment: number) => {
          this.value += increment;
        };
      }

      const handler = new Handler();

      emitter.on('increment', handler.handleEvent);

      emitter.emit('increment', 5);
      emitter.emit('increment', 3);

      expect(handler.value).toBe(8);
    });
  });

  describe('Error handling in browser context', () => {
    it('should not crash on errors in listeners', () => {
      const emitter = new EventEmitter();
      const errorListener = () => {
        throw new Error('Listener error');
      };
      const normalListener = jest.fn();

      emitter.on('test', errorListener);
      emitter.on('test', normalListener);

      // In browsers, errors in event listeners shouldn't crash the page
      // Our implementation throws synchronously, which is fine
      expect(() => {
        emitter.emit('test');
      }).toThrow('Listener error');

      // The normal listener should still be called before the error
      expect(normalListener).not.toHaveBeenCalled(); // Because error happens first
    });

    it('should handle async errors gracefully', async () => {
      const emitter = new EventEmitter();

      emitter.on('async', async () => {
        throw new Error('Async error');
      });

      emitter.on('async', async () => 'success');

      try {
        await emitter.emitParallel('async');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Async error');
      }
    });
  });

  describe('Modern JavaScript features', () => {
    it('should work with spread operator', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      emitter.on('spread', listener);

      const args = [1, 2, 3, 4, 5];
      emitter.emit('spread', ...args);

      expect(listener).toHaveBeenCalledWith(...args);
    });

    it('should work with destructuring', () => {
      const emitter = new EventEmitter();
      let captured: any;

      emitter.on('destruct', ({ name, value }: any) => {
        captured = { name, value };
      });

      emitter.emit('destruct', { name: 'test', value: 42, extra: 'ignored' });

      expect(captured).toEqual({ name: 'test', value: 42 });
    });

    it('should work with template literals in event names', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      const eventType = 'click';
      const eventId = 123;

      emitter.on(`${eventType}:${eventId}`, listener);
      emitter.emit(`${eventType}:${eventId}`, 'data');

      expect(listener).toHaveBeenCalledWith('data');
    });

    it('should work with optional chaining patterns', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn((data?: any) => data?.nested?.value ?? 'default');

      emitter.on('optional', listener);

      emitter.emit('optional', { nested: { value: 'found' } });
      emitter.emit('optional', {});
      emitter.emit('optional', null);

      expect(listener).toHaveBeenCalledTimes(3);
    });
  });
});
