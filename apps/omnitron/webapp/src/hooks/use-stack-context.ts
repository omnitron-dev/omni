import { useWorkspace } from '../routes/workspace';
import { useShallow } from 'zustand/shallow';
import { useCallback } from 'react';
import { publicDeploymentStack } from '@omnitron-dev/omnitron/release-reading';
import { useProjectStore } from '../stores/project.store';
import { projectPrefixes } from '../utils/project-scope';

/** Match process handles and structured deployment records against the same public workspace. */
export function useStackContext() {
  const { project: activeProject, stack: activeStack } = useWorkspace();
  const project = useProjectStore(s => s.projects.find(item => item.name === activeProject));
  const stacks = useProjectStore(s => activeProject ? s.stacksByProject?.[activeProject] : undefined);
  const namespacePrefixes = useProjectStore(useShallow(state => {
    const info = state.projects.find(item => item.name === activeProject);
    const known = activeProject ? state.stacksByProject?.[activeProject] ?? [] : [];
    return [...new Set([...projectPrefixes(info, activeProject, activeStack),
      ...known.flatMap(item => (!activeStack || item.name === activeStack) && item.runtimeScope
        ? [item.runtimeScope.project + '/' + item.runtimeScope.stack + '/'] : []),
    ])];
  }));
  const matchesNamespace = useCallback((name: string) => !activeProject || namespacePrefixes.some(prefix => name.startsWith(prefix)), [activeProject, namespacePrefixes]);
  const visibleStackName = (sourceProject: string, stack: string) => {
    const observed = stacks?.find(item => item.runtimeScope?.project === sourceProject && item.runtimeScope.stack === stack);
    const name = observed?.name ?? publicDeploymentStack(project ?? (activeProject ? { name: activeProject } : null), sourceProject, stack);
    return activeStack === null || activeStack === name ? name : null;
  };
  return { activeProject, activeStack, namespacePrefix: namespacePrefixes[0] ?? '', namespacePrefixes, matchesNamespace, visibleStackName };
}
