import type { ISeedProject } from '../config/types.js';

import type { ProjectConfigurationInfo } from '../shared/dto/project.js';
export type { ConfigurationImport, ProjectConfigurationInfo, RuntimeStackScope } from '../shared/dto/project.js';

export function validateConfigurationNames(name: string, stacks: Record<string, string>): void {
  const valid = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value);
  if (!valid(name)) throw new Error('Invalid configuration name');
  if (!stacks || typeof stacks !== 'object' || Array.isArray(stacks) || !Object.keys(stacks).length)
    throw new Error('An explicit source-to-project stack mapping is required');
  if (Object.keys(stacks).length > 128 || Object.entries(stacks).some(([source, target]) => !valid(source) || !valid(target)))
    throw new Error('Invalid stack mapping');
  if (new Set(Object.values(stacks)).size !== Object.values(stacks).length)
    throw new Error('Each source stack must have a distinct project stack name');
}

/** Stable runtime namespaces survive a catalogue migration; only their project ownership changes. */
export function configurationInfo(record: ISeedProject): ProjectConfigurationInfo {
  return {
    name: record.configuration?.name ?? 'default',
    path: record.path,
    runtimeProject: record.name,
    stacks: { ...record.configuration?.stacks },
  };
}

export function publicStackName(record: ISeedProject, sourceStack: string): string {
  if (!record.configuration) return sourceStack;
  const name = record.configuration.stacks[sourceStack];
  if (!name) throw new Error(`Configuration '${record.configuration.name}' has an unmapped source stack '${sourceStack}'`);
  return name;
}
