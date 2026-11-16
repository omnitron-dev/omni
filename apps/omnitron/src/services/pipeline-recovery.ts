import { createHash } from 'node:crypto';
import type { PipelineRun, PipelineRecoveryReview, PipelineRunStepResult } from '../shared/dto/pipelines.js';

/** A host projects the remaining graph; Xec still owns scheduling and execution. */
export function completedStep(step: PipelineRunStepResult): boolean {
  return step.status === 'success' || (step.status === 'skipped' && step.exitCode === 0);
}

export function recoverableStep(step: PipelineRunStepResult): boolean {
  if (completedStep(step)) return false;
  // Persisting step-start precedes dispatch. No such record means no effect was authorized.
  return !step.startedAt && !step.attempts && !step.executions?.length && !step.deployment;
}

export function recoveryReview(run: Pick<PipelineRun, 'id' | 'status' | 'steps'>): PipelineRecoveryReview {
  const completed = run.steps.filter(completedStep).map(step => step.name);
  const pending = run.steps.filter(recoverableStep).map(step => step.name);
  return { digest: createHash('sha256').update(JSON.stringify([run.id, run.status, run.steps])).digest('hex'),
    completed, pending, blocked: run.steps.filter(step => !completedStep(step) && !recoverableStep(step)).map(step => step.name) };
}
