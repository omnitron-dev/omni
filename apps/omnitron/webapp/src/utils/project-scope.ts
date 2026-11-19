import { publicDeploymentStack } from '@omnitron-dev/omnitron/release-reading';
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
  return [...new Set([project + '/', ...sources.flatMap(source => Object.keys(source.stacks).map(name => source.runtimeProject + '/' + name + '/'))])];
}

/** Historical controllers omit workspace metadata. Only a unique registered owner can supply it. */
export function processWorkspace(projects: readonly IProjectInfo[], handle: string) {
  const parts = handle.split('/');
  if (parts.length !== 3 || parts.some(part => !part)) return null;
  return deploymentWorkspace(projects, parts[0]!, parts[1]!);
}

export function deploymentWorkspace(projects: readonly IProjectInfo[], runtimeProject: string, runtimeStack: string) {
  const owners = projects.flatMap(info => {
    const stack = publicDeploymentStack(info, runtimeProject, runtimeStack);
    return stack ? [{ project: info.name, stack }] : [];
  });
  return owners.length === 1 ? owners[0]! : null;
}
