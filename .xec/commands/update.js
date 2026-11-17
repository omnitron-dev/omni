import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pipeline } from '@xec-sh/ops/pipeline';
import { UserError } from '@xec-sh/ops';
import { releaseCommand, ReleaseCommandError } from '@xec-sh/ops/release';
import { qualifiedRuntimes } from '../qualification.mjs';
import { withLocalRuntime, verifyLocalRuntime } from '../local-runtime.mjs';
import { CommandResultError, readCommandResult } from '../../apps/omnitron/src/shared/command-result.ts';

/** Xec orchestrates; the daemon remains the authority for pins, roles, locks and recovery. */
async function runUpdate(operation, target, values, options) {
  const local = operation.startsWith('local-');
  if (values.rollback && !values.review) throw new UserError('--rollback requires the exact --review digest');
  if (values.reconcile && !values.review) throw new UserError('--reconcile requires the exact --review digest');
  if (values.review !== undefined && !/^[a-f0-9]{64}$/.test(values.review))
    throw new UserError('--review requires the exact 64-character SHA-256 digest');
  const root = options.root ?? process.cwd();
  const run = options.run ?? releaseCommand;
  const progress = options.progress ?? console.log;
  if (values.cacheDir && (!local || target)) throw Error('--cache-dir applies only when building the current local revision');
  const inspection = operation === 'local-sync' && (values.status || values.rollback || values.reconcile);
  if (local && values.cli && !inspection) throw new UserError('Local updates require the candidate and its own CLI');
  if (operation === 'local-sync' && target) throw new UserError('local-sync finalizes the current clean checkout');
  if ((values.rollback || values.reconcile) && values.cacheDir) throw new UserError('Recovery uses the reviewed installed runtime; inspect local-sync --status');
  const cache = values.cacheDir ?? process.env.OMNITRON_DEV_CACHE;
  const execute = async (candidate, signal) => {
    const runtime = candidate ? path.resolve(candidate, '../../..') : null;
    if (candidate && candidate !== path.join(runtime, 'packages/0/dist'))
      throw new UserError('Local updates require the sealed candidate packages/0/dist and its own CLI');
    // localRuntime already verifies its selected cache/build before returning.
    // An explicit artifact needs the same trusted check, exactly once.
    if (runtime && target) await verifyLocalRuntime(root, runtime, run);
    // Admission runs in the sealed candidate after the trusted source verifier checks its bytes.
    const executable = runtime ? path.join(runtime, 'node') : values.cli ?? 'omnitron';
    const prefix = candidate ? [path.join(candidate, 'cli/omnitron.js')] : [];
    const call = async argv => {
      let output, failure;
      try { output = await run(root, executable, [...prefix, '--json', ...argv], {
        timeoutMs: operation === 'local-sync' && !values.status ? 60 * 60_000 : 30 * 60_000,
        ...(signal && { signal }),
      }); }
      catch (error) {
        if (!(error instanceof ReleaseCommandError)) throw error;
        // Omnitron emits successful receipts on stdout and refusals on stderr.
        output = error.stdout.trim() ? error.stdout : error.stderr;
        failure = error;
      }
      try { return readCommandResult(output, argv.join(' '), failure ? failure.status || 1 : 0, failure); }
      catch (error) {
        if (!(error instanceof CommandResultError)) throw error;
        const reply = error.reply;
        if (reply?.ok === true) progress(JSON.stringify(reply.data, null, 2));
        else if (reply && Object.keys(reply).some(key => !['ok', 'error'].includes(key))) progress(JSON.stringify(reply, null, 2));
        throw new UserError(error.message, { exitCode: error.exitCode });
      }
    };
    if (operation === 'local-sync') {
      if (!inspection) {
        const stamp = JSON.parse(await fs.readFile(path.join(candidate, 'BUILD.json'), 'utf8'));
        const revision = (await run(root, 'git', ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
        if (stamp.commit !== revision || stamp.dirty !== false || (await run(root, 'git', ['status', '--porcelain'])).trim())
          throw new UserError('The development checkout changed after runtime preparation. Commit the batch and prepare it again');
      }
      const action = values.status ? ['status'] : values.rollback ? ['recover', values.review] : values.reconcile ? ['reconcile', values.review] :
        values.review ? ['apply', values.review] : ['prepare', runtime];
      const result = await call(['runtime', 'update', ...action]);
      return result;
    }
    if (operation === 'plan') {
      if (!/^[a-f0-9]{40}$/.test(target) || !values.node?.length)
        throw Error('Plan requires a full commit, qualified Linux runtimes and explicit registered nodes');
      if (new Set(values.node).size !== values.node.length || values.node.some(node => !node || node.startsWith('-') || node.trim() !== node))
        throw Error('Use distinct registered node names or IDs, not command options');
      const id = values.requestId ?? randomUUID();
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
      return plan;
    }
    if (!operation.startsWith('local-') && target && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(target)) throw Error('Use the exact rollout UUID');
    const argv = operation.startsWith('local-')
      ? ['backend', 'upgrade', candidate, ...(operation === 'local-check' ? ['--check'] : [])]
      : ['fleet', 'rollout', operation, ...(target ? [target] : []), ...(['apply', 'status'].includes(operation) ? ['--wait'] : [])];
    const result = await call(argv);
    return result;
  };
  const result = local && !inspection && !target
    ? await withLocalRuntime(root, cache && path.resolve(root, cache), run, progress, execute,
      { prepareWhileCleaning: operation === 'local-sync' && !values.review })
    : await execute(local && !inspection ? path.resolve(root, target) : null);
  progress(JSON.stringify(result, null, 2));
  return result;
}

/** Register the actual operation shapes, rather than forwarding an argv array. */
export function command(program, options = {}) {
  const update = program.command('update')
    .description('Prepare and follow managed updates through the authoritative Omnitron daemon')
    .allowExcessArguments(false)
    .addHelpText('after', `
Local preparation preserves verified builds in OMNITRON_DEV_CACHE (or --cache-dir).
Review the returned digest before local-sync --review DIGEST. After an interrupted
operation inspect status; use reconciliation/recovery instead of replaying apply.
`);
  const operation = (signature, description) => update.command(signature)
    .description(description).allowExcessArguments(false)
    .option('--cli <executable>', 'Controller CLI for fleet operations or local status/recovery');
  const collect = (value, previous = []) => [...previous, value];
  operation('plan <commit>', 'Stage qualified runtimes on explicit registered nodes; do not activate')
    .option('--runtime <directory>', 'Sealed Linux runtime (repeat for distinct native candidates)', collect)
    .requiredOption('--node <name-or-id>', 'Registered target node (repeat for each node)', collect)
    .option('--request-id <uuid>', 'Stable operation ID for inspection after interruption')
    .action((commit, values) => runUpdate('plan', commit, values, options));
  for (const [name, description] of [
    ['apply', 'Apply the exact prepared fleet rollout once'],
    ['reconcile', 'Reconcile a fleet rollout after an interrupted or unknown result'],
  ]) operation(`${name} <plan-id>`, description)
    .action((id, values) => runUpdate(name, id, values, options));
  operation('status [plan-id]', 'Inspect fleet rollout state and receipts')
    .action((id, values) => runUpdate('status', id, values, options));
  for (const [name, description] of [
    ['local-check', 'Check admission using the sealed candidate and its own CLI'],
    ['local-apply', 'Apply the sealed backend candidate after admission'],
  ]) operation(`${name} [dist]`, description)
    .option('--cache-dir <directory>', 'Private retained build directory for the current local revision')
    .action((dist, values) => runUpdate(name, dist, values, options));
  operation('local-sync', 'Prepare or apply a reviewed local batch, including Console and selected stacks')
    .option('--cache-dir <directory>', 'Private retained build directory for the current local revision')
    .option('--review <sha256>', 'Apply or recover exactly this reviewed local plan')
    .option('--rollback', 'Recover the reviewed local plan; requires --review')
    .addOption(program.createOption('--reconcile', 'Confirm an already serving candidate without restarting; requires --review').conflicts(['rollback', 'status', 'cacheDir']))
    .addOption(program.createOption('--status', 'Inspect local state without preparing a build')
      .conflicts(['review', 'rollback', 'reconcile', 'cacheDir']))
    .action(values => runUpdate('local-sync', undefined, values, options));
  update.action(() => update.help());
}
