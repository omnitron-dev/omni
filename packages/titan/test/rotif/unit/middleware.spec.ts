import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MiddlewareManager, Middleware } from '../../../src/rotif/middleware.js';
import { RotifMessage } from '../../../src/rotif/types.js';

describe('Rotif - Middleware', () => {
  let manager: MiddlewareManager;

  beforeEach(() => {
    manager = new MiddlewareManager();
  });

  describe('MiddlewareManager', () => {
    describe('use', () => {
      it('should add middleware to the chain', () => {
        const mw: Middleware = {
          beforePublish: vi.fn(),
        };

        manager.use(mw);
        expect(manager['middleware'].length).toBe(1);
      });

      it('should add multiple middleware in order', () => {
        const mw1: Middleware = { beforePublish: vi.fn() };
        const mw2: Middleware = { beforePublish: vi.fn() };
        const mw3: Middleware = { beforePublish: vi.fn() };

        manager.use(mw1);
        manager.use(mw2);
        manager.use(mw3);

        expect(manager['middleware'].length).toBe(3);
        expect(manager['middleware'][0]).toBe(mw1);
        expect(manager['middleware'][1]).toBe(mw2);
        expect(manager['middleware'][2]).toBe(mw3);
      });
    });

    describe('runBeforePublish', () => {
      it('should call beforePublish on all middleware', async () => {
        const mw1 = { beforePublish: vi.fn() };
        const mw2 = { beforePublish: vi.fn() };

        manager.use(mw1);
        manager.use(mw2);

        await manager.runBeforePublish('test.channel', { msg: 'hello' }, {});

        expect(mw1.beforePublish).toHaveBeenCalledWith('test.channel', { msg: 'hello' }, {});
        expect(mw2.beforePublish).toHaveBeenCalledWith('test.channel', { msg: 'hello' }, {});
      });

      it('should execute middleware in order', async () => {
        const order: number[] = [];
        const mw1: Middleware = {
          beforePublish: async () => {
            order.push(1);
          },
        };
        const mw2: Middleware = {
          beforePublish: async () => {
            order.push(2);
          },
        };
        const mw3: Middleware = {
          beforePublish: async () => {
            order.push(3);
          },
        };

        manager.use(mw1);
        manager.use(mw2);
        manager.use(mw3);

        await manager.runBeforePublish('test', {});

        expect(order).toEqual([1, 2, 3]);
      });

      it('should skip middleware without beforePublish', async () => {
        const mw1 = { beforePublish: vi.fn() };
        const mw2 = { afterPublish: vi.fn() }; // No beforePublish
        const mw3 = { beforePublish: vi.fn() };

        manager.use(mw1);
        manager.use(mw2);
        manager.use(mw3);

        await manager.runBeforePublish('test', {});

        expect(mw1.beforePublish).toHaveBeenCalled();
        expect(mw3.beforePublish).toHaveBeenCalled();
      });

      it('should pass correct arguments to middleware', async () => {
        const mw = { beforePublish: vi.fn() };
        manager.use(mw);

        const channel = 'user.created';
        const payload = { userId: 123, name: 'test' };
        const options = { delayMs: 1000 };

        await manager.runBeforePublish(channel, payload, options);

        expect(mw.beforePublish).toHaveBeenCalledWith(channel, payload, options);
      });
    });

    describe('runAfterPublish', () => {
      it('should call afterPublish on all middleware', async () => {
        const mw1 = { afterPublish: vi.fn() };
        const mw2 = { afterPublish: vi.fn() };

        manager.use(mw1);
        manager.use(mw2);

        await manager.runAfterPublish('test.channel', { msg: 'hello' }, 'msg-id-123', {});

        expect(mw1.afterPublish).toHaveBeenCalledWith('test.channel', { msg: 'hello' }, 'msg-id-123', {});
        expect(mw2.afterPublish).toHaveBeenCalledWith('test.channel', { msg: 'hello' }, 'msg-id-123', {});
      });

      it('should handle null message ID', async () => {
        const mw = { afterPublish: vi.fn() };
        manager.use(mw);

        await manager.runAfterPublish('test', {}, null, {});

        expect(mw.afterPublish).toHaveBeenCalledWith('test', {}, null, {});
      });

      it('should handle array of message IDs', async () => {
        const mw = { afterPublish: vi.fn() };
        manager.use(mw);

        const ids = ['id1', 'id2', 'id3'];
        await manager.runAfterPublish('test', {}, ids, {});

        expect(mw.afterPublish).toHaveBeenCalledWith('test', {}, ids, {});
      });
    });

    describe('runBeforeProcess', () => {
      it('should call beforeProcess on all middleware', async () => {
        const msg: RotifMessage = {
          id: 'msg-123',
          channel: 'test',
          payload: { data: 'test' },
          timestamp: Date.now(),
          attempt: 1,
          ack: vi.fn(),
        };

        const mw1 = { beforeProcess: vi.fn() };
        const mw2 = { beforeProcess: vi.fn() };

        manager.use(mw1);
        manager.use(mw2);

        await manager.runBeforeProcess(msg);

        expect(mw1.beforeProcess).toHaveBeenCalledWith(msg);
        expect(mw2.beforeProcess).toHaveBeenCalledWith(msg);
      });

      it('should pass message object correctly', async () => {
        const msg: RotifMessage = {
          id: 'msg-456',
          channel: 'user.updated',
          payload: { userId: 789 },
          timestamp: Date.now(),
          attempt: 2,
          ack: vi.fn(),
        };

        const mw = { beforeProcess: vi.fn() };
        manager.use(mw);

        await manager.runBeforeProcess(msg);

        expect(mw.beforeProcess).toHaveBeenCalledWith(msg);
        expect(mw.beforeProcess).toHaveBeenCalledTimes(1);
      });
    });

    describe('runAfterProcess', () => {
      it('should call afterProcess on all middleware', async () => {
        const msg: RotifMessage = {
          id: 'msg-789',
          channel: 'test',
          payload: {},
          timestamp: Date.now(),
          attempt: 1,
          ack: vi.fn(),
        };

        const mw1 = { afterProcess: vi.fn() };
        const mw2 = { afterProcess: vi.fn() };

        manager.use(mw1);
        manager.use(mw2);

        await manager.runAfterProcess(msg);

        expect(mw1.afterProcess).toHaveBeenCalledWith(msg);
        expect(mw2.afterProcess).toHaveBeenCalledWith(msg);
      });
    });

    describe('runOnError', () => {
      it('should call onError on all middleware', async () => {
        const msg: RotifMessage = {
          id: 'msg-error',
          channel: 'test',
          payload: {},
          timestamp: Date.now(),
          attempt: 1,
          ack: vi.fn(),
        };
        const error = new Error('Test error');

        const mw1 = { onError: vi.fn() };
        const mw2 = { onError: vi.fn() };

        manager.use(mw1);
        manager.use(mw2);

        await manager.runOnError(msg, error);

        expect(mw1.onError).toHaveBeenCalledWith(msg, error);
        expect(mw2.onError).toHaveBeenCalledWith(msg, error);
      });

      it('should pass error object correctly', async () => {
        const msg: RotifMessage = {
          id: 'msg-123',
          channel: 'test',
          payload: {},
          timestamp: Date.now(),
          attempt: 3,
          ack: vi.fn(),
        };
        const error = new Error('Processing failed');
        error.stack = 'Error stack trace';

        const mw = { onError: vi.fn() };
        manager.use(mw);

        await manager.runOnError(msg, error);

        expect(mw.onError).toHaveBeenCalledWith(msg, error);
        const calledError = (mw.onError as any).mock.calls[0][1];
        expect(calledError.message).toBe('Processing failed');
      });
    });

    describe('middleware execution flow', () => {
      it('should execute complete middleware lifecycle', async () => {
        const events: string[] = [];

        const mw: Middleware = {
          beforePublish: async () => {
            events.push('beforePublish');
          },
          afterPublish: async () => {
            events.push('afterPublish');
          },
          beforeProcess: async () => {
            events.push('beforeProcess');
          },
          afterProcess: async () => {
            events.push('afterProcess');
          },
        };

        manager.use(mw);

        await manager.runBeforePublish('test', {});
        await manager.runAfterPublish('test', {}, 'id-123');

        const msg: RotifMessage = {
          id: 'msg-123',
          channel: 'test',
          payload: {},
          timestamp: Date.now(),
          attempt: 1,
          ack: vi.fn(),
        };

        await manager.runBeforeProcess(msg);
        await manager.runAfterProcess(msg);

        expect(events).toEqual(['beforePublish', 'afterPublish', 'beforeProcess', 'afterProcess']);
      });

      it('should handle async middleware', async () => {
        const results: number[] = [];

        const mw1: Middleware = {
          beforePublish: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            results.push(1);
          },
        };

        const mw2: Middleware = {
          beforePublish: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            results.push(2);
          },
        };

        manager.use(mw1);
        manager.use(mw2);

        await manager.runBeforePublish('test', {});

        // Should execute in order despite different delays
        expect(results).toEqual([1, 2]);
      });

      it('should propagate errors from middleware', async () => {
        const mw: Middleware = {
          beforePublish: async () => {
            throw new Error('Middleware error');
          },
        };

        manager.use(mw);

        await expect(manager.runBeforePublish('test', {})).rejects.toThrow('Middleware error');
      });
    });
  });
});
