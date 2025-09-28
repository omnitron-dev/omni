/**
 * Deno-specific test suite for EventEmitter
 * Uses Deno's built-in test runner and assertions
 */

import { describe, it } from "https://deno.land/std@0.218.0/testing/bdd.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertExists,
} from "https://deno.land/std@0.218.0/assert/mod.ts";
import { EventEmitter } from '../../src/emitter.ts';
import { EnhancedEmitter } from '../../src/enhanced-emitter.ts';

// Mock function helper for Deno
class MockFunction<T extends (...args: any[]) => any> {
  private calls: Array<Parameters<T>> = [];
  private implementation?: T;

  constructor(implementation?: T) {
    this.implementation = implementation;
  }

  get fn(): T {
    return ((...args: Parameters<T>) => {
      this.calls.push(args);
      if (this.implementation) {
        return this.implementation(...args);
      }
    }) as T;
  }

  getCalls(): Array<Parameters<T>> {
    return this.calls;
  }

  getCallCount(): number {
    return this.calls.length;
  }

  wasCalledWith(...args: Parameters<T>): boolean {
    return this.calls.some(call => 
      JSON.stringify(call) === JSON.stringify(args)
    );
  }

  wasCalled(): boolean {
    return this.calls.length > 0;
  }

  reset(): void {
    this.calls = [];
  }
}

describe('EventEmitter (Deno)', () => {
  describe('Basic functionality', () => {
    it('should create an instance', () => {
      const emitter = new EventEmitter();
      assertExists(emitter);
      assertInstanceOf(emitter, EventEmitter);
    });

    it('should emit and listen to events', () => {
      const emitter = new EventEmitter();
      const listener = new MockFunction<(arg1: string, arg2: string) => void>();
      
      emitter.on('test', listener.fn);
      emitter.emit('test', 'arg1', 'arg2');
      
      assertEquals(listener.getCallCount(), 1);
      assertEquals(listener.wasCalledWith('arg1', 'arg2'), true);
    });

    it('should support multiple listeners for the same event', () => {
      const emitter = new EventEmitter();
      const listener1 = new MockFunction<(data: string) => void>();
      const listener2 = new MockFunction<(data: string) => void>();
      const listener3 = new MockFunction<(data: string) => void>();
      
      emitter.on('test', listener1.fn);
      emitter.on('test', listener2.fn);
      emitter.on('test', listener3.fn);
      
      emitter.emit('test', 'data');
      
      assertEquals(listener1.wasCalledWith('data'), true);
      assertEquals(listener2.wasCalledWith('data'), true);
      assertEquals(listener3.wasCalledWith('data'), true);
    });

    it('should support symbol event names', () => {
      const emitter = new EventEmitter();
      const sym = Symbol('test');
      const listener = new MockFunction<(data: string) => void>();
      
      emitter.on(sym, listener.fn);
      emitter.emit(sym, 'data');
      
      assertEquals(listener.wasCalledWith('data'), true);
    });

    it('should return true when emit has listeners, false otherwise', () => {
      const emitter = new EventEmitter();
      const listener = new MockFunction();
      
      assertEquals(emitter.emit('test'), false);
      
      emitter.on('test', listener.fn);
      assertEquals(emitter.emit('test'), true);
    });
  });

  describe('once() method', () => {
    it('should only call listener once', () => {
      const emitter = new EventEmitter();
      const listener = new MockFunction<(arg: string) => void>();
      
      emitter.once('test', listener.fn);
      emitter.emit('test', 'first');
      emitter.emit('test', 'second');
      emitter.emit('test', 'third');
      
      assertEquals(listener.getCallCount(), 1);
      assertEquals(listener.wasCalledWith('first'), true);
    });

    it('should return a promise when no callback is provided', async () => {
      const emitter = new EventEmitter();
      const promise = emitter.once('test');
      
      setTimeout(() => {
        emitter.emit('test', 'value');
      }, 10);
      
      const result = await promise;
      assertEquals(result, ['value']);
    });
  });

  describe('off() method', () => {
    it('should remove a listener', () => {
      const emitter = new EventEmitter();
      const listener1 = new MockFunction();
      const listener2 = new MockFunction();
      
      emitter.on('test', listener1.fn);
      emitter.on('test', listener2.fn);
      
      emitter.off('test', listener1.fn);
      emitter.emit('test');
      
      assertEquals(listener1.wasCalled(), false);
      assertEquals(listener2.getCallCount(), 1);
    });

    it('should remove all listeners for an event when no listener specified', () => {
      const emitter = new EventEmitter();
      const listener1 = new MockFunction();
      const listener2 = new MockFunction();
      
      emitter.on('test', listener1.fn);
      emitter.on('test', listener2.fn);
      
      emitter.off('test');
      emitter.emit('test');
      
      assertEquals(listener1.wasCalled(), false);
      assertEquals(listener2.wasCalled(), false);
    });
  });

  describe('removeAllListeners() method', () => {
    it('should remove all listeners for all events', () => {
      const emitter = new EventEmitter();
      const listener1 = new MockFunction();
      const listener2 = new MockFunction();
      const listener3 = new MockFunction();
      
      emitter.on('test1', listener1.fn);
      emitter.on('test2', listener2.fn);
      emitter.on('test3', listener3.fn);
      
      emitter.removeAllListeners();
      
      emitter.emit('test1');
      emitter.emit('test2');
      emitter.emit('test3');
      
      assertEquals(listener1.wasCalled(), false);
      assertEquals(listener2.wasCalled(), false);
      assertEquals(listener3.wasCalled(), false);
    });

    it('should remove all listeners for specified event', () => {
      const emitter = new EventEmitter();
      const listener1 = new MockFunction();
      const listener2 = new MockFunction();
      const listener3 = new MockFunction();
      
      emitter.on('test1', listener1.fn);
      emitter.on('test1', listener2.fn);
      emitter.on('test2', listener3.fn);
      
      emitter.removeAllListeners('test1');
      
      emitter.emit('test1');
      emitter.emit('test2');
      
      assertEquals(listener1.wasCalled(), false);
      assertEquals(listener2.wasCalled(), false);
      assertEquals(listener3.getCallCount(), 1);
    });
  });

  describe('Async functionality', () => {
    it('should emit events asynchronously', async () => {
      const emitter = new EventEmitter();
      const results: string[] = [];
      
      const listener1 = new MockFunction(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push('listener1');
      });
      
      const listener2 = new MockFunction(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        results.push('listener2');
      });
      
      emitter.on('test', listener1.fn);
      emitter.on('test', listener2.fn);
      
      await emitter.emitAsync('test');
      
      assertEquals(listener1.wasCalled(), true);
      assertEquals(listener2.wasCalled(), true);
      assertEquals(results, ['listener2', 'listener1']);
    });

    it('should emit events in serial', async () => {
      const emitter = new EventEmitter();
      const results: string[] = [];
      
      const listener1 = new MockFunction(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push('listener1');
      });
      
      const listener2 = new MockFunction(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        results.push('listener2');
      });
      
      emitter.on('test', listener1.fn);
      emitter.on('test', listener2.fn);
      
      await emitter.emitAsyncSerial('test');
      
      assertEquals(listener1.wasCalled(), true);
      assertEquals(listener2.wasCalled(), true);
      assertEquals(results, ['listener1', 'listener2']);
    });
  });

  describe('waitFor() method', () => {
    it('should wait for an event with timeout', async () => {
      const emitter = new EventEmitter();
      
      setTimeout(() => {
        emitter.emit('test', 'data');
      }, 50);
      
      const result = await emitter.waitFor('test', 100);
      assertEquals(result, ['data']);
    });

    it('should timeout when event is not emitted', async () => {
      const emitter = new EventEmitter();
      
      await assertRejects(
        async () => {
          await emitter.waitFor('test', 50);
        },
        Error,
        'Timeout waiting for event'
      );
    });
  });
});

describe('EnhancedEmitter (Deno)', () => {
  describe('Enhanced functionality', () => {
    it('should create an enhanced emitter instance', () => {
      const emitter = new EnhancedEmitter();
      assertExists(emitter);
      assertInstanceOf(emitter, EnhancedEmitter);
    });

    it('should support piping events to another emitter', () => {
      const emitter = new EnhancedEmitter();
      const target = new EnhancedEmitter();
      const listener = new MockFunction();
      
      target.on('test', listener.fn);
      emitter.pipe(target, ['test']);
      
      emitter.emit('test', 'data');
      
      assertEquals(listener.wasCalledWith('data'), true);
    });

    it('should support interceptors', () => {
      const emitter = new EnhancedEmitter();
      
      const interceptor = new MockFunction((event: string, args: any[]) => {
        if (event === 'test') {
          return ['modified', ...args.slice(1)];
        }
        return args;
      });
      
      emitter.intercept(interceptor.fn);
      
      const listener = new MockFunction();
      emitter.on('test', listener.fn);
      
      emitter.emit('test', 'original', 'data');
      
      assertEquals(interceptor.wasCalledWith('test', ['original', 'data']), true);
      assertEquals(listener.wasCalledWith('modified', 'data'), true);
    });

    it('should support middleware', async () => {
      const emitter = new EnhancedEmitter();
      const results: string[] = [];
      
      emitter.use(async (context, next) => {
        results.push('before');
        await next();
        results.push('after');
      });
      
      const listener = new MockFunction(() => {
        results.push('listener');
      });
      
      emitter.on('test', listener.fn);
      emitter.emit('test');
      
      // Wait for async middleware to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      assertEquals(results, ['before', 'listener', 'after']);
    });
  });

  describe('Namespace support', () => {
    it('should support namespaced events', () => {
      const emitter = new EnhancedEmitter();
      const listener1 = new MockFunction();
      const listener2 = new MockFunction();
      const listener3 = new MockFunction();
      
      emitter.on('app:user:login', listener1.fn);
      emitter.on('app:user:logout', listener2.fn);
      emitter.on('app:system:ready', listener3.fn);
      
      // Emit to specific namespace
      emitter.emit('app:user:*', 'data');
      
      assertEquals(listener1.wasCalledWith('data'), true);
      assertEquals(listener2.wasCalledWith('data'), true);
      assertEquals(listener3.wasCalled(), false);
    });
  });

  describe('Typed events', () => {
    interface MyEvents {
      'user:login': { userId: string; timestamp: number };
      'user:logout': { userId: string };
      'data:update': { id: string; value: any };
    }

    it('should support typed events', () => {
      const typedEmitter = new EnhancedEmitter<MyEvents>();
      const listener = new MockFunction((data: { userId: string; timestamp: number }) => {
        assertEquals(data.userId, '123');
        assertEquals(data.timestamp > 0, true);
      });
      
      typedEmitter.on('user:login', listener.fn);
      typedEmitter.emit('user:login', { userId: '123', timestamp: Date.now() });
      
      assertEquals(listener.wasCalled(), true);
    });
  });
});

// Test Runtime Detection
describe('Runtime Detection (Deno)', () => {
  it('should detect Deno runtime', () => {
    assertEquals(typeof Deno, 'object');
    assertExists(Deno.version);
  });

  it('should have access to Deno-specific APIs', () => {
    assertEquals(typeof Deno.readFile, 'function');
    assertEquals(typeof Deno.writeFile, 'function');
    assertEquals(typeof Deno.permissions, 'object');
  });
});