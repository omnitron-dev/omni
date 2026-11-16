import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Pipeline, PipelineRunReview, PreparePipelineRun, StartPipelineRun } from '../shared/dto/pipelines.js';
import { validatePipelineParams } from './pipeline-definition.js';

/** Only stored on the control plane; the wire receipt contains review alone. */
export interface PipelineAdmission {
  protocol: 1;
  review: PipelineRunReview;
  parameterKey: string;
  parameterCommitment: string;
  approvedBy?: string;
}

export function validateRunId(id: string): void {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))
    throw new Error('Pipeline runId must be a caller-generated UUID v4');
}

function parameters(params: Record<string, unknown>): string {
  validatePipelineParams(params);
  return JSON.stringify(Object.entries(params).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

function commitment(key: string, params: Record<string, unknown>): string {
  return createHmac('sha256', key).update(parameters(params)).digest('hex');
}

export function admitPipeline(runId: string, definition: Pipeline, params: Record<string, unknown>, actor: string): PipelineAdmission {
  const parameterKey = randomBytes(32).toString('hex');
  const parameterCommitment = commitment(parameterKey, params);
  const review: PipelineRunReview = {
    protocol: 1,
    digest: createHash('sha256').update(JSON.stringify({ runId, definition: definition.revision, actor, parameterCommitment })).digest('hex'),
    definitionRevision: definition.revision,
    projects: [...new Set(definition.steps.flatMap(step => step.kind === 'release' ? [step.target.project] : []))].sort(),
    parameterNames: Object.keys(params).sort(),
  };
  return { protocol: 1, review, parameterKey, parameterCommitment };
}

export function readAdmission(stored: unknown): PipelineAdmission | undefined {
  if (stored == null) return undefined;
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const data: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored;
  const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
  if (!object(data) || data['protocol'] !== 1 || !object(data['review']) || data['review']['protocol'] !== 1 || !hex(data['parameterKey']) ||
    !hex(data['parameterCommitment']) || !hex(data['review']['digest']) || !hex(data['review']['definitionRevision']) ||
    !strings(data['review']['projects']) || !strings(data['review']['parameterNames']))
    throw new Error('Invalid stored pipeline admission');
  if (data['approvedBy'] !== undefined && (typeof data['approvedBy'] !== 'string' || !data['approvedBy']))
    throw new Error('Invalid stored pipeline approver');
  return { protocol: 1, ...(typeof data['approvedBy'] === 'string' ? { approvedBy: data['approvedBy'] } : {}), parameterKey: data['parameterKey'], parameterCommitment: data['parameterCommitment'],
    review: { protocol: 1, digest: data['review']['digest'], definitionRevision: data['review']['definitionRevision'],
      projects: data['review']['projects'], parameterNames: data['review']['parameterNames'] } };
}

export function assertParameters(admission: PipelineAdmission, params: Record<string, unknown>): void {
  if (commitment(admission.parameterKey, params) !== admission.parameterCommitment)
    throw new Error('Parameters differ from the reviewed pipeline admission');
}


function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a pipeline request object');
  return value as Record<string, unknown>;
}

function textInput(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a pipeline identity string');
  return value;
}

export function readPrepareRun(value: unknown): PreparePipelineRun {
  const input = objectInput(value);
  const request = { runId: textInput(input['runId']), id: textInput(input['id']),
    expectedRevision: textInput(input['expectedRevision']), params: objectInput(input['params'] ?? {}) };
  validateRunId(request.runId);
  if (!/^[a-f0-9]{64}$/.test(request.expectedRevision)) throw new Error('Review the current definition before running it');
  validatePipelineParams(request.params);
  return request;
}

export function readStartRun(value: unknown): StartPipelineRun {
  const input = objectInput(value);
  const request = { runId: textInput(input['runId']), expectedDigest: textInput(input['expectedDigest']),
    params: objectInput(input['params'] ?? {}) };
  validateRunId(request.runId);
  if (!/^[a-f0-9]{64}$/.test(request.expectedDigest)) throw new Error('Review the exact pipeline admission before starting it');
  validatePipelineParams(request.params);
  return request;
}
