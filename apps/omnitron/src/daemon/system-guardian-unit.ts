import path from 'node:path';
import { unitValue } from '../commands/service-units.js';
import type { ManagedRuntime } from './managed-runtime.js';

const blockers = [
  'DropInPaths', 'ConsistsOf', 'BoundBy', 'RequiredBy', 'RequisiteOf', 'PropagatesStopTo', 'OnFailure', 'OnSuccess', 'Triggers', 'TriggeredBy',
];
const serviceHooks = ['ExecCondition', 'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost'];
export const guardianStopProperties = [...blockers, ...serviceHooks, 'LoadState', 'NeedDaemonReload', 'KillMode'];
export const guardianUnitProperties = [...guardianStopProperties, 'FragmentPath', 'User', 'Group'];

/** Stopping a unit may also stop its dependents or execute arbitrary site hooks. */
export function checkGuardianStopEffects(facts: Record<string, string>, requireLoaded: boolean): void {
  // systemctl omits empty command arrays even with --all. For these fields
  // also validate the loaded, drop-in-free fragment in replaceGuardianExec.
  const unsupported = [...blockers.filter(name => facts[name] !== ''), ...serviceHooks.filter(name => facts[name])];
  if (unsupported.length) throw Error('Independent guardian stop is not proven. Inspect systemd properties: ' + unsupported.join(', '));
  if (facts['LoadState'] !== 'loaded' || facts['KillMode'] !== 'control-group' ||
      requireLoaded && facts['NeedDaemonReload'] !== 'no') throw Error('Unsupported or changed system guardian unit');
}

export function checkSystemGuardian(unit: string, facts: Record<string, string>, requireLoaded: boolean): void {
  checkGuardianStopEffects(facts, requireLoaded);
  if (!/^omnitron-[a-z0-9-]+\.service$/.test(unit) ||
      facts['FragmentPath'] !== '/etc/systemd/system/' + unit || !['', 'root'].includes(facts['User'] ?? '?') ||
      !['', 'root'].includes(facts['Group'] ?? '?')) throw Error('Unsupported or changed system guardian unit');
}

/** Preserve the site's account, environment, restart policy and working directory byte-for-byte. */
export function replaceGuardianExec(text: string, before: ManagedRuntime, after: ManagedRuntime): string {
  const line = (config: ManagedRuntime) => {
    const root = path.join(config.instanceHome, 'runtime/releases', config.backend.artifact);
    return 'ExecStart=' + [path.join(root, 'node'), path.join(root, 'packages/0/dist/daemon/managed-entry.js'), 'backend'].map(unitValue).join(' ');
  };
  if (text.split('\n').some(l => /^\s*(?:\.include|Exec(?:Condition|StartPre|StartPost|Stop|StopPost)\s*=)/.test(l) || /\\$/.test(l)))
    throw Error('Guardian unit has unqualified external hooks, includes or continuation lines');
  const current = line(before);
  const execs = text.split('\n').filter(l => /^\s*ExecStart\s*=/.test(l));
  if (execs.length !== 1 || execs[0] !== current) throw Error('The existing guardian ExecStart does not exactly select its sealed artifact');
  return text.split('\n').map(l => l === current ? line(after) : l).join('\n');
}
