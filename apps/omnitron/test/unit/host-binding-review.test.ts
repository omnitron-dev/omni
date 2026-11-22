import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { validateAccessRequirements } from '@omnitron-dev/titan/netron/auth';
import { reviewHostBindings } from '../../src/infrastructure/host-binding-review.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import type { IServiceOverride, IServiceRequirement } from '../../src/infrastructure/types.js';
import { ProjectService } from '../../src/services/project.service.js';

const target = { project: 'demo', stack: 'ledger', release: 'release-7', commit: 'a'.repeat(40),
  manifestSha256: 'c'.repeat(64), nodeId: 'receiver', sshFingerprint: 'SHA256:' + 'A'.repeat(43) };
const services: Record<string, IServiceRequirement> = {};
const overrides: Record<string, IServiceOverride> = {};
for (const [name, unit, user, config, fields] of [
  ['bitcoin', 'bitcoind', 'bitcoin', '/etc/bitcoin/bitcoin.conf', 'rpcauth=${secret:rpc_auth}'],
  ['monero-daemon', 'monerod', 'monero', '/etc/monero/monerod.conf', 'rpc-login=${secret:rpc_user}:${secret:rpc_password}'],
  ['monero-wallet-rpc', 'monero-wallet-rpc', 'monero-wallet', '/etc/monero/monero-wallet-rpc.conf',
    'daemon-login=${secret:daemon_user}:${secret:daemon_password}\nrpc-login=${secret:rpc_user}:${secret:rpc_password}'],
] as const) {
  services[name] = { env: {}, ports: {}, bareMetal: { variants: { mainnet: { systemdUnit: unit, user, configFile: config,
    dataDir: name === 'bitcoin' ? '/var/lib/bitcoind' : '/var/lib/monero/.bitmonero',
    configTemplate: fields + '\n', unitTemplate: '[Service]\nUser=${user}\nExecStart=/usr/bin/fixture-service\n' } } } };
  overrides[name] = { networkMode: 'mainnet', provisioning: 'bareMetal',
    secrets: Object.fromEntries([...fields.matchAll(/\$\{secret:(\w+)\}/g)].map(m => [m[1]!, { secret: 'fixture.private.' + name + '.' + m[1] }])) };
}

describe('public review of passive host bindings', () => {
  it('restricts the native master method to a controller administrator at transport dispatch', () => {
    const rule = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'reviewStackHostBindings');
    expect(rule).toEqual({ roles: ['admin'] });
    for (const role of ['viewer', 'operator', 'service_role', 'admin']) {
      expect(validateAccessRequirements({ roles: [role], permissions: [] }, rule).allowed).toBe(role === 'admin');
    }
  });
  it('binds release, recipient and application-selected references while exposing only hashes and public file identities', () => {
    const plan = reviewHostBindings(target, services, overrides);
    expect(plan.bindings).toHaveLength(3);
    expect(JSON.stringify(plan)).not.toMatch(/fixture\.private|ExecStart|\$\{secret/);
    const rotated = structuredClone(overrides);
    rotated['bitcoin']!.secrets!['rpc_auth'] = { secret: 'another.fixture.ref' };
    expect(reviewHostBindings(target, services, rotated).digest).not.toBe(plan.digest);
    expect(reviewHostBindings({ ...target, nodeId: 'second' }, services, overrides).digest).not.toBe(plan.digest);
    expect(reviewHostBindings({ ...target, manifestSha256: 'd'.repeat(64) }, services, overrides).digest).not.toBe(plan.digest);
  });

  it('refuses literals, unsupported credential directives and other privileged or ambiguous variants', () => {
    const literal = structuredClone(overrides);
    literal['bitcoin']!.secrets!['rpc_auth'] = 'fixture-literal';
    expect(() => reviewHostBindings(target, services, literal)).toThrow(/declared vault reference/);
    const variant = structuredClone(services);
    variant['bitcoin']!.bareMetal!.variants!['mainnet']!.configTemplate += 'rpcpassword=fixture\n';
    expect(() => reviewHostBindings(target, variant, overrides)).toThrow(/admitted public credential/);
    variant['bitcoin']!.bareMetal!.variants!['mainnet']!.configTemplate = services['bitcoin']!.bareMetal!.variants!['mainnet']!.configTemplate!;
    variant['bitcoin']!.bareMetal!.variants!['mainnet']!.unitTemplate += 'ExecStartPre=+/usr/bin/fixture\n';
    expect(() => reviewHostBindings(target, variant, overrides)).toThrow(/unprivileged/);
    expect(() => reviewHostBindings(target, services, { ...overrides, 'app/bitcoin': overrides['bitcoin']! })).toThrow(/unambiguous/);
  });

  it('rejects caller-supplied secret selectors, credentials, public keys or templates before any project access', async () => {
    const resolveProjectStack = vi.fn(async () => ({ project: 'demo', stack: 'ledger' }));
    const reviewStackHostBindings = vi.fn(async () => reviewHostBindings(target, services, overrides));
    const rpc = new ProjectRpcService({ resolveProjectStack, reviewStackHostBindings } as unknown as ProjectService);
    const input = { project: 'demo', stack: 'ledger', release: 'release-7', nodeId: 'receiver' };
    for (const field of ['secret', 'publicKey', 'unit', 'config', 'fingerprint']) {
      await expect(rpc.reviewStackHostBindings({ ...input, [field]: 'injected' })).rejects.toThrow();
    }
    expect(resolveProjectStack).not.toHaveBeenCalled();
    await expect(rpc.reviewStackHostBindings(input)).resolves.toHaveProperty('protocol', 1);
    expect(reviewStackHostBindings).toHaveBeenCalledWith(input);
  });

  it('requires the checked release and exact registered pin before using captured service declarations', async () => {
    const stack = { type: 'remote', nodes: [{ nodeId: target.nodeId, host: 'fixture.invalid' }], serviceOverrides: overrides };
    const release = { id: target.release, remoteDefinitions: new Map(), manifestSha256: target.manifestSha256,
      manifest: { project: { commit: target.commit } } };
    const mock = { loadProjectConfig: vi.fn(async () => ({})), resolveStacks: () => ({ ledger: stack }),
      resolveNodeCredentials: vi.fn(async () => ({ expectedHostFingerprint: target.sshFingerprint })),
      admitRelease: vi.fn(async () => release), collectDeclaredServices: vi.fn(async () => services),
      resolveOverrideSecrets: vi.fn(() => { throw Error('A public review cannot read the vault'); }) };
    const review = ProjectService.prototype.reviewStackHostBindings.bind(mock as unknown as ProjectService);
    await expect(review(target)).resolves.toHaveProperty('digest');
    expect(mock.resolveNodeCredentials).toHaveBeenCalledWith('fixture.invalid', 9700, 'receiver');
    expect(mock.collectDeclaredServices).toHaveBeenCalledWith('demo', stack, {}, { definitions: release.remoteDefinitions });
    expect(mock.resolveOverrideSecrets).not.toHaveBeenCalled();
    await expect(review({ ...target, nodeId: 'unregistered' })).rejects.toThrow(/pinned recipient/);
    mock.admitRelease.mockRejectedValueOnce(Error('release changed'));
    await expect(review(target)).rejects.toThrow(/release changed/);
    expect(mock.collectDeclaredServices).toHaveBeenCalledTimes(1);
  });
});
