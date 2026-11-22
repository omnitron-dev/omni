import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { DaemonClient } from '../../src/daemon/daemon-client.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { SecretsService } from '../../src/services/secrets.service.js';
import { RetainedBindings, type BindingCapsule, type ComparisonProof } from '../../src/services/retained-bindings.js';
import { RetainedBindingsRpcService } from '../../src/services/retained-bindings.rpc-service.js';
import { bindingReference, bindingRoles, sha256, ticketDigest, type BindingRole, type BindingTicket } from '../../src/infrastructure/retained-binding-ticket.js';
import { containsFilteredId, retainedConsumerManifest } from '../../src/infrastructure/retained-binding-consumer.js';
import { legacyContainerSpecHash } from '../../src/infrastructure/container-runtime.js';
import { stableJson } from '../../src/shared/canonical-json.js';
import { OutputCommand } from '../../src/cli/output-command.js';
import { registerRetainedBindings } from '../../src/commands/retained-bindings.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const roles = { postgres: 'POSTGRES_PASSWORD', minio: 'MINIO_ROOT_PASSWORD', nominatim: 'NOMINATIM_PASSWORD' };
const values = { postgres: 'fixture-pg-a', minio: 'fixture-object-b', nominatim: 'fixture-map-c' };
const declared = {
  protocol: 1, project: 'sample', stack: 'site', release: 'example-1', manifestSha256: sha256('approved fixture'),
  services: bindingRoles.map(role => ({
    originalId: sha256(role), imageId: 'sha256:' + sha256('base:' + role),
    spec: { name: 'sample-site-' + role, image: 'fixture-image', ports: [], volumes: [], restart: 'no',
      environment: { [roles[role]]: { binding: bindingReference(role, 'sample', 'site') } },
      labels: { 'omnitron.managed': 'true', 'omnitron.project': 'sample', 'omnitron.stack': 'site', 'omnitron.service': role } },
  })),
};
const declaration = JSON.stringify(declared) + '\n';
let dir: string;
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'rb-')); });
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop();
  rmSync(dir, { recursive: true, force: true });
});
async function owner(side: 'master' | 'source', trusted = true) {
  const home = path.join(dir, side);
  mkdirSync(home, { mode: 0o700 });
  const logger = createNullLogger(), store = new DaemonStateStore(logger, path.join(home, 'data', 'daemon-state.db'));
  cleanup.push(() => store.dispose());
  const vault = new SecretsService(store, 'synthetic ' + side);
  for (const role of bindingRoles) {
    const local = side === 'master' ? role === 'nominatim' : role !== 'nominatim';
    await vault.set(bindingReference(role, 'sample', 'site'), local ? values[role] : 'incorrect other origin');
  }
  await vault.set('unrelated', 'another fixture value');
  const reads = vi.spyOn(vault, 'withRetainedBindings');
  const general = vi.spyOn(vault, 'get').mockImplementation(async () => { throw Error('General read forbidden'); });
  const compare = vi.fn(async (_ticket, _subject, role: BindingRole, expected: string) => {
    const row = declared.services.find(r => r.spec.labels['omnitron.service'] === role)!;
    return expected === legacyContainerSpecHash({ ...row.spec, environment: { [roles[role]]: values[role] } });
  });
  const materialize = vi.fn(async (rows: Record<BindingRole, string>) => {
    expect(rows).toEqual(values);
    return { sealSha256: sha256('fixture seal') };
  });
  const prepare = vi.fn(async () => materialize);
  const provider = new RetainedBindings(home, store, vault, async () => {}, compare, prepare);
  const socket = path.join(dir, side + '.sock'), netron = new Netron(logger);
  netron.configureAuth(new AuthenticationManager(logger, { authenticate: async () => { throw Error('Local socket only'); } }),
    new AuthorizationManager(logger));
  netron.registerTransportServer('unix', { name: side, options: { path: socket, mode: 0o600, invocationWrapper: createAuthContextWrapper() } });
  netron.setTransportAuthContext('unix', trusted ? { userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' } }
    : { userId: 'fixture-service', roles: ['service_role'], permissions: [], metadata: { principalType: 'service' } });
  await netron.peer.exposeService(new RetainedBindingsRpcService(provider));
  await netron.start(); cleanup.push(() => netron.stop());
  const client = new DaemonClient(socket);
  cleanup.push(() => client.disconnect());
  const rpc = await client.service<RetainedBindingsRpcService>('OmnitronRetainedBindings');
  return { home, socket, vault, rpc, general, reads, materialize, prepare, compare };
}
async function site() {
  const master = await owner('master'), source = await owner('source');
  const ticket: BindingTicket = { protocol: 1, id: randomUUID(), project: 'sample', stack: 'site', release: declared.release,
    manifestSha256: declared.manifestSha256, declarationSha256: sha256(declaration),
    master: { nodeId: randomUUID(), identity: await master.rpc.identity() }, source: { nodeId: randomUUID(), identity: await source.rpc.identity() },
    engineSocket: '/run/docker.sock', purpose: 'compare', expiresAt: Date.now() + 600000, consumer: null };
  const approve = async (t = ticket, proof: ComparisonProof | null = null, opts: string | null = null) => {
    const req = { ticket: t, expect: ticketDigest(t), declaration, comparison: proof, options: null };
    await master.rpc.approve(req);
    return source.rpc.approve({ ...req, options: opts });
  };
  const compare = async () => {
    const req = { id: ticket.id, expect: ticketDigest(ticket), capsule: null, sourceApproval: null };
    const approval = await approve();
    const capsule = await master.rpc.apply({ ...req, sourceApproval: approval }) as BindingCapsule;
    const receipt = await source.rpc.apply({ ...req, capsule }) as ComparisonProof;
    return { capsule, receipt, req, approval };
  };
  const closed = (proof: ComparisonProof, options: string): BindingTicket => ({
    ...ticket, id: randomUUID(), purpose: 'seal', consumer: { helperSha256: retainedConsumerManifest, runtimeSha256: sha256('old runtime'),
      runtimeManifestSha256: sha256('original manifest'), optionsSha256: sha256(options), comparison: sha256(stableJson(proof)) },
  });
  return { master, source, ticket, approve, compare, closed };
}

it('compares only the three original owner rows across authenticated sockets and durably reuses the public result', async () => {
  const { master, source, compare } = await site();
  const { capsule, receipt, req, approval } = await compare();
  expect(receipt.document.rows).toEqual({ postgres: 'matched', minio: 'matched', nominatim: 'matched' });
  for (const material of Object.values(values)) expect(JSON.stringify([capsule, receipt, approval])).not.toContain(material);
  expect(await source.rpc.apply({ ...req, capsule })).toEqual(receipt);
  expect(await master.rpc.apply({ ...req, sourceApproval: approval })).toEqual(capsule);
  expect(master.reads).toHaveBeenCalledTimes(1); expect(source.reads).toHaveBeenCalledTimes(1);
  expect(master.general).not.toHaveBeenCalled(); expect(source.general).not.toHaveBeenCalled();
  expect(source.prepare).not.toHaveBeenCalled();
});
it('requires independent approval before opening either vault and rejects modified public commitments and packets', async () => {
  const { master, source, ticket, approve } = await site(), expectSha = ticketDigest(ticket);
  const local = { id: ticket.id, expect: expectSha, capsule: null, sourceApproval: null };
  const req = { ticket, expect: expectSha, declaration, options: null, comparison: null };
  await expect(source.rpc.approve({ ...req, declaration: declaration.trim() })).rejects.toThrow();
  const altered = JSON.parse(declaration);
  altered.services[0].spec.environment.POSTGRES_PASSWORD.binding = 'unrelated';
  const raw = JSON.stringify(altered), injected = { ...ticket, declarationSha256: sha256(raw) };
  await expect(master.rpc.approve({ ...req, ticket: injected, expect: ticketDigest(injected), declaration: raw })).rejects.toThrow();
  const unsigned = await master.rpc.approve(req);
  await expect(master.rpc.apply(local)).rejects.toThrow();
  await expect(master.rpc.apply({ ...local, sourceApproval: { ...unsigned, document: { ...unsigned.document, origin: 'source' } } })).rejects.toThrow();
  expect(master.reads).not.toHaveBeenCalled();
  const admitted = await approve();
  const capsule = await master.rpc.apply({ ...local, sourceApproval: admitted }) as BindingCapsule;
  await expect(source.rpc.apply({ ...local, capsule: { ...capsule, document: { ...capsule.document, ciphertext: 'tampered' } } })).rejects.toThrow();
  expect(source.reads).not.toHaveBeenCalled();
  await source.rpc.revoke({ id: ticket.id, expect: expectSha });
  await expect(source.rpc.apply({ ...local, capsule })).rejects.toThrow();
  expect(source.reads).not.toHaveBeenCalled();
});
it('rejects a mistaken or missing historical row and refuses to materialize its comparison', async () => {
  const { source, master, compare, closed, approve } = await site();
  await master.vault.set(bindingReference('nominatim', 'sample', 'site'), 'wrong fixture');
  await source.vault.delete(bindingReference('minio', 'sample', 'site'));
  const { receipt } = await compare();
  expect(receipt.document.rows).toEqual({ postgres: 'matched', minio: 'unavailable', nominatim: 'different' });
  await expect(approve(closed(receipt, '{}'), receipt, '{}')).rejects.toThrow();
  expect(source.prepare).not.toHaveBeenCalled();
});
it('requires a new exact grant on BOTH owners for the fixed consumer, and invokes it once', async () => {
  const { master, source, ticket, compare, closed, approve } = await site();
  const { receipt, capsule: earlier, approval: prior } = await compare();
  const options = JSON.stringify({ directory: path.join(source.home, 'retained-bindings', 'returns', ticket.declarationSha256),
    volumeRoot: '/var/lib/docker/volumes' });
  const transfer = closed(receipt, options), expectSha = ticketDigest(transfer);
  const req = { id: transfer.id, expect: expectSha, capsule: null, sourceApproval: null };
  const untrusted = { ...transfer, consumer: { ...transfer.consumer!, helperSha256: sha256('unselected executable') } };
  await expect(approve(untrusted, receipt, options)).rejects.toThrow();
  const approval = await approve(transfer, receipt, options);
  await expect(source.rpc.apply({ ...req, capsule: earlier })).rejects.toThrow();
  await expect(master.rpc.apply({ ...req, sourceApproval: prior })).rejects.toThrow();
  expect(source.prepare).not.toHaveBeenCalled();
  const capsule = await master.rpc.apply({ ...req, sourceApproval: approval }) as BindingCapsule;
  for (const material of Object.values(values)) expect(JSON.stringify(capsule)).not.toContain(material);
  const result = await source.rpc.apply({ ...req, capsule });
  expect(result).toEqual({ sealSha256: sha256('fixture seal') });
  expect(await source.rpc.apply({ ...req, capsule })).toEqual(result);
  expect(source.materialize).toHaveBeenCalledTimes(1);
});
it('denies the existing machine principal on a genuine Netron connection before vault access', async () => {
  const o = await owner('master', false);
  await expect(o.rpc.identity()).rejects.toThrow();
  expect(o.reads).not.toHaveBeenCalled();
});
it('routes the native CLI to the selected fixture Unix socket and keeps its sealed packet out of output', async () => {
  const { master, ticket, approve } = await site();
  const granted = await approve();
  const approval = path.join(dir, 'approved.json'), output = path.join(dir, 'capsule.json');
  writeFileSync(approval, JSON.stringify(granted));
  const program = new OutputCommand();
  registerRetainedBindings(program);
  setEnvOverride({ OMNITRON_SOCKET: master.socket });
  const printed: string[] = [], writer = vi.spyOn(process.stdout, 'write').mockImplementation(line => { printed.push(String(line)); return true; });
  try {
    const args = ['retained-bindings', 'apply', ticket.id, '--expect', ticketDigest(ticket), '--source-approval', approval];
    await expect(program.parseAsync(args, { from: 'user' })).rejects.toThrow('owner-only');
    expect(master.reads).not.toHaveBeenCalled();
    await program.parseAsync([...args, '--out', output], { from: 'user' });
  } finally { writer.mockRestore(); resetEnvCache(); }
  const bytes = readFileSync(output);
  const capsule = JSON.parse(bytes.toString()) as BindingCapsule;
  expect(capsule.document.ticket).toBe(ticketDigest(ticket));
  expect(statSync(output).mode & 0o777).toBe(0o600);
  expect(printed.map(s => JSON.parse(s))).toEqual([{ sha256: sha256(bytes), bytes: bytes.length }]);
});
it('tests Docker membership through an exact inventory query and only inspects its array prefix', async () => {
  const sock = path.join(dir, 'docker.sock'), observed: string[] = [];
  const server = createServer((req, res) => {
    expect(req.method).toBe('GET');
    const url = new URL(req.url!, 'http://fixture');
    expect(url.pathname).toBe('/containers/json');
    const filter = JSON.parse(url.searchParams.get('filters')!);
    observed.push(filter.id[0]);
    res.end(filter.id[0] === sha256('present') ? '[{"Id":"unused","Command":"unused"}]' : ' []\n');
  });
  await new Promise<void>(resolve => server.listen(sock, resolve));
  try {
    expect(await containsFilteredId(sock, { id: [sha256('present')] })).toBe(true);
    expect(await containsFilteredId(sock, { id: [sha256('absent')] })).toBe(false);
    expect(observed).toEqual([sha256('present'), sha256('absent')]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
