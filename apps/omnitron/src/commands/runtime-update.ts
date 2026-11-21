import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseCommand, ReleaseCommandError } from '@xec-sh/ops/release';
import { OMNITRON_HOME } from '../config/defaults.js';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';
import { readPreparedRuntimeUpdate, readRuntimeUpdateReceipt, runRuntimeUpdate } from '../daemon/runtime-update.js';
import { reviewRuntimeInfrastructure, runtimeUpdateActions, verifyRuntimeUpdateTarget } from '../daemon/runtime-update-host.js';
import { emitError, emitInfo, emitJson, emitStep, isJsonMode } from './output.js';
import { readCommandResult } from '../shared/command-result.js';
import { UPDATE_PROGRESS_ENV, withRuntimeUpdateProgress, writeRuntimeProgress } from '../shared/runtime-update-progress.js';
import type { RuntimeUpdateCall } from '../daemon/runtime-update-host.js';
import type { PreparedRuntimeUpdate, RuntimeUpdateReceipt, RuntimeUpdateStatus, VerifiedRuntimeReference } from '../shared/dto/runtime-update.js';

const directory = path.join(OMNITRON_HOME, 'runtime', 'local-updates');

/** A CLI response is admitted once. A missing acknowledgement never repeats a host action. */
async function callRuntime<T>(runtime: VerifiedRuntimeReference, args: readonly string[], timeoutMs = 30 * 60_000, signal?: AbortSignal, run = releaseCommand): Promise<T> {
  let output: string;
  let failure: ReleaseCommandError | undefined;
  try {
    output = await run(OMNITRON_HOME, runtime.node, [runtime.cli, '--json', ...args], { timeoutMs, ...(signal && { signal }) });
  } catch (error) {
    if (!(error instanceof ReleaseCommandError)) throw error;
    failure = error;
    output = error.stdout.trim() ? error.stdout : error.stderr;
  }
  return readCommandResult<T>(output, args.join(' '), failure ? failure.status || 1 : 0, failure);
}

export async function reviewStackStopRuntime(artifact: string, controller: { instanceHome: string; daemonSocket: string }) {
  if (controller.instanceHome !== OMNITRON_HOME || controller.daemonSocket !== path.join(OMNITRON_HOME, 'daemon.sock'))
    throw Error('The runtime target and application stop must use the same local controller');
  const runtime = await verifyRuntimeUpdateTarget(path.join(OMNITRON_HOME, 'runtime', 'releases', artifact), artifact);
  const reviewInfrastructure = (id: string) => reviewRuntimeInfrastructure(id, args => callRuntime(runtime, args), { requireLive: true });
  const { current, infrastructure } = await reviewInfrastructure(artifact);
  if (!current || !/^[a-f0-9]{64}$/.test(current)) throw Error('The cold-start review did not identify the installed rollback runtime');
  if (current !== artifact && (await reviewInfrastructure(current)).current !== current)
    throw Error('The installed rollback runtime changed during the cold-start review');
  return infrastructure;
}

async function readJournal(digest?: string): Promise<Pick<RuntimeUpdateStatus, 'prepared' | 'receipt'>> {
  const prepared = await readPreparedRuntimeUpdate(directory);
  const receipt = await readRuntimeUpdateReceipt(directory, digest);
  const reviewed = !digest || prepared?.digest === digest ? prepared : null;
  if (digest && !reviewed && !receipt) throw Error('No local update has the requested plan digest');
  if ([reviewed, receipt].some(entry => entry && entry.plan.instance !== OMNITRON_HOME))
    throw Error('The local update belongs to another instance');
  return { prepared: reviewed, receipt };
}

async function inspect(digest?: string): Promise<RuntimeUpdateStatus> {
  const journal = await readJournal(digest);
  const selected = digest ? journal.receipt ?? journal.prepared : journal.prepared ?? journal.receipt;
  const runtime = selected ? await verifyRuntimeUpdateTarget(path.join(OMNITRON_HOME, 'runtime', 'releases', selected.plan.target.artifact), selected.plan.target.artifact) : null;
  if (runtime && runtime.commit !== selected!.plan.target.commit) throw Error('Installed runtime revision differs from the reviewed plan');
  return { ...journal, runtime };
}

async function runsTarget(runtime: VerifiedRuntimeReference): Promise<boolean> {
  const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return ownRoot === runtime.directory && await fs.realpath(process.execPath) === runtime.node &&
    Boolean(process.argv[1]) && await fs.realpath(process.argv[1]!) === runtime.cli;
}

export async function runtimeVerifyCommand(runtime: string): Promise<void> {
  try {
    const manifest = await verifyRuntimeArtifact(path.resolve(runtime));
    if (!emitJson(manifest)) emitInfo(`Verified runtime ${manifest.sha256}`);
  } catch (error) { emitError(error); process.exitCode = 1; }
}

export async function runtimeUpdateStatusCommand(digest?: string, journalOnly = false): Promise<void> {
  try {
    const status = journalOnly || (!digest && !isJsonMode()) ? await readJournal(digest) : await inspect(digest);
    if (!emitJson(status)) emitInfo(JSON.stringify(status, null, 2));
  } catch (error) { emitError(error); process.exitCode = 1; }
}

/** Host authority stays in the verified candidate's local CLI and its private instance journal. */
export async function runtimeUpdateCommand(operation: 'prepare' | 'apply' | 'recover' | 'reconcile', value: string): Promise<void> {
  try {
    let runtime = operation === 'prepare' ? await verifyRuntimeUpdateTarget(path.resolve(value)) : (await inspect(value)).runtime;
    if (operation === 'recover' || operation === 'reconcile') {
      // A verified installed CLI can repair an older interrupted transaction.
      // Its receipt still pins every role and effect; do not delegate recovery
      // back to the old interpreter whose defect may have caused the failure.
      const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
      if (runtime?.directory !== ownRoot && path.dirname(ownRoot) === path.join(OMNITRON_HOME, 'runtime', 'releases'))
        runtime = await verifyRuntimeUpdateTarget(ownRoot, path.basename(ownRoot));
    }
    if (!runtime) throw Error('No verified candidate is available for this local update');
    const progress = process.env[UPDATE_PROGRESS_ENV] === '1' ? writeRuntimeProgress : emitStep;
    let result: PreparedRuntimeUpdate | RuntimeUpdateReceipt;
    if (!(await runsTarget(runtime))) {
      // A complete transition includes its possible restoration. Its caller must outlive both bounded phases.
      result = await callRuntime(runtime, ['runtime', 'update', operation, operation === 'prepare' ? runtime.directory : value],
        60 * 60_000, undefined, withRuntimeUpdateProgress(releaseCommand, progress));
    } else {
      const call: RuntimeUpdateCall = (args, options) => callRuntime(runtime, args, options?.timeoutMs, options?.signal);
      const actions = await runtimeUpdateActions({ runtime, instance: OMNITRON_HOME, call,
        run: releaseCommand, progress });
      result = await runRuntimeUpdate({ actions, directory, operation, ...(operation !== 'prepare' && { digest: value }), progress });
    }
    if (!emitJson(result)) {
      emitInfo(JSON.stringify(result, null, 2));
      if (!('phase' in result)) emitInfo(`Review the plan, then run omnitron runtime update apply ${result.digest}`);
    }
  } catch (error) { emitError(error); process.exitCode = 1; }
}
