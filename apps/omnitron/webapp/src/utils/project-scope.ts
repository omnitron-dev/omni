import type { IProjectInfo } from '@omnitron-dev/omnitron/dto/services';

/** Public project/stack names and execution namespaces are separate, including historical registrations. */
export function projectPrefixes(info: Pick<IProjectInfo, 'configurations'> | undefined, project: string | null, stack: string | null): string[] {
  if (!project) return [];
  const sources = info?.configurations ?? [];
  if (stack) {
    const prefixes = new Set<string>();
    for (const source of sources) {
      for (const [runtime, name] of Object.entries(source.stacks)) {
        if (name === stack) prefixes.add(`${source.runtimeProject}/${runtime}/`);
      }
    }
    prefixes.add(`${project}/${stack}/`);
    return [...prefixes];
  }
  return [...new Set([project, ...sources.map(source => source.runtimeProject)])].map(name => `${name}/`);
}

export function projectStackName(info: Pick<IProjectInfo, 'configurations'> | undefined, runtimeName: string): string | null {
  const [project, stack] = runtimeName.split('/');
  if (!project || !stack || runtimeName.split('/').length < 3) return null;
  return info?.configurations?.find(source => source.runtimeProject === project)?.stacks[stack] ?? stack;
}

export function restoredProjectScope(projects: IProjectInfo[], project: string, stack: string | null) {
  const owner = projects.find(info => info.name === project || info.configurations?.some(source => source.runtimeProject === project));
  if (!owner) return null;
  const source = owner.configurations?.find(item => item.runtimeProject === project);
  const stacks = Object.values(source?.stacks ?? {});
  return { project: owner.name, stack: owner.name === project ? stack : (stack ? source?.stacks[stack] ?? null : stacks.length === 1 ? stacks[0]! : null) };
}
