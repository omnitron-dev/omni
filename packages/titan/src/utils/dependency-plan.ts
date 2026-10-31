/** Structural failures are reported before any graph node is executed. */
export class DependencyGraphError extends Error {
  constructor(
    readonly code: 'duplicate-node' | 'missing-dependency' | 'cycle',
    readonly nodes: readonly string[],
    readonly dependency?: string
  ) {
    super(
      code === 'duplicate-node'
        ? `Duplicate dependency node '${nodes[0]}'`
        : code === 'missing-dependency'
          ? `Unknown dependency '${dependency}' of '${nodes[0]}'`
          : `Circular dependency detected among: ${nodes.join(', ')}`
    );
    this.name = 'DependencyGraphError';
  }
}

/** Stable, iterative O(V + E) dependency waves. Inputs are untouched; repeated edges count once. */
export function dependencyBatches<T>(
  items: readonly T[],
  select: { name: (item: T) => string; dependencies: (item: T) => readonly string[] }
): T[][] {
  const values = new Map<string, T>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const item of items) {
    const name = select.name(item);
    if (values.has(name)) throw new DependencyGraphError('duplicate-node', [name]);
    values.set(name, item);
    outgoing.set(name, []);
  }
  for (const [name, item] of values) {
    const dependencies = new Set(select.dependencies(item));
    incoming.set(name, dependencies.size);
    for (const dependency of dependencies) {
      if (!values.has(dependency)) throw new DependencyGraphError('missing-dependency', [name], dependency);
      outgoing.get(dependency)!.push(name);
    }
  }
  let wave = [...values.keys()].filter((name) => incoming.get(name) === 0);
  const batches: T[][] = [];
  let visited = 0;
  while (wave.length) {
    batches.push(wave.map((name) => values.get(name)!));
    visited += wave.length;
    const next: string[] = [];
    for (const name of wave)
      for (const dependent of outgoing.get(name)!) {
        const count = incoming.get(dependent)! - 1;
        incoming.set(dependent, count);
        if (count === 0) next.push(dependent);
      }
    wave = next;
  }
  if (visited !== values.size)
    throw new DependencyGraphError(
      'cycle',
      [...incoming].filter(([, count]) => count > 0).map(([name]) => name)
    );
  return batches;
}
