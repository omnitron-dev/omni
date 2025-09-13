import { EventEmitter } from '../src/emitter';

describe('EventEmitter', () => {
  describe('Basic functionality', () => {
    it('should create an instance', () => {
      const emitter = new EventEmitter();
      expect(emitter).toBeDefined();
      expect(emitter).toBeInstanceOf(EventEmitter);
    });

    it('should emit and listen to events', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      emitter.on('test', listener);
      emitter.emit('test', 'arg1', 'arg2');

      expect(listener).toHaveBeenCalledWith('arg1', 'arg2');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should support multiple listeners for the same event', () => {
      const emitter = new EventEmitter();
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.on('test', listener3);

      emitter.emit('test', 'data');

      expect(listener1).toHaveBeenCalledWith('data');
      expect(listener2).toHaveBeenCalledWith('data');
      expect(listener3).toHaveBeenCalledWith('data');
    });

    it('should support symbol event names', () => {
      const emitter = new EventEmitter();
      const sym = Symbol('test');
      const listener = jest.fn();

      emitter.on(sym, listener);
      emitter.emit(sym, 'data');

      expect(listener).toHaveBeenCalledWith('data');
    });

    it('should return true when emit has listeners, false otherwise', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      expect(emitter.emit('test')).toBe(false);

      emitter.on('test', listener);
      expect(emitter.emit('test')).toBe(true);
    });
  });

  describe('once() method', () => {
    it('should only call listener once', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      emitter.once('test', listener);

      emitter.emit('test', 'first');
      emitter.emit('test', 'second');
      emitter.emit('test', 'third');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('first');
    });

    it('should work with multiple once listeners', () => {
      const emitter = new EventEmitter();
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.once('test', listener1);
      emitter.once('test', listener2);

      emitter.emit('test', 'data');

      expect(listener1).toHaveBeenCalledWith('data');
      expect(listener2).toHaveBeenCalledWith('data');

      emitter.emit('test', 'data2');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should work mixed with regular listeners', () => {
      const emitter = new EventEmitter();
      const onceListener = jest.fn();
      const regularListener = jest.fn();

      emitter.once('test', onceListener);
      emitter.on('test', regularListener);

      emitter.emit('test');
      emitter.emit('test');

      expect(onceListener).toHaveBeenCalledTimes(1);
      expect(regularListener).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeListener() method', () => {
    it('should remove a specific listener', () => {
      const emitter = new EventEmitter();
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);

      emitter.removeListener('test', listener1);
      emitter.emit('test');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should handle removing non-existent listener gracefully', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      expect(() => {
        emitter.removeListener('test', listener);
      }).not.toThrow();
    });

    it('should handle removing from non-existent event gracefully', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      expect(() => {
        emitter.removeListener('nonexistent', listener);
      }).not.toThrow();
    });

    it('should work with off() alias', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      emitter.on('test', listener);
      emitter.off('test', listener);
      emitter.emit('test');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('removeAllListeners() method', () => {
    it('should remove all listeners for a specific event', () => {
      const emitter = new EventEmitter();
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.on('other', listener3);

      emitter.removeAllListeners('test');

      emitter.emit('test');
      emitter.emit('other');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(listener3).toHaveBeenCalled();
    });

    it('should remove all listeners when no event specified', () => {
      const emitter = new EventEmitter();
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      emitter.on('test1', listener1);
      emitter.on('test2', listener2);
      emitter.on('test3', listener3);

      emitter.removeAllListeners();

      emitter.emit('test1');
      emitter.emit('test2');
      emitter.emit('test3');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(listener3).not.toHaveBeenCalled();
    });
  });

  describe('listeners() method', () => {
    it('should return array of listeners for an event', () => {
      const emitter = new EventEmitter();
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);

      const listeners = emitter.listeners('test');

      expect(listeners).toHaveLength(2);
      expect(listeners).toContain(listener1);
      expect(listeners).toContain(listener2);
    });

    it('should return empty array for non-existent event', () => {
      const emitter = new EventEmitter();

      const listeners = emitter.listeners('nonexistent');

      expect(listeners).toEqual([]);
    });

    it('should return array with single listener', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      emitter.on('test', listener);

      const listeners = emitter.listeners('test');

      expect(listeners).toHaveLength(1);
      expect(listeners[0]).toBe(listener);
    });
  });

  describe('listenerCount() method', () => {
    it('should return correct listener count', () => {
      const emitter = new EventEmitter();

      expect(emitter.listenerCount('test')).toBe(0);

      emitter.on('test', () => {});
      expect(emitter.listenerCount('test')).toBe(1);

      emitter.on('test', () => {});
      expect(emitter.listenerCount('test')).toBe(2);

      emitter.on('test', () => {});
      expect(emitter.listenerCount('test')).toBe(3);
    });

    it('should return 0 for non-existent event', () => {
      const emitter = new EventEmitter();

      expect(emitter.listenerCount('nonexistent')).toBe(0);
    });

    it('should update count when listeners are removed', () => {
      const emitter = new EventEmitter();
      const listener1 = () => {};
      const listener2 = () => {};

      emitter.on('test', listener1);
      emitter.on('test', listener2);

      expect(emitter.listenerCount('test')).toBe(2);

      emitter.removeListener('test', listener1);
      expect(emitter.listenerCount('test')).toBe(1);

      emitter.removeListener('test', listener2);
      expect(emitter.listenerCount('test')).toBe(0);
    });
  });

  describe('eventNames() method', () => {
    it('should return array of event names', () => {
      const emitter = new EventEmitter();

      emitter.on('event1', () => {});
      emitter.on('event2', () => {});
      emitter.on('event3', () => {});

      const names = emitter.eventNames();

      expect(names).toHaveLength(3);
      expect(names).toContain('event1');
      expect(names).toContain('event2');
      expect(names).toContain('event3');
    });

    it('should return empty array when no events', () => {
      const emitter = new EventEmitter();

      const names = emitter.eventNames();

      expect(names).toEqual([]);
    });

    it('should include symbol event names', () => {
      const emitter = new EventEmitter();
      const sym1 = Symbol('test1');
      const sym2 = Symbol('test2');

      emitter.on('string', () => {});
      emitter.on(sym1, () => {});
      emitter.on(sym2, () => {});

      const names = emitter.eventNames();

      expect(names).toHaveLength(3);
      expect(names).toContain('string');
      expect(names).toContain(sym1);
      expect(names).toContain(sym2);
    });
  });

  describe('addListener() method', () => {
    it('should work as alias for on()', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      emitter.addListener('test', listener);
      emitter.emit('test', 'data');

      expect(listener).toHaveBeenCalledWith('data');
    });

    it('should throw TypeError for non-function listener', () => {
      const emitter = new EventEmitter();

      expect(() => {
        emitter.addListener('test', 'not a function' as any);
      }).toThrow(TypeError);

      expect(() => {
        emitter.addListener('test', 'not a function' as any);
      }).toThrow('The listener must be a function');
    });
  });

  describe('context handling', () => {
    it('should use provided context', () => {
      const emitter = new EventEmitter();
      const context = { value: 42 };
      let capturedThis: any;

      const listener = function (this: any) {
        capturedThis = this;
      };

      emitter.on('test', listener, context);
      emitter.emit('test');

      expect(capturedThis).toBe(context);
    });

    it('should use emitter as default context', () => {
      const emitter = new EventEmitter();
      let capturedThis: any;

      const listener = function (this: any) {
        capturedThis = this;
      };

      emitter.on('test', listener);
      emitter.emit('test');

      expect(capturedThis).toBe(emitter);
    });

    it('should handle context with once listeners', () => {
      const emitter = new EventEmitter();
      const context = { value: 42 };
      let capturedThis: any;

      const listener = function (this: any) {
        capturedThis = this;
      };

      emitter.once('test', listener, context);
      emitter.emit('test');

      expect(capturedThis).toBe(context);
    });
  });

  describe('edge cases', () => {
    it('should handle removing listener during emit', () => {
      const emitter = new EventEmitter();
      const listener2 = jest.fn();

      const listener1 = jest.fn(() => {
        emitter.removeListener('test', listener2);
      });

      emitter.on('test', listener1);
      emitter.on('test', listener2);

      emitter.emit('test');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled(); // Should still be called as we iterate over a copy
    });

    it('should handle adding listener during emit', () => {
      const emitter = new EventEmitter();
      const listener2 = jest.fn();

      const listener1 = jest.fn(() => {
        emitter.on('test', listener2);
      });

      emitter.on('test', listener1);

      emitter.emit('test');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled(); // Should not be called in the same emit

      emitter.emit('test');

      expect(listener2).toHaveBeenCalled(); // Should be called in the next emit
    });

    it('should handle multiple arguments in emit', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      emitter.on('test', listener);
      emitter.emit('test', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

      expect(listener).toHaveBeenCalledWith(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    });

    it('should handle no arguments in emit', () => {
      const emitter = new EventEmitter();
      const listener = jest.fn();

      emitter.on('test', listener);
      emitter.emit('test');

      expect(listener).toHaveBeenCalledWith();
    });

    it('should maintain correct event count', () => {
      const emitter = new EventEmitter();

      // Access private property for testing
      expect((emitter as any)._eventsCount).toBe(0);

      emitter.on('event1', () => {});
      expect((emitter as any)._eventsCount).toBe(1);

      emitter.on('event2', () => {});
      expect((emitter as any)._eventsCount).toBe(2);

      emitter.on('event1', () => {}); // Add another listener to existing event
      expect((emitter as any)._eventsCount).toBe(2); // Count should not increase

      emitter.removeAllListeners('event1');
      expect((emitter as any)._eventsCount).toBe(1);

      emitter.removeAllListeners();
      expect((emitter as any)._eventsCount).toBe(0);
    });
  });

  describe('chaining', () => {
    it('should support method chaining', () => {
      const emitter = new EventEmitter();
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      const result = emitter
        .on('test1', listener1)
        .on('test2', listener2)
        .once('test3', listener3)
        .removeListener('test1', listener1)
        .removeAllListeners('test2');

      expect(result).toBe(emitter);
    });
  });

  describe('compatibility', () => {
    it('should work with typeof checks', () => {
      const emitter = new EventEmitter();

      expect(typeof emitter.on).toBe('function');
      expect(typeof emitter.emit).toBe('function');
      expect(typeof emitter.once).toBe('function');
      expect(typeof emitter.removeListener).toBe('function');
      expect(typeof emitter.removeAllListeners).toBe('function');
      expect(typeof emitter.listeners).toBe('function');
      expect(typeof emitter.listenerCount).toBe('function');
      expect(typeof emitter.eventNames).toBe('function');
    });

    it('should be extensible', () => {
      class CustomEmitter extends EventEmitter {
        customMethod() {
          return 'custom';
        }
      }

      const emitter = new CustomEmitter();
      const listener = jest.fn();

      emitter.on('test', listener);
      emitter.emit('test', 'data');

      expect(listener).toHaveBeenCalledWith('data');
      expect(emitter.customMethod()).toBe('custom');
    });
  });
});
