import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { verifyWalletAddressesCommand } from '../../src/commands/wallet-membership.js';

const api = vi.hoisted(() => ({ inspect: vi.fn(), disconnect: vi.fn(), output: vi.fn(), error: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ LONG_REQUEST_TIMEOUT: 100,
  createDaemonClient: () => ({ service: async () => ({ inspectMoneroWallet: api.inspect }), disconnect: api.disconnect }) }));
vi.mock('../../src/commands/output.js', () => ({ emitJson: api.output, emitError: api.error, emitInfo: vi.fn() }));

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const priorExit = process.exitCode;
const input = { nodeId: 'node', fingerprint: 'SHA256:'+'A'.repeat(43), unit: 'monero-wallet-rpc.service',
  port: 29374, userRef: 'fixture/user', passwordRef: 'fixture/password', nonce: sha('test nonce'), members: [sha('b'),sha('a')] };
const good = { primarySha256: sha('fixture primary'), checked: 2, matched: 2,
  membershipSha256: sha(JSON.stringify([input.nonce, [...input.members].sort()])) };
beforeEach(() => {
  vi.clearAllMocks(); process.exitCode = undefined;
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from([JSON.stringify(input)]) as typeof process.stdin);
  api.output.mockReturnValue(true);
});
afterEach(() => { process.exitCode = priorExit; vi.restoreAllMocks(); });

it('accepts all historical members only with the receipt for the submitted set', async () => {
  api.inspect.mockResolvedValue(good);
  await verifyWalletAddressesCommand('demo', 'ledger');
  expect(api.inspect).toHaveBeenCalledWith({ ...input, project: 'demo', stack: 'ledger' });
  expect(api.output).toHaveBeenCalledWith(good);
  expect(api.error).not.toHaveBeenCalled(); expect(api.disconnect).toHaveBeenCalledOnce();
});

it.each([
  ['missing historical member', { ...good, matched: 1 }],
  ['different set with the same cardinality', { ...good, membershipSha256: sha('different request') }],
  ['malformed primary address fingerprint', { ...good, primarySha256: 'unverified' }],
])('refuses %s', async (_name, outcome) => {
  api.inspect.mockResolvedValue(outcome);
  await verifyWalletAddressesCommand('demo', 'ledger');
  expect(Number(process.exitCode)).toBe(1);
  expect(api.error).toHaveBeenCalledOnce(); expect(api.output).not.toHaveBeenCalled();
});
