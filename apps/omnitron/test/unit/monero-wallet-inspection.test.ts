import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
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
  checkWalletMembership, checkWalletProfile, inspectMoneroWallet, verifyWalletMembershipReceipt, walletChallengeResponse, walletMembershipDigest,
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

function responder(reply: unknown, code = 0, check?: (header: string) => void, host?: string, indexedChallenges = 0) {
  transport.exec.mockImplementation(async (_cmd: string, io: ProbeStreams) => {
    const frames = createInterface({ input: io.stdin });
    const lines = frames[Symbol.asyncIterator]();
    try {
      const frame = JSON.parse((await lines.next()).value!);
      expect(frame).toEqual({ unit: request.unit, port: request.port, host, nonce: request.nonce, members: request.members,
        ...(indexedChallenges && { lookup: 'node-ledger' }) });
      expect(login).not.toHaveBeenCalled();
      for (let i = 0; i < (indexedChallenges || 1); i++) {
        io.onStdout(Buffer.from(JSON.stringify({ challenge })+'\n'));
        const header = JSON.parse((await lines.next()).value!);
        expect(header).toMatch(/^Digest /);
        expect(header).not.toContain('synthetic-credential');
        check?.(header);
      }
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
      { ...request, lookup: 'arbitrary-ledger' }, { ...request, lookup: 'node-ledger', path: '/another/file' },
      { ...request, lookup: 'node-ledger', members: Array.from({ length: 257 }, (_, n) => sha(String(n))) },
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

  it('uses the endpoint and credentials declared by a pre-existing wallet service', async () => {
    const external = { host: '192.0.2.8', ports: { rpc: request.port }, secrets: profile.secrets };
    const stack = (endpoint: typeof external) => ({ type: 'remote', serviceOverrides: {
      'monero-wallet-rpc': { networkMode: 'mainnet', external: endpoint },
    } }) satisfies IStackConfig;
    const binding = checkWalletProfile(stack(external), request);
    expect(binding).toEqual({ user: request.userRef, password: request.passwordRef, host: external.host });
    for (const endpoint of [{ ...external, ports: { rpc: request.port + 1 } }, { ...external, host: 'wallet.invalid' },
      { ...external, secrets: { ...profile.secrets, rpc_user: { secret: 'different/user' } } }]) {
      expect(() => checkWalletProfile(stack(endpoint), request)).toThrow();
    }
    responder(receipt, 0, undefined, external.host);
    await expect(inspectMoneroWallet(target, request, login, binding.host)).resolves.toMatchObject(receipt);
  });

  it('accepts a declared IP only on a matching listener with a local route', () => {
    const verify = `
import json,sys
from unittest.mock import patch
p={'__name__':'wallet_probe'}
exec(sys.stdin.read(),p)
def verify(listener, declared, route, success):
    def command(*args):
        if args[0]=='systemctl': return '48'
        if args[0]=='ss': return 'LISTEN 0 32 '+listener+':29742 *:* users:(("monero-wallet-rpc",pid=48,fd=3))'
        assert args==('ip','-j','-6' if ':' in declared else '-4','route','get',declared)
        return json.dumps([route])
    with patch.dict(p,{'command':command}), patch('os.readlink',return_value='/usr/bin/monero-wallet-rpc'):
        try: result=p['socket_identity']('monero-wallet-rpc.service',29742,declared)
        except ValueError:
            assert not success
        else:
            assert success and result==(48,declared)
local={'dev':'lo','type':'local'}
remote={'dev':'eth0','type':'unicast'}
verify('192.0.2.8','192.0.2.8',local,True)
verify('192.0.2.8','192.0.2.9',local,False)
verify('0.0.0.0','192.0.2.8',remote,False)
verify('0.0.0.0','192.0.2.8',local,True)
verify('[::]','2001:db8::8',local,True)
verify('0.0.0.0','2001:db8::8',local,False)
verify('0.0.0.0','0.0.0.0',local,False)
`;
    execFileSync('python3', ['-I', '-c', verify], { input: MONERO_WALLET_PROBE, timeout: 5000 });
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

  it('keeps transport errors, lookahead indices and mismatched full addresses out of successful matches', () => {
    const check = `import json,sys
p={'__name__':'testing'}; exec(sys.stdin.read(),p)
primary='4'+'A'*94; elsewhere='8'+'B'*94; known='8'+'C'*94; other='8'+'D'*94; foreign='8'+'E'*94
nonce='1'*64; members={p['digest'](nonce+':'+row):row for row in (known,elsewhere,other,foreign)}
def account(addr,extra=()):
    return {'result':{'address':addr,'addresses':[{'address_index':i,'address':a} for i,a in enumerate([addr,*extra])]}}
def probe(mode):
    def rpc(method,params):
        if method=='get_accounts':
            base=foreign if mode=='changed' else primary
            root=foreign if mode=='switchedAccount' else elsewhere
            return {'result':{'subaddress_accounts':[{'account_index':0,'base_address':base},{'account_index':1,'base_address':root}]}}
        if method=='get_address_index':
            addr=params['address']
            if addr==foreign:
                if mode=='transport': return {'error':{'code':-13,'message':'Wallet unavailable'}}
                return {'error':{'code':-2,'message':"Address doesn't belong to the wallet"}}
            return {'result':{'index':{'major':1 if addr==elsewhere else 28,'minor':0}}}
        assert method=='get_address'
        major=params['account_index']
        if major==0:
            if 'address_index' in params: return account('4'+'F'*94 if mode=='changed' else primary)
            return account(primary,[known])
        if major==1: return account(other if mode=='mismatch' else elsewhere)
        return {'error':{'code':-14}}
    return p['membership'](rpc,nonce,list(members),members)
r=probe('ok'); assert r['matched']==2 and r['checked']==4 and r['indexed']['indexOnly']==1 and r['indexed']['otherAccountMatches']==1
for mode in ('transport','mismatch','changed','switchedAccount'):
    try: probe(mode)
    except ValueError: pass
    else: raise AssertionError(mode)
`;
    execFileSync('python3', ['-I', '-c', check], { input: MONERO_WALLET_PROBE, timeout: 5000 });
  });

  it('binds the indexed receipt to the requested input and exact matched set', async () => {
    const input = { ...request, lookup: 'node-ledger' as const };
    const membershipSha256 = walletMembershipDigest(input);
    const full = { ...receipt, membershipSha256, indexed: { indexOnly: 0, otherAccountMatches: 1, matchedSetSha256: membershipSha256 } };
    expect(() => checkWalletMembership(input)).not.toThrow();
    expect(() => verifyWalletMembershipReceipt(input, full)).not.toThrow();
    expect(() => verifyWalletMembershipReceipt(input, { ...receipt, membershipSha256 })).toThrow();
    for (const invalid of [{ ...full.indexed, indexOnly: 1 }, { ...full.indexed, matchedSetSha256: sha('different set') },
      { ...full.indexed, otherAccountMatches: 3 }])
      expect(() => verifyWalletMembershipReceipt(input, { ...full, indexed: invalid })).toThrow();
    expect(() => verifyWalletMembershipReceipt(request, full)).toThrow();
    responder({ ...receipt, indexed: full.indexed }, 0, undefined, undefined, 4);
    await expect(inspectMoneroWallet(target, input, login)).resolves.toEqual(full);
    expect(login).toHaveBeenCalledTimes(4);
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

  it.each([undefined, '192.0.2.8'])('uses the administrator RPC and the references bound to the selected node (declared IP %s)', async host => {
    const permission = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'inspectMoneroWallet');
    expect(permission).toEqual({ roles: ['admin'] });
    for (const role of ['admin', 'operator', 'viewer', 'service_role']) {
      expect(validateAccessRequirements({ roles: [role], permissions: [] }, permission).allowed).toBe(role === 'admin');
    }
    const wallet = host ? { networkMode: 'mainnet', external: { host, ports: { rpc: request.port }, secrets: profile.secrets } } : profile;
    const scope = { ...registered, serviceOverrides: { 'monero-wallet-rpc': wallet }, nodes: [{ nodeId: request.nodeId, host: target.host, port: 9700 }] };
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
    responder(receipt, 0, undefined, host);
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
