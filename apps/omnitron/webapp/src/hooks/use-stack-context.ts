/**
 * useStackContext — Reusable hook for stack-aware data filtering
 *
 * Provides:
 * - activeProject / activeStack from project store
 * - filterApps(apps) — filters ProcessInfoDto[] by current context
 * - displayName(namespacedName) — strips project/stack prefix for display
 * - namespacePrefix — current filter prefix string (e.g., "omni/dev/")
 * - isNamespaced(name) — checks if a name contains namespace separators
 *
 * Usage:
 *   const { filterApps, displayName } = useStackContext();
 *   const filtered = filterApps(allApps);
 *   const label = displayName('omni/dev/main'); // → 'main'
 */

import { useMemo } from 'react';
import { useProjectStore } from '../stores/project.store';
import type { ProcessInfoDto } from '@omnitron-dev/omnitron/dto/services';
import { projectPrefixes, projectStackName } from '../utils/project-scope';

export interface StackContext {
  /** Current project name (null = no filter) */
  activeProject: string | null;
  /** Current stack name (null = all stacks) */
  activeStack: string | null;
  /** Filter prefix: "project/stack/" or "project/" or "" */
  namespacePrefix: string;
  namespacePrefixes: string[];
  matchesNamespace: (name: string) => boolean;
  /** Filter an app list by current project/stack context */
  filterApps: (apps: ProcessInfoDto[]) => ProcessInfoDto[];
  /** Strip project/stack prefix from a namespaced name for display */
  displayName: (name: string) => string;
  /** Extract stack name from a namespaced handle (e.g., "omni/dev/main" → "dev") */
  extractStack: (name: string) => string | null;
  /** Check if a name is namespaced (contains /) */
  isNamespaced: (name: string) => boolean;
  /** Group apps by stack name */
  groupByStack: (apps: ProcessInfoDto[]) => Map<string, ProcessInfoDto[]>;
}

export function useStackContext(): StackContext {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeStack = useProjectStore((s) => s.activeStack);
  const configurationData = useProjectStore((s) => JSON.stringify(s.projects.find(project => project.name === activeProject)?.configurations ?? []));

  return useMemo(() => {
    const info = { configurations: JSON.parse(configurationData) as NonNullable<import('@omnitron-dev/omnitron/dto/services').IProjectInfo['configurations']> };
    const namespacePrefixes = projectPrefixes(info, activeProject, activeStack);
    const namespacePrefix = namespacePrefixes[0] ?? '';
    const matchesNamespace = (name: string) => !activeProject || namespacePrefixes.some(prefix => name.startsWith(prefix));

    const filterApps = (apps: ProcessInfoDto[]): ProcessInfoDto[] => {
      if (!activeProject) return apps;
      return apps.filter((a) => matchesNamespace(a.name));
    };

    const displayName = (name: string): string => {
      if (!name.includes('/')) return name;
      return name.split('/').pop()!;
    };

    const extractStack = (name: string): string | null => projectStackName(info, name);

    const isNamespaced = (name: string): boolean => name.includes('/');

    const groupByStack = (apps: ProcessInfoDto[]): Map<string, ProcessInfoDto[]> => {
      const groups = new Map<string, ProcessInfoDto[]>();
      for (const app of apps) {
        const stackName = extractStack(app.name) ?? 'default';
        if (!groups.has(stackName)) groups.set(stackName, []);
        groups.get(stackName)!.push(app);
      }
      return groups;
    };

    return { activeProject, activeStack, namespacePrefix, namespacePrefixes, matchesNamespace, filterApps, displayName, extractStack, isNamespaced, groupByStack };
  }, [activeProject, activeStack, configurationData]);
}
