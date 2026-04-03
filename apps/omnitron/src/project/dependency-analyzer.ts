/**
 * Dependency Analyzer — Resolves workspace package graph for an app
 *
 * Given an app (e.g., 'main'), traces all workspace:* dependencies
 * to determine exactly which packages need to be shipped to a remote node.
 *
 * Example for apps/main:
 *   apps/main → depends on:
 *     @omnitron-dev/titan (packages/titan)
 *     @omnitron-dev/common (packages/common)
 *     @omnitron-dev/eventemitter (packages/eventemitter)
 *     @omnitron-dev/messagepack (packages/messagepack)
 *     @omnitron-dev/rotif (packages/rotif)
 *
 * The analyzer returns the minimal set of workspace packages + the app itself
 * that must be copied to the remote node. Only compiled dist/ is needed.
 */

import fs from 'node:fs';
import path from 'node:path';

// =============================================================================
// Types
// =============================================================================

export interface WorkspacePackage {
  /** Package name from package.json (e.g., '@omnitron-dev/titan') */
  name: string;
  /** Absolute path to package root */
  path: string;
  /** Relative path from monorepo root (e.g., 'packages/titan') */
  relativePath: string;
  /** Whether this has a dist/ directory */
  hasDist: boolean;
}

export interface AppDependencyGraph {
  /** The app itself */
  app: WorkspacePackage;
  /** All workspace packages this app depends on (transitive) */
  workspaceDeps: WorkspacePackage[];
  /** All npm (external) dependencies needed */
  externalDeps: string[];
}

// =============================================================================
// Analyzer
// =============================================================================

export class DependencyAnalyzer {
  private readonly workspacePackages = new Map<string, WorkspacePackage>();

  constructor(private readonly monorepoRoot: string) {
    this.scanWorkspace();
  }

  /**
   * Analyze all workspace dependencies for an app.
   * Returns the minimal set of packages to deploy.
   */
  analyze(appPath: string): AppDependencyGraph {
    const absPath = path.resolve(this.monorepoRoot, appPath);
    const pkgJson = this.readPackageJson(absPath);
    if (!pkgJson) throw new Error(`No package.json found at ${absPath}`);

    const app: WorkspacePackage = {
      name: pkgJson.name ?? path.basename(absPath),
      path: absPath,
      relativePath: path.relative(this.monorepoRoot, absPath),
      hasDist: fs.existsSync(path.join(absPath, 'dist')),
    };

    // Trace all workspace:* dependencies transitively
    const visited = new Set<string>();
    const workspaceDeps: WorkspacePackage[] = [];
    const externalDeps: string[] = [];

    this.traceWorkspaceDeps(pkgJson, visited, workspaceDeps, externalDeps);

    return { app, workspaceDeps, externalDeps };
  }

  /**
   * Get all workspace packages.
   */
  getWorkspacePackages(): WorkspacePackage[] {
    return Array.from(this.workspacePackages.values());
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private scanWorkspace(): void {
    // Read pnpm-workspace.yaml to find package globs
    const wsFile = path.join(this.monorepoRoot, 'pnpm-workspace.yaml');
    let patterns: string[] = ['apps/*', 'packages/*'];

    if (fs.existsSync(wsFile)) {
      const content = fs.readFileSync(wsFile, 'utf-8');
      const matches = content.match(/- (.+)/g);
      if (matches) {
        patterns = matches.map((m) => m.replace('- ', '').trim());
      }
    }

    // Expand globs manually (simple * expansion)
    for (const pattern of patterns) {
      const baseParts = pattern.split('*');
      if (baseParts.length !== 2) continue;

      const baseDir = path.join(this.monorepoRoot, baseParts[0]!);
      if (!fs.existsSync(baseDir)) continue;

      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgDir = path.join(baseDir, entry.name);
        const pkgJson = this.readPackageJson(pkgDir);
        if (!pkgJson?.name) continue;

        this.workspacePackages.set(pkgJson.name, {
          name: pkgJson.name,
          path: pkgDir,
          relativePath: path.relative(this.monorepoRoot, pkgDir),
          hasDist: fs.existsSync(path.join(pkgDir, 'dist')),
        });
      }
    }
  }

  private traceWorkspaceDeps(
    pkgJson: any,
    visited: Set<string>,
    workspaceDeps: WorkspacePackage[],
    externalDeps: string[]
  ): void {
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.peerDependencies,
    };

    for (const [depName, depVersion] of Object.entries(allDeps ?? {})) {
      if (visited.has(depName)) continue;
      visited.add(depName);

      const version = depVersion as string;

      if (version.startsWith('workspace:')) {
        // Workspace dependency — include it and trace its deps
        const wsPkg = this.workspacePackages.get(depName);
        if (wsPkg) {
          workspaceDeps.push(wsPkg);
          // Recursively trace this package's dependencies
          const depPkgJson = this.readPackageJson(wsPkg.path);
          if (depPkgJson) {
            this.traceWorkspaceDeps(depPkgJson, visited, workspaceDeps, externalDeps);
          }
        }
      } else {
        // External npm dependency
        externalDeps.push(depName);
      }
    }
  }

  private readPackageJson(dir: string): any | null {
    const pkgPath = path.join(dir, 'package.json');
    try {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {
      return null;
    }
  }
}
