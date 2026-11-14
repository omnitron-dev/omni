import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseCommand, ReleaseCommandError } from '@xec-sh/ops/release';
import { OMNITRON_HOME } from '../config/defaults.js';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';
import { readPreparedRuntimeUpdate, readRuntimeUpdateReceipt, runRuntimeUpdate } from '../daemon/runtime-update.js';
import { runtimeUpdateActions, verifyRuntimeUpdateTarget } from '../daemon/runtime-update-host.js';
import { emitError, emitInfo, emitJson, emitStep } from './output.js';
import { readCommandResult } from '../shared/command-result.js';
import type { RuntimeUpdateCall } from '../daemon/runtime-update-host.js';
import type { PreparedRuntimeUpdate, RuntimeUpdateReceipt, RuntimeUpdateStatus, VerifiedRuntimeReference } from '../shared/dto/runtime-update.js';

const directory = path.join(OMNITRON_HOME, 'runtime', 'local-updates');

/** A CLI response is admitted once. A missing acknowledgement never repeats a host action. */
async function callRuntime<T>(runtime: VerifiedRuntimeReference, args: readonly string[], timeoutMs = 30 * 60_000): Promise<T> {
  let output: string;
  let failure: ReleaseCommandError | undefined;
  try {
    output = await releaseCommand(OMNITRON_HOME, runtime.node, [runtime.cli, '--json', ...args], { timeoutMs });
  } catch (error) {
    if (!(error instanceof ReleaseCommandError)) throw error;
    failure = error;
    output = error.stdout.trim() ? error.stdout : error.stderr;
  }
  return readCommandResult<T>(output, args.join(' '), failure ? failure.status || 1 : 0, failure);
}

async function inspect(digest?: string): Promise<RuntimeUpdateStatus> {
  const prepared = await readPreparedRuntimeUpdate(directory);
  const receipt = await readRuntimeUpdateReceipt(directory, digest);
  const selected = digest ? receipt ?? (prepared?.digest === digest ? prepared : null) : prepared ?? receipt;
  if (digest && !selected) throw Error('No local update has the requested plan digest');
  if (selected && selected.plan.instance !== OMNITRON_HOME) throw Error('The local update belongs to another instance');
  const runtime = selected ? await verifyRuntimeUpdateTarget(path.join(OMNITRON_HOME, 'runtime', 'releases', selected.plan.target.artifact), selected.plan.target.artifact) : null;
  if (runtime && runtime.commit !== selected!.plan.target.commit) throw Error('Installed runtime revision differs from the reviewed plan');
  return { prepared: !digest || prepared?.digest === digest ? prepared : null, receipt, runtime };
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

export async function runtimeUpdateStatusCommand(digest?: string): Promise<void> {
  try {
    const status = await inspect(digest);
    if (!emitJson(status)) emitInfo(JSON.stringify(status, null, 2));
  } catch (error) { emitError(error); process.exitCode = 1; }
}

/** Host authority stays in the verified candidate's local CLI and its private instance journal. */
export async function runtimeUpdateCommand(operation: 'prepare' | 'apply' | 'recover', value: string): Promise<void> {
  try {
    const runtime = operation === 'prepare' ? await verifyRuntimeUpdateTarget(path.resolve(value)) : (await inspect(value)).runtime;
    if (!runtime) throw Error('No verified candidate is available for this local update');
    let result: PreparedRuntimeUpdate | RuntimeUpdateReceipt;
    if (!(await runsTarget(runtime))) {
      // A complete transition includes its possible restoration. Its caller must outlive both bounded phases.
      result = await callRuntime(runtime, ['runtime', 'update', operation, operation === 'prepare' ? runtime.directory : value], 60 * 60_000);
    } else {
      const call: RuntimeUpdateCall = async <T>(args: readonly string[], runtimeRoot?: string): Promise<T> =>
        callRuntime<T>(runtimeRoot ? await verifyRuntimeUpdateTarget(runtimeRoot) : runtime, args);
      const actions = await runtimeUpdateActions({ runtime: runtime.directory, instance: OMNITRON_HOME, call,
        run: releaseCommand, progress: emitStep });
      result = await runRuntimeUpdate({ actions, directory, operation, ...(operation !== 'prepare' && { digest: value }), progress: emitStep });
    }
    if (!emitJson(result)) {
      emitInfo(JSON.stringify(result, null, 2));
      if (!('phase' in result)) emitInfo(`Review the plan, then run omnitron runtime update apply ${result.digest}`);
    }
  } catch (error) { emitError(error); process.exitCode = 1; }
}
