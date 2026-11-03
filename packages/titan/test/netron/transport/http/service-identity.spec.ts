import { afterEach, describe, expect, it } from 'vitest';
import { Netron } from '../../../../src/netron/netron.js';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { Service, Public } from '../../../../src/decorators/core.js';
import { selectServiceName } from '../../../../src/netron/service-selection.js';
import { createMockLogger } from '../../test-utils.js';
import { nextTestPort } from '../../../utils/index.js';

@Service({ name: 'Observation' })
class Original {
  @Public() read() { return 'original'; }
}
@Service({ name: 'Observation', version: '1.0.0' })
class One {
  @Public() read() { return 'one'; }
}
@Service({ name: 'Observation', version: '2.0.0' })
class Two {
  @Public() read() { return 'two'; }
  @Public({ auth: { permissions: ['observation:secret'] } }) secret() { return 'protected'; }
}

const nodes: Netron[] = [];
afterEach(async () => { for (const node of nodes.splice(0).reverse()) await node.stop(); });

describe('one service identity across HTTP and packet peers', () => {
  it.each([false, true])('preserves exact unversioned publication, registration order reversed=%s', async reverse => {
    const port = nextTestPort(), url = `http://127.0.0.1:${port}`;
    const server = new Netron(createMockLogger(), { id: 'service-identity-server' }); nodes.push(server);
    server.registerTransport('http', () => new HttpTransport());
    server.registerTransportServer('http', { name: 'http', options: { host: '127.0.0.1', port } });
    // Both initial registration and dynamic registration must preserve the same keys.
    const publications = reverse ? [new Two(), new One(), new Original()] : [new Original(), new One(), new Two()];
    await server.peer.exposeService(publications[0]); await server.start();
    for (const service of publications.slice(1)) await server.peer.exposeService(service);
    const client = new Netron(createMockLogger(), { id: 'service-identity-client' }); nodes.push(client);
    client.registerTransport('http', () => new HttpTransport()); await client.start();
    const peer = await client.connect(url);
    const call = async (name: string) => (await peer.queryInterface<{ read(): Promise<string> }>(name)).read();
    const local = async (name: string) => (await server.peer.queryInterface<{ read(): string }>(name)).read();
    for (const [name, value] of [['Observation', 'original'], ['Observation@*', 'original'],
      ['Observation@1.0.0', 'one'], ['Observation@2.0.0', 'two']]) {
      expect(await call(name!)).toBe(value); expect(await local(name!)).toBe(value);
    }
    await expect(call('Observation@3.0.0')).rejects.toThrow(/not found/i);
    const denied = await fetch(url + '/netron/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'protected', service: 'Observation@2.0.0', method: 'secret', input: [] }) });
    expect(denied.status).toBe(401);
    for (const parallel of [true, false]) {
      const response = await fetch(url + '/netron/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'batch', options: { parallel }, requests: ['Observation', 'Observation@1.0.0', 'Observation@2.0.0'].map(service =>
          ({ id: service, service, method: 'read', input: [] })) }) });
      const payload = await response.json() as { responses: Array<{ data?: string }> };
      expect(payload.responses.map(result => result.data)).toEqual(['original', 'one', 'two']);
    }
    // Removing a version cannot remove the original; removing the original makes
    // the existing unqualified proxy resolve the highest remaining version.
    await server.peer.unexposeService('Observation@2.0.0');
    expect(await call('Observation')).toBe('original'); expect(await call('Observation@1.0.0')).toBe('one');
    await expect(call('Observation@2.0.0')).rejects.toThrow(/not found/i);
    await server.peer.exposeService(new Two());
    await server.peer.unexposeService('Observation');
    expect(await call('Observation')).toBe('two'); expect(await local('Observation')).toBe('two');
    expect(await call('Observation@1.0.0')).toBe('one');
    await server.peer.unexposeService('Observation@2.0.0');
    expect(await call('Observation')).toBe('one');
  });

  it('selects only a real publication, without invented versions or regex interpretation', () => {
    expect(selectServiceName(['raw'], 'raw@1.0.0')).toBeUndefined();
    expect(selectServiceName(['api@1.9.0', 'api@1.10.0'], 'api')).toBe('api@1.10.0');
    expect(selectServiceName(['api@9.0.0', 'api@1.0.0', 'api'], 'api')).toBe('api');
    expect(selectServiceName(['api@invalid', 'api@1.0.0'], 'api')).toBe('api@1.0.0');
    expect(selectServiceName(['api@1.0.0'], 'a.*')).toBeUndefined();
  });
});
