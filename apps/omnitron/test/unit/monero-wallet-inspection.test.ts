import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IStackConfig } from '../../src/config/types.js';
import type { SSHTarget } from '../../src/execution/execution.service.js';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { validateAccessRequirements } from '@omnitron-dev/titan/netron/auth';
import { meshManagementIdentity } from '../../src/cluster/mesh-link.js';
import {
  checkWalletMembership, checkWalletProfile, inspectMoneroWallet, walletChallengeResponse,
} from '../../src/infrastructure/monero-wallet-inspection.js';
import { MONERO_WALLET_PROBE } from '../../src/infrastructure/monero-wallet-probe.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { ProjectService } from '../../src/services/project.service.js';
import { shellEscape } from '../../src/shared/shell-escape.js';

const transport = vi.hoisted(() => ({ connect: vi.fn(), exec: vi.fn(), dispose: vi.fn() }));
vi.mock('@xec-sh/ssh', () => ({ SSHClient: class {
  connect = transport.connect;
  exec = transport.exec;
  dispose = transport.dispose;
} }));

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const request = { project: 'demo', stack: 'ledger', nodeId: 'source', fingerprint: 'SHA256:' + 'A'.repeat(43),
  unit: 'monero-wallet-rpc.service' as const, port: 29742, userRef: 'fixture/wallet/user',
  passwordRef: 'fixture/wallet/password', nonce: sha('test nonce'), members: [sha('member one'), sha('member two')] };
const target: SSHTarget = { host: 'fixture.invalid', port: 22, username: 'root', expectedHostFingerprint: request.fingerprint };
const profile = { provisioning: 'bareMetal' as const, networkMode: 'mainnet',
  secrets: { rpc_user: { secret: request.userRef }, rpc_password: { secret: request.passwordRef } } };
const registered: IStackConfig = { type: 'remote', serviceOverrides: { 'monero-wallet-rpc': profile } };
const login = vi.fn(async () => ({ user: 'synthetic-reader', password: 'synthetic-credential' }));
const challenge = 'Digest realm="monero-rpc", nonce="aGVsbG8=", algorithm=MD5-sess, qop="auth"';
const receipt = { primarySha256: sha('synthetic-primary'), checked: 2, matched: 2 };
type ProbeStreams = {stdin: Readable; onStdout: (chunk: Buffer) => void};

function responder(reply: unknown, code = 0, check?: (header: string) => void) {
  transport.exec.mockImplementation(async (_cmd: string, io: ProbeStreams) => {
    const frames = createInterface({ input: io.stdin });
    const lines = frames[Symbol.asyncIterator]();
    try {
      const frame = JSON.parse((await lines.next()).value!);
      expect(frame).toEqual({ unit: request.unit, port: request.port, nonce: request.nonce, members: request.members });
      expect(login).not.toHaveBeenCalled();
      io.onStdout(Buffer.from(JSON.stringify({ challenge })+'\n'));
      const header = JSON.parse((await lines.next()).value!);
      expect(header).toMatch(/^Digest /);
      expect(header).not.toContain('synthetic-credential');
      check?.(header);
      if (reply !== null) io.onStdout(Buffer.from(JSON.stringify(reply)+'\n'));
      return { code };
    } finally { frames.close(); }
  });
}

describe('registered mainnet wallet ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); transport.exec.mockReset(); });

  it('accepts only the declared wallet, mainnet mode and two distinct symbolic profile fields', () => {
    expect(() => checkWalletMembership(request)).not.toThrow();
    expect(checkWalletProfile(registered, request)).toEqual({ user: request.userRef, password: request.passwordRef });
    for (const bad of [
      { ...request, members: [] }, { ...request, members: [request.members[0]!, request.members[0]!] },
      { ...request, members: ['a public address instead of a hash'] }, { ...request, port: 0 },
      { ...request, unit: 'other.service' }, { ...request, userRef: request.passwordRef },
      { ...request, members: Array.from({ length: 8193 }, (_, n) => sha(String(n))) }, { ...request, url: 'http://fixture.invalid' },
    ]) expect(() => checkWalletMembership(bad as typeof request)).toThrow();
    for (const cfg of [
      { type: 'local', serviceOverrides: registered.serviceOverrides }, { type: 'remote' },
      { type: 'remote', serviceOverrides: { 'monero-wallet-rpc': { ...profile, networkMode: 'stagenet' } } },
      { type: 'remote', serviceOverrides: { 'monero-wallet-rpc': profile, 'worker/monero-wallet-rpc': profile } },
      { type: 'remote', serviceOverrides: { 'monero-wallet-rpc': { ...profile, secrets: { ...profile.secrets, rpc_user: 'literal' } } } },
    ]) expect(() => checkWalletProfile(cfg as IStackConfig, request)).toThrow();
    expect(() => checkWalletProfile(registered, { ...request, passwordRef: 'different/credential' })).toThrow();
  });

  it('requires a supported Digest challenge before opening either credential', async () => {
    for (const bad of ['Basic realm="wallet"', 'Digest realm="x", nonce="a", algorithm=SHA-256, qop="auth"',
      'Digest realm="x", nonce="one", nonce="two", qop="auth"', 'Digest realm="x", nonce="a", qop="auth-int"',
      'Digest realm="x", nonce="a", qop="auth"\r\nbad']) {
      await expect(walletChallengeResponse(bad, login)).rejects.toThrow();
    }
    expect(login).not.toHaveBeenCalled();
    const header = await walletChallengeResponse(challenge, login);
    const field = (key: string) => new RegExp('(?:^Digest |, )'+key+'=(?:"([^"]+)"|([^, ]+))').exec(header);
    const cnonce = field('cnonce')![1]!;
    const ha1 = md5(md5('synthetic-reader:monero-rpc:synthetic-credential')+':aGVsbG8=:'+cnonce);
    expect(field('response')![1]).toBe(md5(ha1+':aGVsbG8=:00000001:'+cnonce+':auth:'+md5('POST:/json_rpc')));
    expect(header).not.toContain('synthetic-credential');
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('sends the fixed probe on pinned SSH and returns the public receipt', async () => {
    responder(receipt);
    await expect(inspectMoneroWallet(target, request, login)).resolves.toEqual({
      ...receipt, membershipSha256: sha(JSON.stringify([request.nonce, [...request.members].sort()])),
    });
    expect(transport.connect).toHaveBeenCalledWith(expect.objectContaining(target));
    expect(transport.exec.mock.calls[0]![0]).toBe('python3 -I -c '+shellEscape(MONERO_WALLET_PROBE));
    expect(transport.dispose).toHaveBeenCalled();
  });

  it('keeps an unauthorized node, an unverified listener and refused Digest outside successful receipts', async () => {
    await expect(inspectMoneroWallet({ ...target, expectedHostFingerprint: 'other' }, request, login)).rejects.toThrow();
    await expect(inspectMoneroWallet({ ...target, username: 'viewer' }, request, login)).rejects.toThrow();
    expect(transport.connect).not.toHaveBeenCalled();
    transport.exec.mockResolvedValueOnce({ code: 1 });
    await expect(inspectMoneroWallet(target, request, login)).rejects.toThrow();
    expect(login).not.toHaveBeenCalled();
    responder(null, 1);
    await expect(inspectMoneroWallet(target, request, login)).rejects.toThrow();
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('rejects an impossible membership count or extra data from the node', async () => {
    for (const bad of [{ ...receipt, checked: 3 }, { ...receipt, matched: 3 }, { ...receipt, addresses: [] }]) {
      login.mockClear(); responder(bad);
      await expect(inspectMoneroWallet(target, request, login)).rejects.toThrow();
    }
  });

  it('uses the administrator RPC and resolves only the two references bound to the selected node', async () => {
    const permission = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'inspectMoneroWallet');
    expect(permission).toEqual({ roles: ['admin'] });
    for (const role of ['admin', 'operator', 'viewer', 'service_role']) {
      expect(validateAccessRequirements({ roles: [role], permissions: [] }, permission).allowed).toBe(role === 'admin');
    }
    const scope = { ...registered, nodes: [{ nodeId: request.nodeId, host: target.host, port: 9700 }] };
    const recipient = { host: target.host, port: 9700, fingerprint: request.fingerprint,
      managementIdentity: meshManagementIdentity(request.nodeId, target) };
    const get = vi.fn(async (ref: string) => ref === request.userRef ? 'synthetic-reader' : 'synthetic-credential');
    const services = Object.assign(Object.create(ProjectService.prototype) as ProjectService, {
      resolveProjectStack: async () => ({ project: request.project, stack: request.stack }),
      ensureConfig: vi.fn(), registeredRemoteScope: () => ({ fingerprint: 'frozen-registration', stack: scope }),
      placement: () => undefined, placementRecipient: () => recipient, resolveNodeCredentials: async () => target,
      secrets: { get },
    });
    const rpc = new ProjectRpcService(services);
    responder(receipt);
    await expect(rpc.inspectMoneroWallet(request)).resolves.toMatchObject(receipt);
    expect(get.mock.calls.map(v => v[0])).toEqual([request.userRef, request.passwordRef]);
    get.mockClear();
    await expect(rpc.inspectMoneroWallet({ ...request, userRef: 'unrelated/profile' })).rejects.toThrow();
    await expect(rpc.inspectMoneroWallet({ ...request, nodeId: 'other-node' })).rejects.toThrow();
    recipient.managementIdentity = 'other-management-route';
    await expect(rpc.inspectMoneroWallet(request)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });
});
