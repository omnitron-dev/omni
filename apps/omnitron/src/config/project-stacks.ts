import fs from 'node:fs';
import path from 'node:path';
import type { IEcosystemConfig, IStackConfig } from './types.js';

export function readProjectStacks(file: string, project: string): Record<string, IStackConfig> {
  try {
    const stacks: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!stacks || typeof stacks !== 'object' || Array.isArray(stacks)) throw Error('Expected an object of stacks');
    for (const [name, stack] of Object.entries(stacks)) {
      if (!stack || typeof stack !== 'object' || Array.isArray(stack)) throw Error('Invalid stack definition for ' + name);
    }
    return stacks as Record<string, IStackConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read stack overrides for '${project}'; file left intact`, { cause: error });
  }
}

/** Runtime and release builds resolve the same declarations. The ecosystem file owns a name collision. */
export function resolveProjectStacks(config: Pick<IEcosystemConfig, 'stacks'>, directory: string, project = directory): Record<string, IStackConfig> {
  return { ...readProjectStacks(path.join(directory, 'omnitron.stacks.json'), project), ...config.stacks };
}
