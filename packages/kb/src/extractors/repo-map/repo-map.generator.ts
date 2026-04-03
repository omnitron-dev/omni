import type { IRepoMap, IPackageOverview, IDependency } from '../../core/types.js';
import { SpecsParser } from '../../specs/parser.js';

/**
 * Generates a compressed repository map — a token-efficient representation
 * of the entire codebase architecture.
 *
 * Inspired by Aider's repo-map concept: show the skeleton of the code
 * (signatures, not implementations) ranked by importance.
 */
export class RepoMapGenerator {
  private readonly parser = new SpecsParser();

  /**
   * Generate a repo map from package overviews and dependency data.
   */
  generate(
    packages: IPackageOverview[],
    dependencies: IDependency[],
  ): IRepoMap {
    // Build dependency graph
    const depGraph: Record<string, string[]> = {};
    for (const dep of dependencies) {
      if (dep.kind !== 'import') continue;
      if (!depGraph[dep.from]) depGraph[dep.from] = [];
      if (!depGraph[dep.from]!.includes(dep.to)) {
        depGraph[dep.from]!.push(dep.to);
      }
    }

    // Rank packages by importance (number of dependents)
    const importanceCounts = new Map<string, number>();
    for (const pkg of packages) {
      importanceCounts.set(pkg.name, 0);
    }
    for (const deps of Object.values(depGraph)) {
      for (const dep of deps) {
        importanceCounts.set(dep, (importanceCounts.get(dep) ?? 0) + 1);
      }
    }

    const sorted = [...packages].sort((a, b) => {
      const aCount = importanceCounts.get(a.name) ?? 0;
      const bCount = importanceCounts.get(b.name) ?? 0;
      return bCount - aCount;
    });

    // Estimate token cost
    const mapText = this.renderToText(sorted, depGraph);
    const totalTokens = this.parser.estimateTokens(mapText);

    return {
      packages: sorted,
      dependencyGraph: depGraph,
      totalTokens,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Render repo map to a compact text representation.
   * Designed for minimal token usage while maximizing architectural understanding.
   */
  renderToText(
    packages: IPackageOverview[],
    depGraph: Record<string, string[]>,
    detail: 'overview' | 'signatures' | 'full' = 'signatures',
  ): string {
    const lines: string[] = [];
    lines.push('# Repository Map');
    lines.push('');

    for (const pkg of packages) {
      lines.push(`## ${pkg.name}`);
      lines.push(`${pkg.description}`);

      if (detail !== 'overview' && pkg.exports.length > 0) {
        lines.push(`Exports: ${pkg.exports.join(', ')}`);
      }

      if (pkg.keySymbols.length > 0) {
        if (detail === 'overview') {
          lines.push(`Key: ${pkg.keySymbols.slice(0, 5).join(', ')}`);
        } else {
          lines.push(`Symbols: ${pkg.keySymbols.join(', ')}`);
        }
      }

      const deps = depGraph[pkg.name];
      if (deps && deps.length > 0) {
        lines.push(`Depends: ${deps.join(', ')}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }
}
