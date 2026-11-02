import { readFileSync } from 'node:fs';
import type { InstalledBundle } from './host-upgrade.js';
import { remoteNode } from './host-upgrade.js';

export interface ManagedRolloutObservation {
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
  const body = readFileSync(new URL('../../data/operations/managed-kernel.mjs', import.meta.url), 'utf8');
  return remoteNode(`import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
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
      const result=spawnSync(node,['--input-type=module','-e',${JSON.stringify(body)},home,bootstrap,pid,${JSON.stringify(JSON.stringify(request))}],{encoding:'utf8',timeout:450000,maxBuffer:1048576});
      if(result.error||result.status!==0)throw Error(('Managed host verification failed: '+(result.stderr||result.error?.message||result.signal||result.status)).slice(0,4000));
      process.stdout.write(result.stdout);
    }`);
}

type ManagedCall = (request: ManagedHostRequest) => Promise<ManagedHostEvidence | null>;
export async function planManagedRollout(run: ManagedCall, commit: string): Promise<ManagedRolloutObservation> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw Error('A full lowercase Git commit is required');
  const report = await run({ operation: 'plan', commit });
  if (!report?.qualified) throw Error('No qualified managed target; a coupled owner requires a separate transition');
  return { previous: report.current, candidate: report.qualified, commit, ownerId: report.ownerId, ownerPid: report.ownerPid,
    backendPid: report.backendPid, appsDigest: report.appsDigest, selectionRevision: report.selectionRevision };
}

function observedState(report: ManagedHostEvidence | null, plan: ManagedRolloutObservation): 'previous' | 'candidate' {
  if (!report || report.ownerId !== plan.ownerId || report.ownerPid !== plan.ownerPid || report.appsDigest !== plan.appsDigest)
    throw Error('Serving owner or application inventory differs from the plan');
  if (report.current === plan.candidate && report.bundle.commit === plan.commit &&
    (plan.previous === plan.candidate ? report.selectionRevision === plan.selectionRevision && report.backendPid === plan.backendPid :
      report.selectionRevision === plan.selectionRevision + 1 && report.priorSelection === plan.previous && report.backendPid !== plan.backendPid)) return 'candidate';
  if (report.current === plan.previous && (report.selectionRevision === plan.selectionRevision && report.backendPid === plan.backendPid ||
      report.selectionRevision === plan.selectionRevision + 2 && report.priorSelection === plan.candidate && report.backendPid !== plan.backendPid)) return 'previous';
  throw Error('Observed kernel selection cannot be attributed to this plan');
}

export async function reconcileManagedTarget(run: ManagedCall, plan: ManagedRolloutObservation) {
  const report = await run({ operation: 'observe' });
  const state = observedState(report, plan);
  if (report!.unhealthy.length) throw Error('Application readiness did not pass: ' + report!.unhealthy.join(', '));
  return state;
}

export async function activateManagedTarget(run: ManagedCall, plan: ManagedRolloutObservation): Promise<void> {
  const before = await run({ operation: 'observe' });
  const starting = observedState(before, plan);
  if (before!.unhealthy.length) throw new ManagedRolloutFailure('Application readiness did not pass before dispatch', starting === 'previous' ? 'unchanged' : 'uncertain');
  if (starting === 'candidate') return;
  if (before!.selectionRevision !== plan.selectionRevision) throw new ManagedRolloutFailure('This rollout was already reversed', 'rolled-back');
  try {
    await run({ operation: 'switch', expected: plan, from: plan.previous, to: plan.candidate, revision: plan.selectionRevision, pid: plan.backendPid });
    if (await reconcileManagedTarget(run, plan) !== 'candidate') throw Error('Candidate handoff was not confirmed');
    return;
  } catch (failure) {
    let result: 'unchanged' | 'rolled-back';
    try {
      const current = await run({ operation: 'observe' });
      if (observedState(current, plan) === 'candidate') {
        if (!current!.unhealthy.length) return;
        await run({ operation: 'switch', expected: plan, from: plan.candidate, to: plan.previous, revision: current!.selectionRevision, pid: current!.backendPid });
        if (await reconcileManagedTarget(run, plan) !== 'previous') throw Error('Rollback was not confirmed', { cause: failure });
        result = 'rolled-back';
      } else result = current!.selectionRevision === plan.selectionRevision ? 'unchanged' : 'rolled-back';
    } catch (err) {
      throw new ManagedRolloutFailure('Kernel handoff requires reconciliation: ' + (err as Error).message, 'uncertain', { cause: new AggregateError([failure, err]) });
    }
    throw new ManagedRolloutFailure('Kernel handoff failed (' + result + '): ' + (failure as Error).message, result, { cause: failure });
  }
}
