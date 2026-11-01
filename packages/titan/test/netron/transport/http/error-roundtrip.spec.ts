import { afterEach, describe, expect, it } from 'vitest';
import { Netron } from '../../../../src/netron/netron.js';
import { HttpTransport } from '../../../../src/netron/transport/http/index.js';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import { Public, Service } from '../../../../src/decorators/core.js';
import { TitanError } from '../../../../src/errors/index.js';
import { createMockLogger } from '../../test-utils.js';

@Service('ErrorRoundtrip@1.0.0')
class ErrorRoundtrip {
  @Public()
  async refuse({ code }: { code: number }): Promise<never> {
    throw new TitanError({ code, message: 'Access refused', details: { permission: 'sessions.resolve' },
      requestId: 'request-roundtrip', correlationId: 'correlation-roundtrip' });
  }
}

describe('HTTP error semantics across public client paths', () => {
  const cleanup: Array<() => Promise<unknown>> = [];
  afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

  it.each(['peer', 'connection', 'hints'] as const)('%s preserves refusal codes instead of reporting a server failure', async mode => {
    const logger = createMockLogger();
    const server = new Netron(logger);
    server.registerTransport('http', () => new HttpTransport());
    server.registerTransportServer('http', { name: 'http', options: { host: '127.0.0.1', port: 0 } });
    cleanup.push(() => server.stop());
    await server.start();
    await server.peer.exposeService(new ErrorRoundtrip());
    const url = `http://127.0.0.1:${server.transportServers.get('http')!.port}`;
    let invoke: (code: number) => Promise<unknown>;
    if (mode === 'peer') {
      const client = new Netron(logger);
      client.registerTransport('http', () => new HttpTransport());
      cleanup.push(() => client.stop());
      const peer = await client.connect(url);
      const service = await peer.queryInterface<ErrorRoundtrip>('ErrorRoundtrip@1.0.0');
      invoke = code => service.refuse({ code });
    } else if (mode === 'connection') {
      const connection = new HttpConnection(url);
      cleanup.push(() => connection.close());
      const service = await connection.queryInterface('ErrorRoundtrip@1.0.0');
      invoke = code => service.refuse({ code });
    } else {
      const client = new HttpTransportClient(url);
      cleanup.push(() => client.close());
      invoke = code => client.invoke('ErrorRoundtrip', 'refuse', [{ code }], { hints: { timeout: 5000 } });
    }
    for (const code of [401, 403, 409, 429, 503]) {
      await expect(invoke(code)).rejects.toMatchObject({ code, httpStatus: code, message: 'Access refused',
        details: { permission: 'sessions.resolve' }, requestId: 'request-roundtrip', correlationId: 'correlation-roundtrip' });
    }
  });
});
