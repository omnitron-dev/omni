import { LONG_REQUEST_TIMEOUT, createDaemonClient } from '../daemon/daemon-client.js';
import { checkWalletMembership, verifyWalletMembershipReceipt } from '../infrastructure/monero-wallet-inspection.js';
import type { IProjectRpcService } from '../shared/dto/services.js';
import { emitError, emitInfo, emitJson } from './output.js';

export async function verifyWalletAddressesCommand(project: string, stack: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    if (process.stdin.isTTY) throw Error('Supply the wallet scope and salted address fingerprints as JSON on stdin');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > 650000) throw Error('The wallet membership request is too large');
      chunks.push(bytes);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || 'project' in input || 'stack' in input) throw Error('Supply project and stack on the command line');
    const request = { ...input, project, stack };
    checkWalletMembership(request);
    const service = await client.service<IProjectRpcService>('OmnitronProject');
    const receipt = await service.inspectMoneroWallet(request);
    verifyWalletMembershipReceipt(request, receipt);
    if (receipt.matched !== receipt.checked) {
      emitError('The wallet does not cover the complete issued-address set', { ...receipt });
      process.exitCode = 1;
      return;
    }
    if (!emitJson(receipt)) emitInfo(`Matched ${receipt.matched} issued subaddresses. Primary address SHA-256 ${receipt.primarySha256}`);
  } catch {
    emitError('Wallet verification failed. Check the registered profile, recipient and read-only wallet endpoint.');
    process.exitCode = 1;
  } finally { await client.disconnect(); }
}
