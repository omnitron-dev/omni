/**
 * An exec that asked the wrong process, the wrong way.
 *
 * `omnitron exec main NotificationWorker getStatus` answered «Method with id
 * NotificationWorker.getStatus not found», exit 0, for a read-only method
 * that exists — in main's notification-worker process. `exec` asked the
 * FIRST child (http) for `proxy[service][method]`; the process proxy answers
 * a remote-call function for any property name, so `[service]` was a
 * function and `[method]` on it undefined. The working path was a file away:
 * each process lists what it exposes (`getExposedServices`) and runs a call
 * on it (`callExposedService`), which is how ServiceRouter reaches them.
 */
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';

import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';

const processProxy = (services: Array<{ name: string; methods: string[] }>, calls: unknown[]) =>
  // What a PM proxy is: any property is a remote call. This is why
  // `proxy[service][method]` could never be found.
  new Proxy(
    {
      getExposedServices: async () => services,
      callExposedService: async (service: string, method: string, args: unknown[]) => {
        calls.push([service, method, args]);
        return { ok: true, service, method };
      },
    },
    {
      // Not a thenable — the real proxy answers `then` with undefined too, or
      // every `await` on it would wait for ever.
      get: (target, prop) => (prop === 'then' ? undefined : prop in target ? (target as never)[prop] : async () => undefined),
    },
  );

const rpcWith = (children: Record<string, Array<{ name: string; methods: string[] }>>, calls: unknown[]) =>
  new DaemonRpcService(
    {
      getHandle: () => ({
        status: 'online',
        mode: 'bootstrap',
        supervisor: {
          getChildNames: () => Object.keys(children),
          getChildProxy: async (child: string) => processProxy(children[child]!, calls),
        },
      }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

const MAIN = {
  http: [{ name: 'Auth', methods: ['signin'] }],
  'captcha-generator': [{ name: 'CaptchaWorker', methods: ['getStatus'] }],
  'notification-worker': [{ name: 'NotificationWorker', methods: ['getStatus', 'drain'] }],
};

describe('omnitron exec on an app of several processes', () => {
  it('reaches the method in the process that exposes the service', async () => {
    const calls: unknown[] = [];
    const out = await rpcWith(MAIN, calls).exec({ name: 'main', service: 'NotificationWorker', method: 'getStatus', args: [] });

    expect(out).toEqual({ ok: true, service: 'NotificationWorker', method: 'getStatus' });
    expect(calls).toEqual([['NotificationWorker', 'getStatus', []]]);
  });

  it('names what the service offers when the method is not one of them', async () => {
    await expect(
      rpcWith(MAIN, []).exec({ name: 'main', service: 'CaptchaWorker', method: 'nope', args: [] }),
    ).rejects.toThrow(/offers: getStatus/);
  });

  it('names the services the processes expose when the service is not one of them', async () => {
    await expect(rpcWith(MAIN, []).exec({ name: 'main', service: 'Nope', method: 'x', args: [] })).rejects.toThrow(
      /NotificationWorker \(notification-worker\)/,
    );
  });
});
