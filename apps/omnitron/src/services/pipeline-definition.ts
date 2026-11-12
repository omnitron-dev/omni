import type { PipelineDef, PipelineStep } from '../shared/dto/pipelines.js';
import { assertArtifactIdentity } from '../runtime/identity.js';
import { assertReleaseLoaderEnvironment } from '../release/target-runtime.js';

export const PIPELINE_LIMITS = {
  steps: 32,
  activeRuns: 8,
  concurrency: 4,
  sourceBytes: 128 * 1024,
  outputBytes: 32 * 1024,
} as const;

/** A deliberately small condition language. Unsupported expressions never authorize a step. */
export function pipelineCondition(expression: string, params: Record<string, unknown>): boolean {
  const comparison = expression.match(/^params\.(\w+)\s*(==|!=)\s*(['"])(.*?)\3\s*$/);
  if (comparison) {
    const equal = String(params[comparison[1]!] ?? '') === comparison[4];
    return comparison[2] === '==' ? equal : !equal;
  }
  const boolean = expression.match(/^(!\s*)?params\.(\w+)\s*$/);
  if (boolean) return boolean[1] ? !params[boolean[2]!] : Boolean(params[boolean[2]!]);
  throw new Error(`Unsupported pipeline condition: ${expression}`);
}

export function validatePipeline(def: PipelineDef): void {
  if (!def || typeof def.name !== 'string' || !def.name.trim() || def.name.length > 120)
    throw new Error('Pipeline name must contain 1–120 characters');
  if (def.description !== undefined && (typeof def.description !== 'string' || def.description.length > 2000))
    throw new Error('Pipeline description must contain at most 2000 characters');
  if (!Array.isArray(def.steps) || !def.steps.length || def.steps.length > PIPELINE_LIMITS.steps)
    throw new Error(`A pipeline requires 1–${PIPELINE_LIMITS.steps} steps`);
  if (
    def.triggers !== undefined &&
    (!Array.isArray(def.triggers) || def.triggers.some((trigger) => !trigger || trigger.type !== 'manual'))
  )
    throw new Error('Only manual triggers are currently supported');
  for (const step of def.steps) {
    if (!step || typeof step.name !== 'string' || !/^[\w.-]{1,80}$/.test(step.name))
      throw new Error('Invalid step name');
    if (step.kind === 'release') {
      if (step.run !== undefined) throw new Error('A release step cannot contain shell source');
      if (step.nodeId !== undefined && step.nodeId !== 'local')
        throw new Error('Release pipeline steps require the local resident execution owner; remote execution is unsupported');
      const target = step.target;
      if (!target || Object.keys(target).sort().join(',') !== 'app,artifact,entry,project,stack' ||
          [target.project, target.stack, target.app].some(value => typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value) || value.includes('..')) ||
          typeof target.entry !== 'string' || target.entry.length > 4096 || /[\\:\0]/.test(target.entry) ||
          !target.entry.split('/').every(part => part && part !== '.' && part !== '..') || !/\.[cm]?js$/.test(target.entry))
        throw new Error('Release steps require a complete project/stack/app target and a package-relative compiled entry');
      assertArtifactIdentity(target.artifact);
      if (step.args !== undefined && (!Array.isArray(step.args) || step.args.length > 64 ||
          step.args.some(value => typeof value !== 'string' || value.length > 8192 || value.includes('\0')) ||
          Buffer.byteLength(JSON.stringify(step.args)) > 16 * 1024)) throw new Error('Invalid release step arguments');
      if (['PATH', 'NODE_OPTIONS', 'NODE_PATH'].some(key => Object.hasOwn(step.env ?? {}, key)))
        throw new Error('Release step PATH and Node options belong to the verified runtime and application, not the pipeline');
      assertReleaseLoaderEnvironment(step.env);
    } else {
      if (step.kind !== undefined && step.kind !== 'shell' && step.kind !== 'xec') throw new Error('Unknown step kind');
      if (step.target !== undefined || step.args !== undefined) throw new Error('Only release steps accept an artifact target and arguments');
      if (typeof step.run !== 'string' || !step.run.trim() || Buffer.byteLength(step.run) > PIPELINE_LIMITS.sourceBytes)
        throw new Error(`Step ${step.name} requires source of at most 128 KiB`);
      if (/\{\{\w+\}\}/.test(step.run))
        throw new Error('Shell interpolation is disabled. Use params in Xec or OMNITRON_PARAMS JSON in shell steps');
    }
    if (
      step.timeout !== undefined &&
      (!Number.isInteger(step.timeout) || step.timeout < 1 || step.timeout > 86_400_000)
    )
      throw new Error('Step timeout must be between 1 ms and 24 hours');
    if (step.retries !== undefined && (!Number.isInteger(step.retries) || step.retries < 0 || step.retries > 5))
      throw new Error('Step retries must be between 0 and 5');
    for (const value of [step.cwd, step.nodeId])
      if (value !== undefined && (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')))
        throw new Error('Invalid working directory or node ID');
    if (
      step.dependsOn !== undefined &&
      (!Array.isArray(step.dependsOn) || !step.dependsOn.every((d) => typeof d === 'string'))
    )
      throw new Error('Step dependencies must be an array of names');
    if (
      step.env !== undefined &&
      (!step.env ||
        Array.isArray(step.env) ||
        typeof step.env !== 'object' ||
        Object.keys(step.env).length > 64 ||
        Object.entries(step.env).some(
          ([key, value]) =>
            !/^[A-Za-z_][\w]*$/.test(key) || typeof value !== 'string' || value.length > 8192 || value.includes('\0')
        ))
    )
      throw new Error('Invalid step environment');
    if (step.condition !== undefined) {
      if (typeof step.condition !== 'string' || step.condition.length > 512) throw new Error('Invalid step condition');
      pipelineCondition(step.condition, {});
    }
  }
}

export function validatePipelineParams(params: Record<string, unknown> = {}): void {
  if (
    !params ||
    Array.isArray(params) ||
    typeof params !== 'object' ||
    Object.keys(params).length > 64 ||
    Object.values(params).some(
      (value) =>
        (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) ||
        (typeof value === 'number' && !Number.isFinite(value))
    ) ||
    Buffer.byteLength(JSON.stringify(params)) > 16 * 1024
  )
    throw new Error('Parameters must be scalar JSON values, at most 16 KiB');
}

export function stepEnvironment(step: PipelineStep, params: Record<string, unknown>): Record<string, string> {
  return { ...step.env, OMNITRON_PARAMS: JSON.stringify(params) };
}
