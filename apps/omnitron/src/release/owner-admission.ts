import type { IEcosystemAppEntry, IStackConfig } from '../config/types.js';
import { resolveNodePlacements, stackNodeKey } from '../project/stack-placement.js';
import { assertResidentApplicationRuntime, type ApplicationRuntime } from '../services/host-upgrade.js';
import { assertFrozenLaunch } from './frozen-installation.js';
import type { ReleaseManifest } from './manifest.js';
import { artifactReleaseContexts } from './origin.js';
import { assertReleaseTarget } from './target-runtime.js';

/** Native owner evidence obtained through the same authenticated probe as delivery. */
export interface ReleaseOwnerAnswer {
  readonly host: string;
  readonly port?: number;
  readonly runtime?: ApplicationRuntime;
  readonly error?: string;
}

/** A frozen application owns its SDK. The resident protocol and exact Node
 * image, not equality of application/owner Git commits, establish compatibility.
 * Installation repeats this proof and binds the owner identity and grant. */
export function refuseReleaseOwners(manifest: ReleaseManifest, stack: IStackConfig, apps: readonly IEcosystemAppEntry[], owners: readonly ReleaseOwnerAnswer[]): string | null {
  const sources = new Map(artifactReleaseContexts(manifest).map(source => [source.app, source]));
  for (const placement of resolveNodePlacements(stack, apps)) {
    if (!placement.apps.length) continue;
    const key = stackNodeKey(placement.node.host, placement.node.port);
    const answers = owners.filter(answer => stackNodeKey(answer.host, answer.port) === key);
    if (answers.length !== 1) return key + ' has no unique authenticated execution owner observation';
    const answer = answers[0]!;
    for (const app of placement.apps) {
      try {
        if (answer.error !== undefined) throw Error('Execution owner verification failed: ' + answer.error);
        assertResidentApplicationRuntime(answer.runtime);
        const source = sources.get(app.name);
        if (!source) throw Error('No verified release artifact');
        assertFrozenLaunch(source.artifact.launch);
        assertReleaseTarget(source.manifest.builtWith.target, answer.runtime.target);
      } catch (error) {
        return app.name + ' on ' + key + ': ' + (error instanceof Error ? error.message : String(error));
      }
    }
  }
  return null;
}
