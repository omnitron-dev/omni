import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { duplexPair } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { ProjectService } from '../../src/services/project.service.js';
import { SlaveConnector } from '../../src/cluster/slave-connector.js';
import { meshManagementIdentity } from '../../src/cluster/mesh-link.js';
import * as delivery from '../../src/infrastructure/host-config-delivery.js';
import { HOST_BINDING_NAMES } from '../../src/shared/dto/host-bindings.js';
import { HOST_BINDING_PROFILES, hostBindingMaterial } from '../../src/infrastructure/host-binding-review.js';
import { installOverHostConfigChannel } from '../../src/infrastructure/host-config-delivery.js';
import { checkRequest, hostConfigAuthenticationFailure, hostConfigForwardFailure, HostConfigFrames, renderInstalledConfigs } from '../../src/infrastructure/host-config-transfer.js';
import type { IServiceOverride, IServiceRequirement } from '../../src/infrastructure/types.js';

const target = { project: 'fixture', stack: 'private', release: 'one', commit: '1'.repeat(40), manifestSha256: '2'.repeat(64),
  nodeId: 'receiver', sshFingerprint: 'SHA256:' + 'A'.repeat(43) };
const services: Record<string, IServiceRequirement> = {}, overrides: Record<string, IServiceOverride> = {};
const db = new Map<string, string>();
for (const name of HOST_BINDING_NAMES) {
  const p = HOST_BINDING_PROFILES[name];
  services[name] = { ports: {}, env: {}, bareMetal: { systemdUnit: p.unit, user: p.user, configFile: p.config,
    ...(p.chainDataDir && { dataDir: p.chainDataDir }), configTemplate: p.directives.join('\n') + '\n',
    unitTemplate: '[Service]\nUser=${user}\nExecStart=/usr/bin/fixture\n' } };
  const slots = p.directives.flatMap(line => [...line.matchAll(/\$\{secret:(\w+)\}/g)].map(m => m[1]!));
  overrides[name] = { networkMode: 'mainnet', provisioning: 'bareMetal', secrets: Object.fromEntries(slots.map(slot => {
    const key = name + '.' + slot;
    db.set(key, slot === 'rpc_auth' ? 'fixture:' + 'b'.repeat(32) + '$' + 'c'.repeat(64) : 'fixture-only');
    return [slot, { secret: key }];
  })) };
}
const material = hostBindingMaterial(target, services, overrides);
const grant = { review: material.review.digest, ticket: randomUUID(), nodeId: target.nodeId };
const receipt = { ...grant, protocol: 1, files: HOST_BINDING_NAMES.map(profile => ({ profile, receipt: '0'.repeat(64) })) };

describe('a reviewed passive installation', () => {
  it('separates pre-vault SSH refusals from an unknown outcome through the public stack command', async () => {
    const daemon = await import('../../src/daemon/daemon-client.js'), output = await import('../../src/commands/output.js');
    const { stackInstallHostConfigsCommand } = await import('../../src/commands/stack.js');
    const request = { ...grant, project: target.project, stack: target.stack, release: target.release, prepared: 'e'.repeat(64) };
    const install = vi.fn(), disconnect = vi.fn(), service = vi.fn(async () => ({ installReviewedHostConfigs: install }));
    const client = vi.spyOn(daemon, 'createDaemonClient').mockReturnValue({ service, disconnect } as never);
    const shown = vi.spyOn(output, 'emitError').mockReturnValue(true);
    const exitCode = process.exitCode;
    try {
      for (const error of [hostConfigAuthenticationFailure, hostConfigForwardFailure, 'opaque private detail']) {
        install.mockRejectedValueOnce(Error(error));
        await stackInstallHostConfigsCommand(request);
      }
      expect(service).toHaveBeenCalledWith('OmnitronProject'); expect(install).toHaveBeenCalledWith(request);
      expect(shown.mock.calls.map(row => row[0])).toEqual([expect.stringMatching(/authentication.*before service vault/i),
        expect.stringMatching(/ticket socket before service vault/i), 'Host configuration installation is unconfirmed. Inspect the original ticket before retrying.']);
      expect(disconnect).toHaveBeenCalledTimes(3);
    } finally { client.mockRestore(); shown.mockRestore(); process.exitCode = exitCode; }
  });
  it('accepts only the seven public selectors through admin dispatch', () => {
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'installReviewedHostConfigs')).toEqual({ roles: ['admin'] });
    const request = { ...grant, project: target.project, stack: target.stack, release: target.release, prepared: '1'.repeat(64) };
    expect(() => checkRequest(request)).not.toThrow();
    for (const field of ['secret', 'target', 'publicKey', 'config', 'command', 'host', 'sshFingerprint']) {
      expect(() => checkRequest({ ...request, [field]: 'substitution' })).toThrow();
    }
  });

  it.each(['stale-identity', 'wrong-ticket', 'expired', 'already-installed', 'approved'] as const)(
    'consults the fixed vault scope only after independent approval for %s', async mode => {
      const [master, receiver] = duplexPair();
      const peer = new HostConfigFrames(receiver);
      const get = vi.fn(async (key: string) => db.get(key) ?? null);
      const recheck = vi.fn(async () => {
        if (mode === 'stale-identity' && recheck.mock.calls.length > 1) throw Error('changed registration');
      });
      const remote = (async () => {
        const hello = await peer.read();
        expect(JSON.stringify(hello)).not.toMatch(/fixture-only|bitcoin\.rpc_auth/);
        if (mode === 'already-installed') return peer.send({ done: receipt });
        const nonce = randomUUID();
        await peer.send({ ...grant, nonce, expires: Date.now() + (mode === 'expired' ? -1 : 100000),
          ...(mode === 'wrong-ticket' && { ticket: randomUUID() }) });
        if (mode !== 'approved') return;
        const body = await peer.read(); expect(body.nonce).toBe(nonce);
        const rendered = renderInstalledConfigs(hello, body.values);
        expect(rendered['bitcoin']).toContain('rpcauth=fixture:');
        await peer.send({ done: receipt });
      })();
      try {
        const result = installOverHostConfigChannel(grant, material, master, recheck, get);
        if (mode === 'approved' || mode === 'already-installed') await expect(result).resolves.toEqual(receipt);
        else await expect(result).rejects.toThrow();
        await remote;
        expect(get.mock.calls.map(args => args[0]).sort()).toEqual(mode === 'approved' ? [...db.keys()].sort() : []);
      } finally { master.destroy(); receiver.destroy(); }
    });

  it('refuses a substituted template before opening the vault or sending any public material', async () => {
    const [master, peer] = duplexPair(), get = vi.fn(async () => 'unavailable');
    try {
      await expect(installOverHostConfigChannel(grant, { ...material, templates: { ...material.templates, bitcoin: 'extra=1' } },
        master, vi.fn(), get)).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    } finally { master.destroy(); peer.destroy(); }
  });

  it('accepts only the admitted credential fields and single-line native values', () => {
    const hello = { grant, review: material.review, templates: material.templates };
    const values = Object.fromEntries(Object.entries(material.references).map(([name, refs]) =>
      [name, Object.fromEntries(Object.entries(refs).map(([k, ref]) => [k, db.get(ref.secret)!]))]));
    expect(() => renderInstalledConfigs(hello, values)).not.toThrow();
    expect(() => renderInstalledConfigs(hello, { ...values, another: 'field' })).toThrow();
    expect(() => renderInstalledConfigs(hello, { ...values, 'monero-daemon': { ...values['monero-daemon'], rpc_user: 'line\nextra=1' } })).toThrow();
    expect(() => renderInstalledConfigs(hello, { ...values, bitcoin: { rpc_auth: 'plaintext' } })).toThrow();
  });

  it.each(['approved', 'direct', 'foreign registration', 'changed during ping', 'unapproved source'])(
    'uses the saved administrative selection and pinned authenticated mesh for %s', async mode => {
      const request = { ...grant, project: target.project, stack: target.stack, release: target.release, prepared: 'e'.repeat(64) };
      const ssh = { host: 'fixture.invalid', username: 'root', expectedHostFingerprint: target.sshFingerprint };
      const managementIdentity = meshManagementIdentity(target.nodeId, ssh), ping = vi.fn(async () => ({ version: 'fixture' }));
      const mesh = Object.assign(Object.create(SlaveConnector.prototype), { connections: new Map([['fixture.invalid:9700',
        { peer: { queryInterface: async () => ({ ping }) }, status: 'connected', authenticated: true, config: { nodeId: target.nodeId },
          link: { via: mode === 'direct' ? 'direct' : 'ssh-tunnel', managementIdentity, expiresAt: Date.now() + 100000, token: 'fixture-token' } }]]) });
      const bound = { host: ssh.host, port: 9700, pin: 'fixture-pin', fingerprint: target.sshFingerprint, managementIdentity };
      const get = vi.fn(async (key: string) => db.get(key) ?? null);
      const service = Object.assign(Object.create(ProjectService.prototype), {
        resolveProjectStack: async () => ({ project: target.project, stack: target.stack }),
        preparedRemoteRelease: vi.fn(async (_p: string, _s: string, _r: string, digest: string) => {
          if (mode === 'unapproved source' || digest !== request.prepared) throw Error('No administrative approval');
          return { receipt: { ...target, digest }, target: bound, opened: { stackConfig: { serviceOverrides: overrides }, config: {} }, admitted: { remoteDefinitions: new Map() } };
        }),
        releaseRecipient: () => mode === 'foreign registration' || (mode === 'changed during ping' && ping.mock.calls.length > 0)
          ? { ...bound, managementIdentity: 'foreign' } : bound,
        collectDeclaredServices: async () => services, getSlaveConnector: () => mesh, resolveNodeCredentials: async () => ssh, secrets: { get },
      });
      const [master, receiver] = duplexPair();
      const opened = vi.spyOn(delivery, 'connectHostConfigInstaller').mockResolvedValue({ stream: master, close: () => master.destroy() } as never);
      try {
        const scope = new ProjectRpcService(service);
        if (mode === 'approved') {
          const channel = new HostConfigFrames(receiver);
          const remote = (async () => {
            await channel.read(); await channel.send({ ...grant, nonce: randomUUID(), expires: Date.now() + 100000 });
            await channel.read(); await channel.send({ done: receipt });
          })();
          await expect(scope.installReviewedHostConfigs(request)).resolves.toEqual(receipt); await remote;
          expect(get.mock.calls.map(args => args[0]).sort()).toEqual([...db.keys()].sort());
          expect(ping.mock.calls.length).toBeGreaterThanOrEqual(3);
        } else {
          await expect(scope.installReviewedHostConfigs(request)).rejects.toThrow();
          expect(get).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
        }
      } finally { opened.mockRestore(); master.destroy(); receiver.destroy(); }
    });
});
