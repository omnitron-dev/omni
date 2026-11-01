import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { HttpTransportClient as BrowserClient } from '../../../../../netron-browser/src/transport/http/client.js';

const aborted = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('HTTP request deadlines', () => {
  it.each([['server', HttpTransportClient], ['browser', BrowserClient]] as const)('%s bounds body reading after response headers arrive', async (_name, Client) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({ ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(aborted()))),
    })));
    const client = new Client('http://fixture.invalid');
    const request = expect(client.invoke('Probe', 'read', [{}], { hints: { timeout: 50 } })).rejects.toMatchObject({ code: 408 });
    await vi.advanceTimersByTimeAsync(50);
    await request;
    await client.close();
  });

  it('times out one connection request without cancelling a later sibling, then closes every remaining request', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      signals.push(init.signal);
      init.signal.addEventListener('abort', () => reject(aborted()));
    })));
    const connection = new HttpConnection('http://fixture.invalid', { timeout: 50 });
    const service = await connection.queryInterface('Probe');
    const first = service.read({}).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(25);
    const second = service.read({}).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    await connection.close();
    expect(signals[1]!.aborted).toBe(true);
    expect(await first).toBeInstanceOf(Error);
    expect(await second).toBeInstanceOf(Error);
  });
});
