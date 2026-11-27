import { createHash } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const protocol = 'omnitron.pipeline.shell-receipt/1';

/** The digest covers complete successful shell observations without releasing their output. */
export function pipelineShellReceipt(run) {
  if (!run || run.status !== 'success' || typeof run.id !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(run.id) || !hash(run.review?.digest) ||
      !Array.isArray(run.steps) || run.steps.length === 0) {
    throw Error('A successful reviewed Pipeline run is required for a shell receipt');
  }
  const seen = new Set();
  const steps = run.steps.map(step => {
    if (!step || typeof step.name !== 'string' || !step.name || seen.has(step.name) ||
        typeof step.nodeId !== 'string' || !step.nodeId || !hash(step.sourceHash) || step.kind !== 'shell' ||
        step.status !== 'success' || step.exitCode !== 0 || step.outputTruncated !== false || typeof step.output !== 'string') {
      throw Error('A shell receipt requires unique successful shell steps with complete retained output and reviewed sources');
    }
    seen.add(step.name);
    return [step.name, step.nodeId, step.sourceHash, step.kind, step.status, step.exitCode, step.outputTruncated, sha256(step.output)];
  });
  steps.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const review = run.review.digest;
  const digest = sha256(JSON.stringify([protocol, run.id, review, run.status, steps]));
  return { protocol, id: run.id, review, digest };
}
