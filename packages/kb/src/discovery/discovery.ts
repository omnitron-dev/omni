import { readFile, access } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { glob } from 'node:fs/promises';
import type { IKbConfig, IKbSource, KbSourceType } from '../core/types.js';

/**
 * Discovers knowledge base sources across the monorepo and node_modules.
 *
 * Three discovery levels:
 * 1. Builtin — cross-cutting specs shipped with @omnitron-dev/kb
 * 2. Workspace — packages/apps in the pnpm workspace with kb/ directories
 * 3. External — node_modules packages declaring "omnitron.kb" in package.json
 */
export class KnowledgeDiscovery {
  constructor(private readonly builtinSpecsPath: string) {}

  /**
   * Discover all knowledge sources.
   */
  async discover(workspaceRoot: string): Promise<IKbSource[]> {
    const [builtin, workspace, external] = await Promise.all([
      this.discoverBuiltin(),
      this.discoverWorkspace(workspaceRoot),
      this.discoverExternal(workspaceRoot),
    ]);
    return [...builtin, ...workspace, ...external];
  }

  /**
   * Level 1: Built-in cross-cutting specs shipped with @omnitron-dev/kb.
   */
  private async discoverBuiltin(): Promise<IKbSource[]> {
    const specsPath = this.builtinSpecsPath;
    const exists = await pathExists(specsPath);
    if (!exists) return [];

    return [{
      type: 'builtin',
      path: specsPath,
      root: resolve(specsPath, '..'),
      packageName: '@omnitron-dev/kb',
      config: {
        module: 'kb',
        name: 'Cross-cutting Knowledge',
        tags: ['cross-cutting', 'patterns', 'getting-started'],
        extract: { symbols: false, decorators: [], entryPoints: [] },
        specs: '.',
        relationships: {},
      },
    }];
  }

  /**
   * Level 2: Workspace packages with kb/ directories.
   * Scans packages/* and apps/* for kb/kb.config.ts
   */
  private async discoverWorkspace(root: string): Promise<IKbSource[]> {
    const sources: IKbSource[] = [];
    const patterns = [
      'packages/*/kb/kb.config.ts',
      'apps/*/kb/kb.config.ts',
    ];

    for (const pattern of patterns) {
      const configPaths = await expandGlob(root, pattern);
      for (const configPath of configPaths) {
        const source = await this.loadSource(configPath, 'workspace');
        if (source) sources.push(source);
      }
    }

    return sources;
  }

  /**
   * Level 3: External npm packages declaring "omnitron.kb" in package.json.
   * Scans node_modules for packages with the omnitron.kb field.
   */
  private async discoverExternal(root: string): Promise<IKbSource[]> {
    const sources: IKbSource[] = [];
    const nodeModulesPath = resolve(root, 'node_modules');

    const exists = await pathExists(nodeModulesPath);
    if (!exists) return [];

    // Scan scoped and non-scoped packages
    const packageJsonPaths = await expandGlob(nodeModulesPath, '*/package.json');
    const scopedPaths = await expandGlob(nodeModulesPath, '@*/*/package.json');

    for (const pkgJsonPath of [...packageJsonPaths, ...scopedPaths]) {
      try {
        const raw = await readFile(pkgJsonPath, 'utf-8');
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        const omnitronField = pkg['omnitron'] as Record<string, unknown> | undefined;

        if (!omnitronField?.['kb']) continue;

        const kbRelPath = omnitronField['kb'] as string;
        const pkgDir = dirname(pkgJsonPath);
        const kbConfigPath = resolve(pkgDir, kbRelPath, 'kb.config.ts');

        // For published packages, look for compiled config
        const kbConfigJsPath = resolve(pkgDir, kbRelPath, 'kb.config.js');
        const actualPath = (await pathExists(kbConfigPath)) ? kbConfigPath : kbConfigJsPath;

        const source = await this.loadSource(actualPath, 'external');
        if (source) {
          source.packageName = pkg['name'] as string;
          sources.push(source);
        }
      } catch {
        // Skip packages with malformed package.json
      }
    }

    return sources;
  }

  /**
   * Load a single KB source from its config file path.
   * Falls back to convention-based config if import fails.
   */
  private async loadSource(
    configPath: string,
    type: KbSourceType,
  ): Promise<IKbSource | null> {
    const exists = await pathExists(configPath);
    if (!exists) return null;

    const kbDir = dirname(configPath);
    const packageRoot = resolve(kbDir, '..');

    // Read package name and metadata from package.json
    let packageName = 'unknown';
    let packageDescription = '';
    const pkgJsonPath = resolve(packageRoot, 'package.json');
    if (await pathExists(pkgJsonPath)) {
      try {
        const raw = await readFile(pkgJsonPath, 'utf-8');
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        packageName = (pkg['name'] as string) ?? packageName;
        packageDescription = (pkg['description'] as string) ?? '';
      } catch {
        // fallback
      }
    }

    // Try to import kb.config.ts
    try {
      const imported = await import(configPath);
      const config: IKbConfig = imported.default ?? imported;
      if (!config.module) config.module = packageName;

      return {
        type,
        path: kbDir,
        root: packageRoot,
        packageName,
        config,
      };
    } catch {
      // Import failed (e.g. @omnitron-dev/kb not in deps) — use convention-based fallback
      const moduleName = packageName.replace(/^@omnitron-dev\//, '');

      return {
        type,
        path: kbDir,
        root: packageRoot,
        packageName,
        config: {
          module: moduleName,
          name: packageDescription || moduleName,
          tags: [moduleName],
          extract: { symbols: true, decorators: [], entryPoints: ['src/index.ts'] },
          specs: './specs',
        },
      };
    }
  }
}

// ---- Helpers ----------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function expandGlob(cwd: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  try {
    for await (const entry of glob(pattern, { cwd })) {
      results.push(resolve(cwd, entry));
    }
  } catch {
    // glob may fail on some platforms
  }
  return results;
}
