import { open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { OutputCommand } from '../cli/output-command.js';
import type { RetainedBindingsRpcService } from '../services/retained-bindings.rpc-service.js';

async function file(name: string, max: number) {
  const raw = await readFile(name);
  if (!raw.length || raw.length > max) throw Error('Unexpected retained binding input size');
  return raw.toString('utf8');
}
async function invoke(action: (rpc: RetainedBindingsRpcService) => Promise<unknown>, output?: string) {
  const { createDaemonClient } = await import('../daemon/daemon-client.js');
  const client = createDaemonClient(undefined, 300000);
  const handle = output ? await open(output, 'wx', 0o600) : null;
  try {
    const result = await action(await client.service<RetainedBindingsRpcService>('OmnitronRetainedBindings'));
    const bytes = JSON.stringify(result) + '\n';
    if (handle) {
      await handle.writeFile(bytes); await handle.sync();
      process.stdout.write(JSON.stringify({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.byteLength(bytes) }) + '\n');
    } else process.stdout.write(bytes);
  } finally { try { await handle?.close(); } finally { await client.disconnect(); } }
}
export function registerRetainedBindings(program: OutputCommand) {
  const group = program.command('retained-bindings').description('Authorize historical infrastructure comparisons on this owner');
  group.command('identity').allowExcessArguments(false).description('Register and display the local public identity')
    .structuredAction(async () => invoke(rpc => rpc.identity()));
  group.command('approve <ticket>').allowExcessArguments(false).description('Approve one reviewed purpose on this historical owner')
    .requiredOption('--expect <sha>', 'Independent SHA-256 of the canonical ticket JSON')
    .requiredOption('--declaration <file>', 'Exact public release declaration')
    .option('--comparison <file>', 'Previous signed comparison for a closed consumer')
    .option('--options <file>', 'Source-local public options committed by a consumer ticket')
    .structuredAction(async (name: string, opt: { expect: string; declaration: string; comparison?: string; options?: string }) => {
      const ticket = JSON.parse(await file(name, 16384)), declaration = await file(opt.declaration, 262144);
      const comparison = opt.comparison ? JSON.parse(await file(opt.comparison, 4096)) : null;
      const options = opt.options ? await file(opt.options, 16384) : null;
      await invoke(rpc => rpc.approve({ ticket, expect: opt.expect, declaration, comparison, options }));
    });
  group.command('apply <id>').allowExcessArguments(false).description('Issue the sealed master packet or obtain its source receipt')
    .requiredOption('--expect <sha>', 'Independently approved ticket SHA-256')
    .option('--capsule <file>', 'Sealed packet from the registered historical master')
    .option('--source-approval <file>', 'Source-signed grant required before the master reads its fixed row')
    .option('--out <new-file>', 'Create an owner-only output file, required when issuing a sealed packet')
    .structuredAction(async (id: string, opt: { expect: string; capsule?: string; sourceApproval?: string; out?: string }) => {
      if (opt.sourceApproval && !opt.out) throw Error('Select a new owner-only packet file with --out');
      const capsule = opt.capsule ? JSON.parse(await file(opt.capsule, 36000)) : null;
      const sourceApproval = opt.sourceApproval ? JSON.parse(await file(opt.sourceApproval, 4096)) : null;
      await invoke(rpc => rpc.apply({ id, expect: opt.expect, capsule, sourceApproval }), opt.out);
    });
  group.command('revoke <id>').allowExcessArguments(false).description('Revoke an unused local approval')
    .requiredOption('--expect <sha>', 'Independently approved ticket SHA-256')
    .structuredAction(async (id: string, opt: { expect: string }) => invoke(rpc => rpc.revoke({ id, expect: opt.expect })));
}
