import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import type { SSHTarget } from '../execution/execution.service.js';
import type { IStackConfig } from '../config/types.js';
import type { WalletMembershipRequest, WalletMembershipReceipt } from '../shared/dto/host-bindings.js';
import { shellEscape } from '../shared/shell-escape.js';
import { digestAuthorization } from './host-inspection.js';
import { MONERO_WALLET_PROBE } from './monero-wallet-probe.js';
import { bindService } from './service-binding.js';

const hash = /^[0-9a-f]{64}$/;
const label = /^[\w][\w.-]{0,127}$/;
const reference = /^[\w./:-]{1,256}$/;
const invalid = () => Error('The wallet ownership request does not match a registered mainnet service');

export function checkWalletMembership(request: WalletMembershipRequest): void {
  if (!request || Object.keys(request).sort().join(',') !== 'fingerprint,members,nodeId,nonce,passwordRef,port,project,stack,unit,userRef' ||
      ![request.project, request.stack, request.nodeId].every(value => typeof value === 'string' && label.test(value)) ||
      typeof request.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(request.fingerprint) ||
      !['monero-walletd.service', 'monero-wallet-rpc.service'].includes(request.unit) ||
      !Number.isSafeInteger(request.port) || request.port < 1 || request.port > 65535 ||
      ![request.userRef, request.passwordRef].every(value => typeof value === 'string' && reference.test(value)) ||
      request.userRef === request.passwordRef || typeof request.nonce !== 'string' || !hash.test(request.nonce) ||
      !Array.isArray(request.members) || request.members.length < 1 || request.members.length > 8192 ||
      !request.members.every(value => typeof value === 'string' && hash.test(value)) ||
      new Set(request.members).size !== request.members.length) throw invalid();
}

/** Bind the two symbolic inputs independently of the operator's request. */
export function checkWalletProfile(stack: IStackConfig, request: WalletMembershipRequest) {
  const overrides = stack.serviceOverrides;
  const wallet = overrides?.['monero-wallet-rpc'];
  if (stack.type !== 'remote' || !wallet ||
      Object.keys(overrides!).some(key => key.endsWith('/monero-wallet-rpc'))) throw invalid();
  const binding = bindService({}, wallet);
  const port = binding.ports['rpc'];
  if (binding.networkMode !== 'mainnet' || !['bareMetal', 'external'].includes(binding.provisioning) ||
      (port !== undefined && port !== request.port)) throw invalid();
  const host = binding.host;
  if (binding.provisioning === 'external' && (!host || !isIP(host) || host.includes('%') ||
      port === undefined)) throw invalid();
  const bound = (key: string) => {
    const ref = binding.secrets[key];
    if (!ref || typeof ref !== 'object' || Object.keys(ref).length !== 1 || typeof ref.secret !== 'string') throw invalid();
    return ref.secret;
  };
  const user = bound('rpc_user'), password = bound('rpc_password');
  if (user !== request.userRef || password !== request.passwordRef) throw invalid();
  return { user, password, host };
}

type Login = { user: string; password: string };

export function walletMembershipDigest(request: Pick<WalletMembershipRequest, 'nonce' | 'members'>): string {
  return createHash('sha256').update(JSON.stringify([request.nonce, [...request.members].sort()])).digest('hex');
}

export function verifyWalletMembershipReceipt(request: WalletMembershipRequest, receipt: WalletMembershipReceipt): void {
  if (!receipt || typeof receipt.primarySha256 !== 'string' || !hash.test(receipt.primarySha256) ||
      receipt.membershipSha256 !== walletMembershipDigest(request) ||
      receipt.checked !== request.members.length || !Number.isSafeInteger(receipt.matched) ||
      receipt.matched < 0 || receipt.matched > receipt.checked) throw Error('Invalid wallet membership receipt');
}

/** Limit the vault proof to HTTP Digest auth on the fixed POST /json_rpc request. */
export async function walletChallengeResponse(challenge: unknown, login: () => Promise<Login>): Promise<string> {
  if (typeof challenge !== 'string' || challenge.length > 2048 || !/^Digest /i.test(challenge) || !/^[\x20-\x7e]+$/.test(challenge))
    throw invalid();
  const fields = new Map<string, string>();
  const token = /\s*([\w-]+)\s*=\s*(?:"([^"\\]*)"|([\w.-]+))\s*(?:,|$)/y;
  token.lastIndex = 7;
  while (token.lastIndex < challenge.length) {
    const pair = token.exec(challenge);
    if (!pair || fields.has(pair[1]!.toLowerCase())) throw invalid();
    fields.set(pair[1]!.toLowerCase(), pair[2] ?? pair[3]!);
  }
  const realm = fields.get('realm'), nonce = fields.get('nonce'), algorithm = (fields.get('algorithm') ?? 'MD5').toUpperCase();
  if (!realm || !nonce || !/^[A-Za-z0-9_. :/-]+$/.test(realm) || !/^[A-Za-z0-9+/=._:-]+$/.test(nonce) ||
      !['MD5', 'MD5-SESS'].includes(algorithm) || !fields.get('qop')?.split(',').some(v => v.trim() === 'auth')) throw invalid();
  const opaque = fields.get('opaque');
  if (opaque !== undefined && !/^[A-Za-z0-9+/=._:-]{1,256}$/.test(opaque)) throw invalid();
  const { user, password } = await login();
  if (!user || !/^[\x20-\x7e]+$/.test(user) || /[":\\]/.test(user) || user.length > 256 || !password || password.length > 4096) throw invalid();
  const canonical = 'Digest realm="' + realm + '",nonce="' + nonce + '",algorithm=' + algorithm + ',qop="auth"';
  const proof = digestAuthorization(canonical, { type: 'digest', user, password }, 'POST', '/json_rpc');
  return opaque === undefined ? proof : proof + ', opaque="' + opaque + '"';
}

export async function inspectMoneroWallet(target: SSHTarget, request: WalletMembershipRequest, login: () => Promise<Login>, host?: string): Promise<WalletMembershipReceipt> {
  checkWalletMembership(request);
  if (target.username !== 'root' || target.expectedHostFingerprint !== request.fingerprint) throw invalid();
  const { SSHClient } = await import('@xec-sh/ssh');
  const ssh = new SSHClient();
  const signal = AbortSignal.timeout(45000);
  const input = new PassThrough(), output = new PassThrough();
  const lines = createInterface({ input: output, crlfDelay: Infinity });
  const iter = lines[Symbol.asyncIterator]();
  let bytes = 0;
  let execution: Promise<{ code: number | null }> | undefined;
  try {
    await ssh.connect({ ...target, signal, readyTimeout: 10000 });
    execution = ssh.exec('python3 -I -c ' + shellEscape(MONERO_WALLET_PROBE), {
      signal, channelOpenTimeoutMs: 5000, stdin: input, collectStdout: false, collectStderr: false,
      onStdout(chunk) {
        bytes += chunk.length;
        if (bytes > 4096) { ssh.dispose(true); output.end(); return; }
        output.write(chunk);
      },
    }).finally(() => output.end());
    void execution.catch(() => undefined);
    const frame = async () => {
      const line = await iter.next();
      if (line.done || !line.value) throw invalid();
      return JSON.parse(line.value);
    };
    input.write(JSON.stringify({ unit: request.unit, port: request.port, host, nonce: request.nonce, members: request.members }) + '\n');
    const first = await frame();
    if (!first || Object.keys(first).join() !== 'challenge') throw invalid();
    const authorization = await walletChallengeResponse(first.challenge, login);
    signal.throwIfAborted();
    input.end(JSON.stringify(authorization) + '\n');
    const result = await frame();
    if ((await execution).code !== 0 || !(await iter.next()).done || bytes > 4096 || signal.aborted || !result ||
        Object.keys(result).sort().join(',') !== 'checked,matched,primarySha256' ||
        typeof result.primarySha256 !== 'string' || !hash.test(result.primarySha256) ||
        result.checked !== request.members.length || !Number.isSafeInteger(result.matched) || result.matched < 0 || result.matched > result.checked) throw invalid();
    const membershipSha256 = walletMembershipDigest(request);
    return { primarySha256: result.primarySha256, membershipSha256, checked: result.checked, matched: result.matched };
  } catch {
    throw Error('The registered wallet and its issued addresses could not be verified');
  } finally {
    input.destroy(); output.end(); lines.close(); ssh.dispose(true);
    await execution?.catch(() => undefined);
  }
}
