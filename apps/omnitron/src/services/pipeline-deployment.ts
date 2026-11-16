import type { PipelineDeploymentEvidence } from '../shared/dto/pipelines.js';
import type { IStackInfo } from '../shared/dto/project.js';

/** Use fresh node-qualified launch receipts. Disk inspection and selection are not execution evidence. */
export function observePipelineDeployment(evidence: PipelineDeploymentEvidence, info: IStackInfo): NonNullable<PipelineDeploymentEvidence['observation']> {
  const apps = evidence.expected.map(expected => {
    const placement = info.placements?.find(node => node.nodeKey === expected.node);
    const actual = placement?.apps.find(app => app.name === expected.app && app.expected)?.process;
    const receipt = actual?.release;
    const matches = placement?.appsObserved === true && actual?.status === 'online' && receipt?.state === 'confirmed' &&
      receipt.basis === 'verified-launch' && Boolean(receipt.launchId) && Boolean(receipt.treeSha256) &&
      receipt.releaseId === expected.releaseId && receipt.manifestSha256 === expected.manifestSha256 &&
      receipt.artifactSha256 === expected.artifactSha256 &&
      (!receipt.consumer ? expected.releaseId === evidence.target.releaseId && expected.manifestSha256 === evidence.target.manifestSha256 :
        receipt.consumer.releaseId === evidence.target.releaseId && receipt.consumer.manifestSha256 === evidence.target.manifestSha256 && receipt.consumer.app === expected.app);
    return { node: expected.node, app: expected.app, matches, launchId: receipt?.state === 'confirmed' ? receipt.launchId : null };
  });
  const current = info.placements?.flatMap(node => node.apps.filter(app => app.expected).map(app => [node.nodeKey, app.name].join('/'))).sort();
  const expected = evidence.expected.map(app => [app.node, app.app].join('/')).sort();
  return { basis: 'observed-target', observedAt: new Date().toISOString(), apps,
    confirmed: apps.length > 0 && apps.every(app => app.matches) && JSON.stringify(current) === JSON.stringify(expected) };
}
