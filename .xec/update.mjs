import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Pipeline } from '@xec-sh/ops/pipeline';
import { UserError } from '@xec-sh/ops';
import { releaseCommand, ReleaseCommandError } from '@xec-sh/ops/release';
import { qualifiedRuntimes } from './qualification.mjs';
import { localRuntime } from './local-runtime.mjs';

/** Xec orchestrates; the daemon remains the authority for pins, roles, locks and recovery. */
export async function runUpdate(args, options = {}) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    cli: { type: 'string' }, runtime: { type: 'string', multiple: true },
    node: { type: 'string', multiple: true }, 'request-id': { type: 'string' }, help: { type: 'boolean' },
    'cache-dir': { type: 'string' },
    review: { type: 'string' }, rollback: { type: 'boolean' }, status: { type: 'boolean' },
  } });
  const usage = 'xec update plan <commit> [--runtime <sealed-linux-runtime>] --node <registered-node> [--node ...]\n' +
    'xec update apply <plan-id>\nxec update status [plan-id]\nxec update reconcile <plan-id>\n' +
    'xec update local-check [dist] [--cache-dir <private-directory>]\nxec update local-apply [dist] [--cache-dir <private-directory>]\n' +
    'xec update local-sync [--cache-dir <private-directory>] [--review <sha256> [--rollback] | --status]\n' +
    '  Set OMNITRON_DEV_CACHE to retain builds on a development volume between batches.\n' +
    '  --cli <executable> Select the fleet controller CLI; local updates use the candidate CLI\n' +
    'local-sync prepares the completed development batch. Its review covers local supervision, Console and the listed stacks.';
  if (values.help) { console.log(usage); return; }
  const [operation, target] = positionals;
  const local = operation?.startsWith('local-');
  if (positionals.length > 2 || !['plan', 'apply', 'status', 'reconcile', 'local-check', 'local-apply', 'local-sync'].includes(operation) ||
      (operation !== 'status' && !local && !target)) throw Error(usage);
  if (operation !== 'plan' && (values.runtime || values.node || values['request-id'])) throw Error('Runtime, node and request ID options belong to plan');
  if ((values.review || values.rollback || values.status) && operation !== 'local-sync') throw Error('Local sync review, recovery and status options belong to local-sync');
  if ((values.rollback && !values.review) || (values.review !== undefined && !/^[a-f0-9]{64}$/.test(values.review)) ||
      (values.status && (values.review || values.rollback || target || values['cache-dir']))) throw Error(usage);
  const root = options.root ?? process.cwd();
  const run = options.run ?? releaseCommand;
  const progress = options.progress ?? console.log;
  if (values['cache-dir'] && (!local || target)) throw Error('--cache-dir applies only when building the current local revision');
  if (local && values.cli) throw new UserError('Local updates require the candidate and its own CLI');
  let sync, directory, saved;
  if (operation === 'local-sync') {
    sync = await import('./local-sync.js');
    const { OMNITRON_HOME } = await import('../apps/omnitron/src/config/defaults.ts');
    directory = path.join(OMNITRON_HOME, 'runtime', 'local-updates');
    if (values.status || values.rollback) saved = await sync.localSyncStatus(directory);
    if (values.status) { progress(JSON.stringify(saved, null, 2)); return saved; }
    if (values.rollback && (!saved || saved.digest !== values.review || target || values['cache-dir']))
      throw new UserError('Recovery uses the reviewed installed runtime and its exact receipt; inspect local-sync --status');
    if (!values.rollback && target) throw new UserError('local-sync finalizes the current clean checkout. Select an explicit runtime only for a backend handoff or recovery');
  }
  const cache = values['cache-dir'] ?? process.env.OMNITRON_DEV_CACHE;
  const candidate = local ? (saved ? path.join(path.dirname(directory), 'releases', saved.plan.target.artifact, 'packages/0/dist') : target ? path.resolve(root, target) :
    await localRuntime(root, cache && path.resolve(root, cache), run, progress)) : null;
  const runtime = local ? path.resolve(candidate, '../../..') : null;
  if (local && (values.cli || candidate !== path.join(runtime, 'packages/0/dist')))
    throw new UserError('Local updates require the sealed candidate packages/0/dist and its own CLI; --cli selects a fleet controller');
  // Candidate admission must understand its own requirements. Using the installed
  // older CLI can miss new owner contracts or misclassify checksum-only changes.
  const executable = local ? path.join(runtime, 'node') : values.cli ?? 'omnitron';
  const prefix = local ? [path.join(candidate, 'cli/omnitron.js')] : [];
  const call = async (argv, runtimeRoot) => {
    let output, failure;
    const command = runtimeRoot ? path.join(runtimeRoot, 'node') : executable;
    const cli = runtimeRoot ? [path.join(runtimeRoot, 'packages/0/dist/cli/omnitron.js')] : prefix;
    try { output = await run(root, command, [...cli, '--json', ...argv], { timeoutMs: 30 * 60_000 }); }
    catch (error) {
      if (!(error instanceof ReleaseCommandError)) throw error;
      // Omnitron emits successful receipts on stdout and refusals on stderr.
      output = error.stdout.trim() ? error.stdout : error.stderr;
      failure = error;
    }
    let reply;
    try { reply = JSON.parse(output); } catch (error) { throw failure ?? error; }
    const reason = typeof reply?.error === 'string' ? reply.error : reply?.error?.message;
    const exitCode = Number.isInteger(failure?.status) && failure.status > 0 && failure.status < 256 ? failure.status : 1;
    if (reply?.ok === false && typeof reason === 'string') {
      if (Object.keys(reply).some(key => !['ok', 'error'].includes(key))) progress(JSON.stringify(reply, null, 2));
      throw new UserError(reason, { exitCode });
    }
    if (reply?.ok !== true) throw failure ?? Error('Omnitron did not confirm the operation');
    if (failure) {
      // A known blocked/uncertain rollout is still a failed command. Preserve its
      // receipt and explanation; never turn non-zero exit into success or retry it.
      progress(JSON.stringify(reply.data, null, 2));
      throw new UserError(reply.data?.reason ?? 'Omnitron did not complete the operation',
        { exitCode });
    }
    return reply.data;
  };
  if (sync) {
    const { localSyncActions } = await import('./local-sync-host.js');
    const actions = await localSyncActions({ root, runtime, call, run, progress, directory });
    const result = await sync.runLocalSync({ directory, actions, review: values.review, rollback: values.rollback, progress });
    progress(JSON.stringify(result, null, 2));
    return result;
  }
  if (operation === 'plan') {
    if (!/^[a-f0-9]{40}$/.test(target) || !values.node?.length)
      throw Error('Plan requires a full commit, qualified Linux runtimes and explicit registered nodes');
    if (new Set(values.node).size !== values.node.length || values.node.some(node => !node || node.startsWith('-') || node.trim() !== node))
      throw Error('Use distinct registered node names or IDs, not command options');
    const id = values['request-id'] ?? randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw Error('Invalid request ID');
    const runtimes = values.runtime ? values.runtime.map(value => path.resolve(root, value)) : await qualifiedRuntimes(root, target);
    if (!runtimes.length) throw Error('No qualified native runtime is available');
    // Reject a mixed candidate before the catalog or any remote node can be changed.
    for (const runtime of runtimes) {
      const stamp = JSON.parse(await fs.readFile(path.join(runtime, 'packages/0/dist/BUILD.json')));
      if (stamp.commit !== target || stamp.dirty) throw Error('Runtime source differs from the requested candidate');
    }
    progress('Plan ' + id + '. If interrupted, use xec update status ' + id + '; do not replay apply.');
    let plan;
    const pipeline = Pipeline.create('platform-update-plan')
      .step('catalog', { run: async () => { await call(['fleet', 'rollout', 'import', ...runtimes]); } })
      .step('prepare', { dependsOn: ['catalog'], run: async () => {
        plan = await call(['fleet', 'rollout', 'plan', target, ...values.node, '--stage', '--wait', '--request-id', id]);
        if (plan?.id !== id || plan.commit !== target || plan.state !== 'planned') throw Error('Controller did not confirm the requested plan');
      } });
    const result = await pipeline.run({}, { onEvent(event) {
      if (event.type === 'step-start') progress(event.step + ' · running');
      if (event.type === 'step-complete') progress(event.step + ' · ' + (event.result.success ? 'complete' : event.result.error));
    } });
    if (!result.success) throw Error('Update preparation failed. Inspect xec update status ' + id + '\n' +
      result.steps.filter(step => !step.success).map(step => step.error).join('\n'));
    progress(JSON.stringify(plan, null, 2));
    return plan;
  }
  if (!operation.startsWith('local-') && target && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(target)) throw Error('Use the exact rollout UUID');
  const argv = operation.startsWith('local-')
    ? ['backend', 'upgrade', candidate, ...(operation === 'local-check' ? ['--check'] : [])]
    : ['fleet', 'rollout', operation, ...(target ? [target] : []), ...(['apply', 'status'].includes(operation) ? ['--wait'] : [])];
  const result = await call(argv);
  progress(JSON.stringify(result, null, 2));
  return result;
}
