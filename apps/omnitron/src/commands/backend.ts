import path from 'node:path';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { BackendRpcService } from '../daemon/backend.rpc-service.js';
import { replaceBackend, recoverBackend, abortBackendReplacement } from '../daemon/backend-upgrade.js';
import { emitJson, emitError, emitInfo, emitStep } from './output.js';

export async function backendStatusCommand(): Promise<void> {
  const client = createDaemonClient();
  try {
    const status = await client.status();
    const execution = status.execution ?? { mode: 'coupled', handoffSupported: false,
      reason: 'The running backend predates resident execution. Its application processes cannot be adopted without an initial controlled restart.' };
    if (emitJson({ pid: status.pid, build: status.build, execution })) return;
    emitInfo(`Backend PID ${status.pid}: ${execution.mode}`);
    if (execution.reason) emitInfo(execution.reason);
    if ('owner' in execution && execution.owner) emitInfo(`Execution owner PID ${execution.owner.pid}; epoch ${execution.epoch}; ${execution.phase}`);
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
  finally { await client.disconnect(); }
}

export async function backendUpgradeCommand(directory: string, options: { check?: boolean }): Promise<void> {
  try {
    // Legacy versions have no OmnitronBackend service. Ask their stable
    // status first to explain the capability boundary without draining them.
    const client = createDaemonClient();
    try {
      const status = await client.status();
      if (!status.execution?.handoffSupported) throw new Error(status.execution?.reason ??
        'The running daemon directly owns application processes. One initial controlled restart is required to enable resident execution. Nothing was stopped.');
      const backend = await client.service<BackendRpcService>('OmnitronBackend');
      await backend.status();
    } finally { await client.disconnect(); }
    const result = await replaceBackend(path.resolve(directory), { checkOnly: options.check === true, progress: emitStep });
    if (!emitJson(result)) emitInfo('checked' in result ? `Candidate ${result.build.commit} verified; no activation performed`
      : `Backend PID ${result.pid}; execution owner PID ${result.ownerPid} retained; epoch ${result.epoch}`);
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
}

export async function backendRecoverCommand(file: string): Promise<void> {
  try {
    const result = await recoverBackend(path.resolve(file));
    if (!emitJson(result)) emitInfo(`Backend recovered as PID ${result.pid}; execution owner ${result.ownerPid}`);
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
}

export async function backendAbortCommand(file: string): Promise<void> {
  try {
    await abortBackendReplacement(path.resolve(file));
    if (!emitJson({ aborted: true })) emitInfo('Preparation cancelled; the original backend has resumed');
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
}
