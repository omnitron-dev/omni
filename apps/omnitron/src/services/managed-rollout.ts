import { readFileSync } from 'node:fs';
import { commandFailure } from '../execution/command-failure.js';
import { BACKEND_ACTIVITY_COUNTERS } from '../shared/dto/backend.js';
import { compareExecutionIdentityEvidence, describeExecutionIdentityDrift, isExecutionIdentityEvidence, type ExecutionIdentityEvidence } from '../shared/execution-identity.js';
import type { InstalledBundle } from './host-upgrade.js';
import { remoteNode } from './host-upgrade.js';
import { targetRuntime } from '../release/target-runtime.js';

export interface ManagedRolloutObservation {
  identity?: ExecutionIdentityEvidence;
  previous: string;
  candidate: string;
  commit: string;
  ownerId: string;
  ownerPid: number;
  backendPid: number;
  appsDigest: string;
  selectionRevision: number;
}

export class ManagedRolloutFailure extends Error {
  constructor(message: string, readonly outcome: 'unchanged' | 'rolled-back' | 'uncertain', options?: ErrorOptions) {
    super(message, options);
  }
}

export interface ManagedHostEvidence {
  identity?: ExecutionIdentityEvidence;
  bundle: InstalledBundle;
  current: string;
  ownerId: string;
  ownerPid: number;
  backendPid: number;
  appsDigest: string;
  selectionRevision: number;
  qualified?: string;
  priorSelection: string | null;
  unhealthy: string[];
}

export type ManagedHostRequest = { operation: 'inspect' | 'observe' } | { operation: 'plan'; commit: string } |
  { operation: 'switch'; expected: ManagedRolloutObservation; from: string; to: string; revision: number; pid: number };

/** Run the installed management SDK with the live system guardian's own Node.
 * The SSH login's Node discovers the OS process. It never loads SQLite native
 * extensions or treats an old /opt/omnitron/current alias as a serving identity. */
export function managedHostCommand(request: ManagedHostRequest): string {
  const program = readFileSync(new URL('../../data/operations/managed-kernel.mjs', import.meta.url), 'utf8');
  const wire = JSON.stringify({ ...request, requiredCounters: BACKEND_ACTIVITY_COUNTERS });
  return remoteNode(`import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
    const commandFailure=${commandFailure.toString()};
    const targetRuntime=${targetRuntime.toString()};
    const home=process.env.OMNITRON_HOME||path.join(os.homedir(),'.omnitron'),directory=path.join(home,'runtime');
    const file=path.join(directory,'supervision.json'),stat=fs.lstatSync(file,{throwIfNoEntry:false});
    if(!stat)console.log('null');
    else {
      if(process.platform!=='linux'||!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)||fs.realpathSync(file)!==file)
        throw Error('Unsupported or unsafe managed supervisor installation');
      const config=JSON.parse(fs.readFileSync(file)),job=config.backend;
      if(config.instanceHome!==home||!['system','user'].includes(config.scope)||!/^omnitron-[a-z0-9-]+\\.service$/.test(job?.unit)||!/^[0-9a-f]{64}$/.test(job.artifact))
        throw Error('Invalid managed supervisor identity');
      const pid=execFileSync('systemctl',[...(config.scope==='user'?['--user']:[]),'show',job.unit,'--property=MainPID','--value'],{encoding:'utf8'}).trim();
      if(!/^[1-9][0-9]*$/.test(pid))throw Error('The native guardian is unavailable');
      const bootstrap=path.join(directory,'releases',job.artifact),node=path.join(bootstrap,'node');
      if(fs.realpathSync(node)!==node||fs.realpathSync('/proc/'+pid+'/exe')!==node)throw Error('Registered guardian is not executing its pinned Node');
      const source='const commandFailure='+commandFailure.toString()+';const targetRuntime='+targetRuntime.toString()+';\\n'+${JSON.stringify(program)};
      const result=spawnSync(node,['--input-type=module','-e',source,home,bootstrap,pid,${JSON.stringify(wire)}],{encoding:'utf8',timeout:450000,maxBuffer:1048576});
      if(result.error||result.status!==0) {
        const reason=commandFailure(result.stderr||'',result.error?.code||result.signal||'exit '+result.status);
        process.stderr.write(JSON.stringify({ok:false,error:'Managed kernel '+${JSON.stringify(request.operation)}+' failed: '+reason})+'\\n');
        process.exitCode=1;
      } else process.stdout.write(result.stdout);
    }`);
}

type ManagedCall = (request: ManagedHostRequest) => Promise<ManagedHostEvidence | null>;
export async function planManagedRollout(run: ManagedCall, commit: string): Promise<ManagedRolloutObservation> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw Error('A full lowercase Git commit is required');
  const report = await run({ operation: 'plan', commit });
  if (!report?.qualified) throw Error('No qualified managed target; a coupled owner requires a separate transition');
  return { previous: report.current, candidate: report.qualified, commit, ownerId: report.ownerId, ownerPid: report.ownerPid,
    backendPid: report.backendPid, appsDigest: report.appsDigest, selectionRevision: report.selectionRevision,
    ...(isExecutionIdentityEvidence(report.identity) && report.identity.owner.id === report.ownerId && report.identity.owner.pid === report.ownerPid ? { identity: report.identity } : {}) };
}

export type ManagedSelection = 'unchanged' | 'candidate' | 'rolled-back';

function observedState(report: ManagedHostEvidence | null, plan: ManagedRolloutObservation): ManagedSelection {
  if (!report) throw Error('No managed host evidence is available');
  if (report.ownerId !== plan.ownerId || report.ownerPid !== plan.ownerPid || report.appsDigest !== plan.appsDigest) {
    const details = describeExecutionIdentityDrift(compareExecutionIdentityEvidence(plan.identity, report.identity));
    throw Error('Serving owner or application inventory differs from the plan. ' + details);
  }
  if (report.current === plan.candidate && report.bundle.commit === plan.commit &&
    (plan.previous === plan.candidate ? report.selectionRevision === plan.selectionRevision && report.backendPid === plan.backendPid :
      report.selectionRevision === plan.selectionRevision + 1 && report.priorSelection === plan.previous && report.backendPid !== plan.backendPid)) return 'candidate';
  if (plan.previous !== plan.candidate && report.current === plan.previous) {
    if (report.selectionRevision === plan.selectionRevision && report.backendPid === plan.backendPid) return 'unchanged';
    if (report.selectionRevision === plan.selectionRevision + 2 && report.priorSelection === plan.candidate && report.backendPid !== plan.backendPid) return 'rolled-back';
  }
  throw Error('Observed kernel selection cannot be attributed to this plan');
}

export async function reconcileManagedTarget(run: ManagedCall, plan: ManagedRolloutObservation) {
  const report = await run({ operation: 'observe' });
  const state = observedState(report, plan);
  if (report!.unhealthy.length) throw Error('Application readiness did not pass: ' + report!.unhealthy.join(', '));
  return state;
}

export async function activateManagedTarget(run: ManagedCall, plan: ManagedRolloutObservation, beforeDispatch?: () => Promise<void>): Promise<void> {
  const before = await run({ operation: 'observe' });
  const starting = observedState(before, plan);
  if (before!.unhealthy.length) throw new ManagedRolloutFailure('Application readiness did not pass before dispatch: ' + before!.unhealthy.join(', '), starting === 'unchanged' ? 'unchanged' : 'uncertain');
  if (starting === 'candidate') return;
  if (starting === 'rolled-back') throw new ManagedRolloutFailure('This rollout was already reversed', 'rolled-back');
  // Diagnostics stay in the receipt. Only the original fence travels over SSH.
  const expected = { ...plan };
  delete expected.identity;
  // Qualifying, taking the host lease and observing its owner do not switch a runtime.
  // Commit the controller's dispatch intent only at the boundary of the first native switch.
  await beforeDispatch?.();
  try {
    await run({ operation: 'switch', expected, from: plan.previous, to: plan.candidate, revision: plan.selectionRevision, pid: plan.backendPid });
    if (await reconcileManagedTarget(run, plan) !== 'candidate') throw Error('Candidate handoff was not confirmed');
    return;
  } catch (failure) {
    let result: 'unchanged' | 'rolled-back';
    try {
      const current = await run({ operation: 'observe' });
      const selected = observedState(current, plan);
      if (selected === 'candidate') {
        if (!current!.unhealthy.length) return;
        await run({ operation: 'switch', expected, from: plan.candidate, to: plan.previous, revision: current!.selectionRevision, pid: current!.backendPid });
        if (await reconcileManagedTarget(run, plan) !== 'rolled-back') throw Error('Rollback was not confirmed', { cause: failure });
        result = 'rolled-back';
      } else result = selected;
    } catch (err) {
      throw new ManagedRolloutFailure('Kernel handoff requires reconciliation: ' + (err as Error).message, 'uncertain', { cause: new AggregateError([failure, err]) });
    }
    throw new ManagedRolloutFailure('Kernel handoff failed (' + result + '): ' + (failure as Error).message, result, { cause: failure });
  }
}
