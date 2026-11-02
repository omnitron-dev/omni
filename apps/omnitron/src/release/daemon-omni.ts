/** Applications bind their framework packages to the runtime that owns their processes.
 * A backend handoff can replace the controller while that runtime keeps running. */

import type { DaemonStatusDto } from '../config/types.js';

/** Provenance reported by authenticated node status. */
export interface DaemonAnswer {
  readonly host: string;
  readonly version: string | null;
  readonly build?: DaemonStatusDto['build'];
  readonly execution?: DaemonStatusDto['execution'];
  readonly error?: string;
}

/**
 * The omni commit a daemon's version names: `0.2.0+local.<sha>.<stamp>` (see
 * `localVersion`) → `<sha>`. Null when it names none — a version from a
 * registry, or a bundle built outside a repository (`nocommit`).
 */
export function commitOfDaemonVersion(version: string | null | undefined): string | null {
  const m = /\+local\.([0-9a-f]{7,40})\.\d+$/i.exec(version ?? '');
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Why a release gated on `releaseOmni` may not run under these daemons — or
 * null when every one of them was built from that commit.
 *
 * A node that did not answer is a refusal, not a pass: what it runs is exactly
 * what cannot be vouched for.
 */
export function refuseForeignOmni(releaseOmni: string, daemons: readonly DaemonAnswer[], requireExactBuild = false): string | null {
  const wanted = releaseOmni.toLowerCase();
  if (!daemons.length) return 'No target nodes are configured to verify the application runtime';
  const reasons: string[] = [];
  for (const d of daemons) {
    if (d.error !== undefined || typeof d.version !== 'string') {
      reasons.push(`${d.host} did not say which omni its daemon runs${d.error ? ` (${d.error})` : ''}`);
      continue;
    }
    const mode = d.execution?.mode;
    if (mode !== 'coupled' && mode !== 'resident' && (requireExactBuild || d.execution !== undefined)) {
      reasons.push(`${d.host} did not identify the process that owns its applications`);
      continue;
    }
    if (mode === 'resident' && d.execution?.connection?.status !== 'connected') {
      reasons.push(`${d.host} has no current observation of its execution owner`);
      continue;
    }
    if (mode === 'resident' && d.execution?.phase !== undefined && d.execution.phase !== 'active') {
      reasons.push(`${d.host}'s execution owner is ${d.execution.phase}. Wait for a stable controller before admission`);
      continue;
    }
    const build = mode === 'resident' ? d.execution?.ownerBuild : d.build;
    if (requireExactBuild || mode === 'resident' || build !== undefined) {
      const owner = mode === 'resident' ? 'execution owner' : 'daemon';
      if (!build || typeof build.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(build.commit) ||
          (requireExactBuild && build.commit.length !== 40)) {
        reasons.push(`${d.host}'s ${owner} did not report a ${requireExactBuild ? 'full ' : ''}framework build commit`);
      } else if (build.dirty !== false) {
        reasons.push(`${d.host}'s ${owner} did not report a clean build at ${build.commit.slice(0, 8)}`);
      } else if (requireExactBuild ? build.commit !== wanted : !wanted.startsWith(build.commit)) {
        reasons.push(`${d.host}'s ${owner} runs omni ${build.commit} (${d.version})`);
      }
      continue;
    }
    // Linked releases can still reach legacy coupled daemons whose only stamp
    // is the local version suffix. A controller version cannot identify a resident owner.
    const sha = commitOfDaemonVersion(d.version);
    if (!sha) {
      reasons.push(`${d.host}'s daemon ${d.version} names no omni commit`);
    } else if (!wanted.startsWith(sha)) {
      reasons.push(`${d.host}'s daemon runs omni ${sha.slice(0, 8)} (${d.version})`);
    }
  }
  if (reasons.length === 0) return null;
  return (
    `${reasons.join('; ')}. This release was gated on omni ${requireExactBuild ? wanted : wanted.slice(0, 8)}. ` +
    'Review `omnitron fleet upgrade <node> --dry-run` and plan the transition of the application owner to the required build'
  );
}
