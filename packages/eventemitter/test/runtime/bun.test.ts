/**
 * Bun-specific test suite for EventEmitter
 * Uses Bun's built-in test runner and mock functions
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { EventEmitter } from '../../src/emitter';
import { EnhancedEmitter } from '../../src/enhanced-emitter';
import { delay } from '@omnitron-dev/common';

describe('EventEmitter (Bun)', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  describe('Basic functionality', () => {
    test('should create an instance', () => {
      expect(emitter).toBeDefined();
      expect(emitter).toBeInstanceOf(EventEmitter);
    });

    test('should emit and listen to events', () => {
      const listener = mock(() => {});
      
      emitter.on('test', listener);
      emitter.emit('test', 'arg1', 'arg2');
      
      expect(listener).toHaveBeenCalledWith('arg1', 'arg2');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('should support multiple listeners for the same event', () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});
      const listener3 = mock(() => {});
      
      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.on('test', listener3);
      
      emitter.emit('test', 'data');
      
      expect(listener1).toHaveBeenCalledWith('data');
      expect(listener2).toHaveBeenCalledWith('data');
      expect(listener3).toHaveBeenCalledWith('data');
    });

    test('should support symbol event names', () => {
      const sym = Symbol('test');
      const listener = mock(() => {});
      
      emitter.on(sym, listener);
      emitter.emit(sym, 'data');
      
      expect(listener).toHaveBeenCalledWith('data');
    });

    test('should return true when emit has listeners, false otherwise', () => {
      const listener = mock(() => {});
      
      expect(emitter.emit('test')).toBe(false);
      
      emitter.on('test', listener);
      expect(emitter.emit('test')).toBe(true);
    });
  });

  describe('once() method', () => {
    test('should only call listener once', () => {
      const listener = mock(() => {});
      
      emitter.once('test', listener);
      emitter.emit('test', 'first');
      emitter.emit('test', 'second');
      emitter.emit('test', 'third');
      
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('first');
    });

    test('should return a promise when no callback is provided', async () => {
      const promise = emitter.once('test');
      
      setTimeout(() => {
        emitter.emit('test', 'value');
      }, 10);
      
      const result = await promise;
      expect(result).toEqual(['value']);
    });
  });

  describe('off() method', () => {
    test('should remove a listener', () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});
      
      emitter.on('test', listener1);
      emitter.on('test', listener2);
      
      emitter.off('test', listener1);
      emitter.emit('test');
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    test('should remove all listeners for an event when no listener specified', () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});
      
      emitter.on('test', listener1);
      emitter.on('test', listener2);
      
      emitter.off('test');
      emitter.emit('test');
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe('removeAllListeners() method', () => {
    test('should remove all listeners for all events', () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});
      const listener3 = mock(() => {});
      
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

    test('should remove all listeners for specified event', () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});
      const listener3 = mock(() => {});
      
      emitter.on('test1', listener1);
      emitter.on('test1', listener2);
      emitter.on('test2', listener3);
      
      emitter.removeAllListeners('test1');
      
      emitter.emit('test1');
      emitter.emit('test2');
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(listener3).toHaveBeenCalledTimes(1);
    });
  });

  describe('Async functionality', () => {
    test('should emit events asynchronously', async () => {
      const results: string[] = [];
      const listener1 = mock(async () => {
        await delay(10);
        results.push('listener1');
      });
      const listener2 = mock(async () => {
        await delay(5);
        results.push('listener2');
      });
      
      emitter.on('test', listener1);
      emitter.on('test', listener2);
      
      await emitter.emitAsync('test');
      
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(results).toEqual(['listener2', 'listener1']);
    });

    test('should emit events in serial', async () => {
      const results: string[] = [];
      const listener1 = mock(async () => {
        await delay(10);
        results.push('listener1');
      });
      const listener2 = mock(async () => {
        await delay(5);
        results.push('listener2');
      });
      
      emitter.on('test', listener1);
      emitter.on('test', listener2);
      
      await emitter.emitAsyncSerial('test');
      
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(results).toEqual(['listener1', 'listener2']);
    });
  });

  describe('waitFor() method', () => {
    test('should wait for an event with timeout', async () => {
      setTimeout(() => {
        emitter.emit('test', 'data');
      }, 50);
      
      const result = await emitter.waitFor('test', 100);
      expect(result).toEqual(['data']);
    });

    test('should timeout when event is not emitted', async () => {
      try {
        await emitter.waitFor('test', 50);
        expect(false).toBe(true); // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('Timeout waiting for event');
      }
    });
  });
});

describe('EnhancedEmitter (Bun)', () => {
  let emitter: EnhancedEmitter;

  beforeEach(() => {
    emitter = new EnhancedEmitter();
  });

  describe('Enhanced functionality', () => {
    test('should create an enhanced emitter instance', () => {
      expect(emitter).toBeDefined();
      expect(emitter).toBeInstanceOf(EnhancedEmitter);
    });

    test('should support piping events to another emitter', () => {
      const target = new EnhancedEmitter();
      const listener = mock(() => {});
      
      target.on('test', listener);
      emitter.pipe(target, ['test']);
      
      emitter.emit('test', 'data');
      
      expect(listener).toHaveBeenCalledWith('data');
    });

    test('should support interceptors', () => {
      const interceptor = mock((event: string, args: any[]) => {
        if (event === 'test') {
          return ['modified', ...args.slice(1)];
        }
        return args;
      });
      
      emitter.intercept(interceptor);
      
      const listener = mock(() => {});
      emitter.on('test', listener);
      
      emitter.emit('test', 'original', 'data');
      
      expect(interceptor).toHaveBeenCalledWith('test', ['original', 'data']);
      expect(listener).toHaveBeenCalledWith('modified', 'data');
    });

    test('should support middleware', () => {
      const results: string[] = [];
      
      emitter.use(async (context, next) => {
        results.push('before');
        await next();
        results.push('after');
      });
      
      const listener = mock(() => {
        results.push('listener');
      });
      
      emitter.on('test', listener);
      emitter.emit('test');
      
      // Middleware is async, so we need to wait a bit
      setTimeout(() => {
        expect(results).toEqual(['before', 'listener', 'after']);
      }, 10);
    });
  });

  describe('Namespace support', () => {
    test('should support namespaced events', () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});
      const listener3 = mock(() => {});
      
      emitter.on('app:user:login', listener1);
      emitter.on('app:user:logout', listener2);
      emitter.on('app:system:ready', listener3);
      
      // Emit to specific namespace
      emitter.emit('app:user:*', 'data');
      
      expect(listener1).toHaveBeenCalledWith('data');
      expect(listener2).toHaveBeenCalledWith('data');
      expect(listener3).not.toHaveBeenCalled();
    });
  });

  describe('Typed events', () => {
    interface MyEvents {
      'user:login': { userId: string; timestamp: number };
      'user:logout': { userId: string };
      'data:update': { id: string; value: any };
    }

    test('should support typed events', () => {
      const typedEmitter = new EnhancedEmitter<MyEvents>();
      const listener = mock((data: { userId: string; timestamp: number }) => {
        expect(data.userId).toBe('123');
        expect(data.timestamp).toBeGreaterThan(0);
      });
      
      typedEmitter.on('user:login', listener);
      typedEmitter.emit('user:login', { userId: '123', timestamp: Date.now() });
      
      expect(listener).toHaveBeenCalled();
    });
  });
});

// Test Runtime Detection
describe('Runtime Detection (Bun)', () => {
  test('should detect Bun runtime', () => {
    expect(typeof Bun).toBe('object');
    expect(Bun.version).toBeDefined();
  });

  test('should have access to Bun-specific APIs', () => {
    expect(typeof Bun.file).toBe('function');
    expect(typeof Bun.write).toBe('function');
  });
});