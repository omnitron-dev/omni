/**
 * Dependency resolver using topological sort
 */

export interface DependencyGraph {
  [key: string]: string[];
}

/**
 * Resolve task dependencies using topological sort
 */
export function resolveDependencies(graph: DependencyGraph): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(node: string, path: string[]): void {
    if (visited.has(node)) {
      return;
    }

    if (visiting.has(node)) {
      throw new Error(`Circular dependency detected: ${[...path, node].join(' -> ')}`);
    }

    visiting.add(node);
    path.push(node);

    const deps = graph[node] || [];
    for (const dep of deps) {
      if (!graph[dep]) {
        throw new Error(`Task '${node}' depends on '${dep}', but '${dep}' is not defined`);
      }
      visit(dep, [...path]);
    }

    visiting.delete(node);
    visited.add(node);
    sorted.push(node);
  }

  // Visit all nodes
  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      visit(node, []);
    }
  }

  return sorted;
}

/**
 * Get execution order for a list of tasks
 */
export function getExecutionOrder(tasks: string[], graph: DependencyGraph): string[] {
  // Build subgraph with only requested tasks and their dependencies
  const subgraph: DependencyGraph = {};
  const required = new Set<string>(tasks);

  function addDependencies(task: string): void {
    if (subgraph[task]) {
      return;
    }

    const deps = graph[task] || [];
    subgraph[task] = deps;

    for (const dep of deps) {
      required.add(dep);
      addDependencies(dep);
    }
  }

  for (const task of tasks) {
    addDependencies(task);
  }

  // Sort the subgraph
  const sorted = resolveDependencies(subgraph);

  // Filter to only include explicitly requested tasks and their dependencies
  return sorted.filter((task) => required.has(task));
}

/**
 * Check if dependencies have a cycle
 */
export function hasCycle(graph: DependencyGraph): {
  hasCycle: boolean;
  cycle?: string[];
} {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(node: string, path: string[]): string[] | null {
    if (visited.has(node)) {
      return null;
    }

    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      return [...path.slice(cycleStart), node];
    }

    visiting.add(node);
    path.push(node);

    const deps = graph[node] || [];
    for (const dep of deps) {
      const cycle = visit(dep, [...path]);
      if (cycle) {
        return cycle;
      }
    }

    visiting.delete(node);
    visited.add(node);

    return null;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      const cycle = visit(node, []);
      if (cycle) {
        return { hasCycle: true, cycle };
      }
    }
  }

  return { hasCycle: false };
}
