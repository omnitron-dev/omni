import { useCallback } from 'react';
import { useShallow } from 'zustand/shallow';
import { publicDeploymentStack } from '@omnitron-dev/omnitron/release-reading';
import { useProjectStore } from '../stores/project.store';
import { projectPrefixes } from '../utils/project-scope';

/** Match process handles and structured deployment records against the same public workspace. */
export function useStackContext() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeStack = useProjectStore((s) => s.activeStack);
  const project = useProjectStore(s => s.projects.find(item => item.name === s.activeProject));
  const namespacePrefixes = useProjectStore(useShallow(s => projectPrefixes(
    s.projects.find(item => item.name === s.activeProject), s.activeProject, s.activeStack,
  )));

  const matchesNamespace = useCallback((name: string) => !activeProject || namespacePrefixes.some(prefix => name.startsWith(prefix)), [activeProject, namespacePrefixes]);
  const visibleStackName = (sourceProject: string, stack: string) => {
    const name = publicDeploymentStack(project ?? (activeProject ? { name: activeProject } : null), sourceProject, stack);
    return activeStack === null || activeStack === name ? name : null;
  };
  return { activeProject, activeStack, namespacePrefix: namespacePrefixes[0] ?? '', namespacePrefixes, matchesNamespace, visibleStackName };
}
