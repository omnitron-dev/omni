import type { PipelineStep } from '@omnitron-dev/omnitron/dto/services';

type StepLinks = Pick<PipelineStep, 'name' | 'dependsOn'>;

export const validStepName = (name: string) => /^[\w.-]{1,80}$/.test(name);

/** Levels only position the diagram. Xec admits and schedules the saved dependsOn values. */
export function pipelineLevels(steps: readonly StepLinks[]): Map<string, number> {
  const byName = new Map(steps.map(step => [step.name, step]));
  if (byName.size !== steps.length) throw Error('Every step needs a unique name.');
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  function level(name: string): number {
    const known = levels.get(name);
    if (known !== undefined) return known;
    const step = byName.get(name);
    if (!step) throw Error(`Unknown prerequisite "${name}".`);
    if (visiting.has(name)) throw Error(`A dependency cycle includes "${name}".`);
    visiting.add(name);
    const parents = step.dependsOn ?? [];
    const rank = parents.length ? 1 + Math.max(...parents.map(level)) : 0;
    visiting.delete(name);
    levels.set(name, rank);
    return rank;
  }
  for (const step of steps) level(step.name);
  return levels;
}

export function canConnectSteps(steps: readonly StepLinks[], from: string, to: string): boolean {
  const byName = new Map(steps.map(step => [step.name, step]));
  const target = byName.get(to);
  if (!byName.has(from) || !target || target.dependsOn?.includes(from)) return false;
  const visited = new Set<string>();
  const pending = [from];
  while (pending.length) {
    const current = pending.pop()!;
    if (current === to) return false;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(byName.get(current)?.dependsOn ?? []));
  }
  return true;
}

export function renameStep(steps: readonly PipelineStep[], oldName: string, newName: string): PipelineStep[] {
  return steps.map(step => {
    if (step.name === oldName) return { ...step, name: newName };
    if (!step.dependsOn?.includes(oldName)) return step;
    return { ...step, dependsOn: step.dependsOn.map(name => name === oldName ? newName : name) };
  });
}

export function removeStep(steps: readonly PipelineStep[], removed: string): PipelineStep[] {
  return steps.filter(step => step.name !== removed).map(step => step.dependsOn?.includes(removed)
    ? { ...step, dependsOn: step.dependsOn.filter(name => name !== removed) } : step);
}

export function parsePipelineSteps(source: string): PipelineStep[] {
  const steps: unknown = JSON.parse(source);
  if (!Array.isArray(steps) || !steps.length || steps.length > 32) throw Error('A pipeline needs 1–32 steps.');
  for (const step of steps) {
    if (!step || typeof step.name !== 'string' || !validStepName(step.name))
      throw Error('Step names must use 1–80 letters, numbers, dots, underscores or hyphens.');
    if (step.dependsOn !== undefined && (!Array.isArray(step.dependsOn) ||
        !step.dependsOn.every((name: unknown) => typeof name === 'string' && validStepName(name))))
      throw Error(`Prerequisites for "${step.name}" must be an array of step names.`);
    if (step.kind === 'release' || step.kind === 'deploy') {
      if (!step.target || typeof step.target !== 'object' || Array.isArray(step.target) || step.run !== undefined)
        throw Error(`Check the target of "${step.name}".`);
    } else if ((step.kind !== undefined && step.kind !== 'xec' && step.kind !== 'shell') || typeof step.run !== 'string')
      throw Error(`Check the executor and source of "${step.name}".`);
  }
  pipelineLevels(steps);
  return steps;
}
