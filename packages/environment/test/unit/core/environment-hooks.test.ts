import { describe, it, expect, beforeEach } from 'vitest';
import { Environment } from '../../../src/core/environment.js';
import { Disposable, ErrorContext } from '../../../src/types/common.js';

describe('Environment - Lifecycle Hooks', () => {
  let env: Environment;

  beforeEach(() => {
    env = new Environment({
      name: 'test-env',
      config: { foo: 'bar', nested: { value: 42 } }
    });
  });

  describe('onBeforeActivate', () => {
    it('should call onBeforeActivate hook before activation', async () => {
      const calls: string[] = [];

      env.onBeforeActivate(() => {
        calls.push('before');
        expect(env.isActive()).toBe(false);
      });

      await env.activate();
      calls.push('after');

      expect(calls).toEqual(['before', 'after']);
      expect(env.isActive()).toBe(true);
    });

    it('should call onBeforeActivate with environment instance', async () => {
      let receivedEnv: any = null;

      env.onBeforeActivate((e) => {
        receivedEnv = e;
      });

      await env.activate();

      expect(receivedEnv).toBe(env);
    });

    it('should support multiple onBeforeActivate listeners', async () => {
      const calls: number[] = [];

      env.onBeforeActivate(() => calls.push(1));
      env.onBeforeActivate(() => calls.push(2));
      env.onBeforeActivate(() => calls.push(3));

      await env.activate();

      expect(calls).toHaveLength(3);
      expect(calls).toContain(1);
      expect(calls).toContain(2);
      expect(calls).toContain(3);
    });

    it('should support async onBeforeActivate hooks', async () => {
      const calls: string[] = [];

      env.onBeforeActivate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        calls.push('async-1');
      });

      env.onBeforeActivate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push('async-2');
      });

      await env.activate();

      expect(calls).toHaveLength(2);
      expect(calls).toContain('async-1');
      expect(calls).toContain('async-2');
    });

    it('should not call onBeforeActivate if already active', async () => {
      let callCount = 0;

      env.onBeforeActivate(() => callCount++);

      await env.activate();
      expect(callCount).toBe(1);

      await env.activate(); // Already active
      expect(callCount).toBe(1); // Should not be called again
    });

    it('should allow disposing onBeforeActivate listener', async () => {
      let callCount = 0;

      const disposable = env.onBeforeActivate(() => callCount++);

      disposable.dispose();

      await env.activate();

      expect(callCount).toBe(0);
    });
  });

  describe('onAfterActivate', () => {
    it('should call onAfterActivate hook after activation', async () => {
      const calls: string[] = [];

      env.onAfterActivate(() => {
        calls.push('after');
        expect(env.isActive()).toBe(true);
      });

      await env.activate();
      calls.push('done');

      expect(calls).toEqual(['after', 'done']);
    });

    it('should call onAfterActivate with environment instance', async () => {
      let receivedEnv: any = null;

      env.onAfterActivate((e) => {
        receivedEnv = e;
      });

      await env.activate();

      expect(receivedEnv).toBe(env);
    });

    it('should support multiple onAfterActivate listeners', async () => {
      const calls: number[] = [];

      env.onAfterActivate(() => calls.push(1));
      env.onAfterActivate(() => calls.push(2));
      env.onAfterActivate(() => calls.push(3));

      await env.activate();

      expect(calls).toHaveLength(3);
    });

    it('should support async onAfterActivate hooks', async () => {
      const calls: string[] = [];

      env.onAfterActivate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        calls.push('async');
      });

      await env.activate();

      expect(calls).toContain('async');
    });

    it('should allow disposing onAfterActivate listener', async () => {
      let callCount = 0;

      const disposable = env.onAfterActivate(() => callCount++);

      disposable.dispose();

      await env.activate();

      expect(callCount).toBe(0);
    });
  });

  describe('onBeforeDeactivate', () => {
    it('should call onBeforeDeactivate hook before deactivation', async () => {
      const calls: string[] = [];

      await env.activate();

      env.onBeforeDeactivate(() => {
        calls.push('before');
        expect(env.isActive()).toBe(true);
      });

      await env.deactivate();
      calls.push('after');

      expect(calls).toEqual(['before', 'after']);
      expect(env.isActive()).toBe(false);
    });

    it('should call onBeforeDeactivate with environment instance', async () => {
      let receivedEnv: any = null;

      await env.activate();

      env.onBeforeDeactivate((e) => {
        receivedEnv = e;
      });

      await env.deactivate();

      expect(receivedEnv).toBe(env);
    });

    it('should support multiple onBeforeDeactivate listeners', async () => {
      const calls: number[] = [];

      await env.activate();

      env.onBeforeDeactivate(() => calls.push(1));
      env.onBeforeDeactivate(() => calls.push(2));
      env.onBeforeDeactivate(() => calls.push(3));

      await env.deactivate();

      expect(calls).toHaveLength(3);
    });

    it('should support async onBeforeDeactivate hooks', async () => {
      const calls: string[] = [];

      await env.activate();

      env.onBeforeDeactivate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        calls.push('async');
      });

      await env.deactivate();

      expect(calls).toContain('async');
    });

    it('should not call onBeforeDeactivate if not active', async () => {
      let callCount = 0;

      env.onBeforeDeactivate(() => callCount++);

      await env.deactivate(); // Not active yet

      expect(callCount).toBe(0);
    });

    it('should allow disposing onBeforeDeactivate listener', async () => {
      let callCount = 0;

      await env.activate();

      const disposable = env.onBeforeDeactivate(() => callCount++);

      disposable.dispose();

      await env.deactivate();

      expect(callCount).toBe(0);
    });
  });

  describe('onError', () => {
    it('should call onError hook when error occurs in onChange callback', () => {
      let capturedError: Error | null = null;
      let capturedContext: ErrorContext | null = null;

      env.onError((error, context) => {
        capturedError = error;
        capturedContext = context;
      });

      env.onChange('foo', () => {
        throw new Error('Test error');
      });

      env.set('foo', 'newvalue');

      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError?.message).toBe('Test error');
      expect(capturedContext?.operation).toBe('onChange');
      expect(capturedContext?.key).toBe('foo');
    });

    it('should call onError hook when error occurs in watch callback', () => {
      let capturedError: Error | null = null;
      let capturedContext: ErrorContext | null = null;

      env.onError((error, context) => {
        capturedError = error;
        capturedContext = context;
      });

      env.watch(() => {
        throw new Error('Watch error');
      });

      env.set('foo', 'newvalue');

      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError?.message).toBe('Watch error');
      expect(capturedContext?.operation).toBe('watch');
    });

    it('should call onError hook when validation fails during activate', async () => {
      const invalidEnv = new Environment({
        name: 'invalid-env',
        schema: {
          required: ['name']
        },
        config: {}
      });

      let capturedError: Error | null = null;

      invalidEnv.onError((error) => {
        capturedError = error;
      });

      try {
        await invalidEnv.activate();
      } catch (e) {
        // Expected
      }

      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError?.message).toBeTruthy();
    });

    it('should support multiple onError listeners', () => {
      const errors: Error[] = [];

      env.onError((error) => errors.push(error));
      env.onError((error) => errors.push(error));

      env.onChange('foo', () => {
        throw new Error('Test error');
      });

      env.set('foo', 'value');

      expect(errors).toHaveLength(2);
      expect(errors[0].message).toBe('Test error');
      expect(errors[1].message).toBe('Test error');
    });

    it('should allow disposing onError listener', () => {
      let callCount = 0;

      const disposable = env.onError(() => callCount++);

      disposable.dispose();

      env.onChange('foo', () => {
        throw new Error('Test error');
      });

      env.set('foo', 'value');

      expect(callCount).toBe(0);
    });

    it('should not cause infinite loop if onError callback throws', () => {
      let errorCallCount = 0;

      env.onError(() => {
        errorCallCount++;
        throw new Error('Error in error handler');
      });

      env.onChange('foo', () => {
        throw new Error('Original error');
      });

      env.set('foo', 'value');

      // Should only be called once, not recursively
      expect(errorCallCount).toBe(1);
    });
  });

  describe('watch', () => {
    it('should emit watch events on set operations', () => {
      const events: any[] = [];

      env.watch((event) => {
        events.push(event);
      });

      env.set('foo', 'newvalue');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'modified',
        path: 'foo'
      });
      expect(events[0].timestamp).toBeInstanceOf(Date);
    });

    it('should emit watch events on delete operations', () => {
      const events: any[] = [];

      env.watch((event) => {
        events.push(event);
      });

      env.delete('foo');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'deleted',
        path: 'foo'
      });
    });

    it('should emit created event for new keys', () => {
      const events: any[] = [];

      env.watch((event) => {
        events.push(event);
      });

      env.set('newKey', 'value');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('created');
      expect(events[0].path).toBe('newKey');
    });

    it('should support multiple watch listeners', () => {
      const events1: any[] = [];
      const events2: any[] = [];

      env.watch((event) => events1.push(event));
      env.watch((event) => events2.push(event));

      env.set('foo', 'value');

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it('should allow disposing watch listener', () => {
      const events: any[] = [];

      const disposable = env.watch((event) => {
        events.push(event);
      });

      disposable.dispose();

      env.set('foo', 'value');

      expect(events).toHaveLength(0);
    });
  });

  describe('onChange', () => {
    it('should emit change event with old and new values', () => {
      let capturedNew: any = null;
      let capturedOld: any = null;
      let capturedKey: any = null;

      env.onChange('foo', (newVal, oldVal, key) => {
        capturedNew = newVal;
        capturedOld = oldVal;
        capturedKey = key;
      });

      env.set('foo', 'newvalue');

      expect(capturedNew).toBe('newvalue');
      expect(capturedOld).toBe('bar');
      expect(capturedKey).toBe('foo');
    });

    it('should only trigger onChange for the specific key', () => {
      let fooCallCount = 0;
      let barCallCount = 0;

      env.onChange('foo', () => fooCallCount++);
      env.onChange('nested.value', () => barCallCount++);

      env.set('foo', 'changed');

      expect(fooCallCount).toBe(1);
      expect(barCallCount).toBe(0);
    });

    it('should support multiple onChange listeners for same key', () => {
      const calls: number[] = [];

      env.onChange('foo', () => calls.push(1));
      env.onChange('foo', () => calls.push(2));
      env.onChange('foo', () => calls.push(3));

      env.set('foo', 'value');

      expect(calls).toEqual([1, 2, 3]);
    });

    it('should allow disposing onChange listener', () => {
      let callCount = 0;

      const disposable = env.onChange('foo', () => callCount++);

      disposable.dispose();

      env.set('foo', 'value');

      expect(callCount).toBe(0);
    });

    it('should handle onChange on delete', () => {
      let capturedNew: any = 'not-called';
      let capturedOld: any = 'not-called';

      env.onChange('foo', (newVal, oldVal) => {
        capturedNew = newVal;
        capturedOld = oldVal;
      });

      env.delete('foo');

      expect(capturedNew).toBeUndefined();
      expect(capturedOld).toBe('bar');
    });
  });

  describe('Disposable pattern', () => {
    it('should return Disposable with dispose method for onBeforeActivate', () => {
      const disposable = env.onBeforeActivate(() => {});

      expect(disposable).toHaveProperty('dispose');
      expect(typeof disposable.dispose).toBe('function');
    });

    it('should return Disposable with dispose method for onAfterActivate', () => {
      const disposable = env.onAfterActivate(() => {});

      expect(disposable).toHaveProperty('dispose');
      expect(typeof disposable.dispose).toBe('function');
    });

    it('should return Disposable with dispose method for onBeforeDeactivate', () => {
      const disposable = env.onBeforeDeactivate(() => {});

      expect(disposable).toHaveProperty('dispose');
      expect(typeof disposable.dispose).toBe('function');
    });

    it('should return Disposable with dispose method for onError', () => {
      const disposable = env.onError(() => {});

      expect(disposable).toHaveProperty('dispose');
      expect(typeof disposable.dispose).toBe('function');
    });

    it('should return Disposable with dispose method for watch', () => {
      const disposable = env.watch(() => {});

      expect(disposable).toHaveProperty('dispose');
      expect(typeof disposable.dispose).toBe('function');
    });

    it('should return Disposable with dispose method for onChange', () => {
      const disposable = env.onChange('foo', () => {});

      expect(disposable).toHaveProperty('dispose');
      expect(typeof disposable.dispose).toBe('function');
    });

    it('should allow calling dispose multiple times safely', () => {
      const disposable = env.onChange('foo', () => {});

      expect(() => {
        disposable.dispose();
        disposable.dispose();
        disposable.dispose();
      }).not.toThrow();
    });
  });

  describe('Lifecycle hook execution order', () => {
    it('should execute hooks in correct order during activation', async () => {
      const order: string[] = [];

      env.onBeforeActivate(() => order.push('before'));
      env.onAfterActivate(() => order.push('after'));

      await env.activate();

      expect(order).toEqual(['before', 'after']);
    });

    it('should not execute after hooks if validation fails', async () => {
      const invalidEnv = new Environment({
        name: 'invalid',
        schema: { required: { type: 'string' } },
        config: {}
      });

      const order: string[] = [];

      invalidEnv.onBeforeActivate(() => order.push('before'));
      invalidEnv.onAfterActivate(() => order.push('after'));

      try {
        await invalidEnv.activate();
      } catch (e) {
        // Expected
      }

      expect(order).toEqual(['before']);
      expect(order).not.toContain('after');
    });
  });

  describe('Error handling in lifecycle hooks', () => {
    it('should call onError if lifecycle hook throws', async () => {
      let capturedError: Error | null = null;

      env.onError((error) => {
        capturedError = error;
      });

      env.onBeforeActivate(() => {
        throw new Error('Hook error');
      });

      try {
        await env.activate();
      } catch (e) {
        // Expected
      }

      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError?.message).toBe('Hook error');
    });

    it('should call onError if async lifecycle hook rejects', async () => {
      let capturedError: Error | null = null;

      env.onError((error) => {
        capturedError = error;
      });

      env.onBeforeActivate(async () => {
        throw new Error('Async hook error');
      });

      try {
        await env.activate();
      } catch (e) {
        // Expected
      }

      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError?.message).toBe('Async hook error');
    });
  });
});
