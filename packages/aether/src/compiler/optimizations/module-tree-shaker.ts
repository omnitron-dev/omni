/**
 * Module Tree Shaker
 *
 * Tree-shaking optimization at module boundaries
 * Removes unused module exports, providers, and stores
 */

import * as ts from 'typescript';
import type { ModuleMetadata, ModuleAnalysisResult } from './module-analyzer.js';
import type { OptimizationPass, OptimizationResult, OptimizationChange, OptimizationContext, OptimizerOptions } from '../optimizer.js';

/**
 * Module tree shaker options
 */
export interface ModuleTreeShakerOptions {
  /**
   * Remove unused module exports
   * @default true
   */
  removeUnusedExports?: boolean;

  /**
   * Remove unused providers
   * @default true
   */
  removeUnusedProviders?: boolean;

  /**
   * Remove unused stores
   * @default true
   */
  removeUnusedStores?: boolean;

  /**
   * Remove entire modules if unused
   * @default true
   */
  removeUnusedModules?: boolean;

  /**
   * Aggressive mode removes more aggressively
   * @default false
   */
  aggressive?: boolean;
}

/**
 * Module usage tracking
 */
interface ModuleUsageInfo {
  moduleId: string;
  isImported: boolean;
  importedBy: Set<string>;
  exportsUsed: Set<string>;
  providersUsed: Set<string>;
  storesUsed: Set<string>;
}

/**
 * Module Tree Shaker Pass
 *
 * Optimization pass for tree-shaking at module boundaries
 */
export class ModuleTreeShakerPass implements OptimizationPass {
  name = 'module-tree-shaker';
  priority = 450; // Run after regular tree-shaker

  private options: Required<ModuleTreeShakerOptions>;
  private moduleAnalysis: ModuleAnalysisResult | null = null;
  private usageInfo = new Map<string, ModuleUsageInfo>();

  constructor(optimizerOptions: Required<OptimizerOptions>) {
    this.options = {
      removeUnusedExports: true,
      removeUnusedProviders: true,
      removeUnusedStores: true,
      removeUnusedModules: true,
      aggressive: optimizerOptions.mode === 'aggressive',
    };
  }

  /**
   * Transform code with module tree-shaking
   */
  async transform(code: string, context: OptimizationContext): Promise<OptimizationResult> {
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    // Parse code to AST
    const sourceFile = ts.createSourceFile(context.modulePath || 'input.tsx', code, ts.ScriptTarget.Latest, true);

    // Analyze modules
    const { analyzeModules } = await import('./module-analyzer.js');
    this.moduleAnalysis = analyzeModules(sourceFile);

    if (this.moduleAnalysis.modules.length === 0) {
      // No modules found, return unchanged
      return { code, changes, warnings };
    }

    // Build usage info
    this.buildUsageInfo();

    // Apply tree-shaking transformations
    let optimizedCode = code;

    if (this.options.removeUnusedModules) {
      const result = this.removeUnusedModules(optimizedCode, sourceFile);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    if (this.options.removeUnusedExports) {
      const result = this.removeUnusedExports(optimizedCode, sourceFile);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    if (this.options.removeUnusedProviders) {
      const result = this.removeUnusedProviders(optimizedCode, sourceFile);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    if (this.options.removeUnusedStores) {
      const result = this.removeUnusedStores(optimizedCode, sourceFile);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    return {
      code: optimizedCode,
      changes,
      warnings,
      metadata: {
        modulesAnalyzed: this.moduleAnalysis.modules.length,
        modulesRemoved: changes.filter((c) => c.description?.includes('module')).length,
        exportsRemoved: changes.filter((c) => c.description?.includes('export')).length,
        providersRemoved: changes.filter((c) => c.description?.includes('provider')).length,
        storesRemoved: changes.filter((c) => c.description?.includes('store')).length,
      },
    };
  }

  /**
   * Build usage information for all modules
   */
  private buildUsageInfo(): void {
    if (!this.moduleAnalysis) return;

    const { modules, dependencies } = this.moduleAnalysis;

    // Initialize usage info for each module
    for (const module of modules) {
      this.usageInfo.set(module.id, {
        moduleId: module.id,
        isImported: false,
        importedBy: new Set(),
        exportsUsed: new Set(),
        providersUsed: new Set(),
        storesUsed: new Set(),
      });
    }

    // Track module imports
    for (const [moduleId, deps] of dependencies) {
      for (const dep of deps) {
        const usageInfo = this.usageInfo.get(dep);
        if (usageInfo) {
          usageInfo.isImported = true;
          usageInfo.importedBy.add(moduleId);
        }
      }
    }

    // Track what is actually used from each module
    for (const module of modules) {
      if (module.exports) {
        // Mark exported providers as potentially used if module is imported
        const usageInfo = this.usageInfo.get(module.id);
        if (usageInfo && usageInfo.isImported) {
          for (const provider of module.exports.providers) {
            usageInfo.exportsUsed.add(provider);
            usageInfo.providersUsed.add(provider);
          }
          for (const store of module.exports.stores) {
            usageInfo.exportsUsed.add(store);
            usageInfo.storesUsed.add(store);
          }
        }
      }
    }
  }

  /**
   * Remove unused modules
   */
  private removeUnusedModules(
    code: string,
    sourceFile: ts.SourceFile
  ): { code: string; changes: OptimizationChange[] } {
    if (!this.moduleAnalysis) {
      return { code, changes: [] };
    }

    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    for (const module of this.moduleAnalysis.modules) {
      const usageInfo = this.usageInfo.get(module.id);

      // Can remove if:
      // 1. Not imported by any other module
      // 2. Not the root module (has no dependents)
      // 3. Marked as pure and has no side effects
      if (usageInfo && !usageInfo.isImported && module.optimization?.pure && !module.hasSideEffects) {
        // Find and remove the defineModule call
        const modulePattern = this.createModuleRemovalPattern(module, sourceFile);
        if (modulePattern) {
          const beforeLength = optimizedCode.length;
          optimizedCode = optimizedCode.replace(modulePattern, '');
          const afterLength = optimizedCode.length;

          if (beforeLength !== afterLength) {
            changes.push({
              type: 'tree-shake',
              description: `Removed unused module '${module.id}'`,
              sizeImpact: beforeLength - afterLength,
              location: module.location?.line !== undefined && module.location?.column !== undefined
                ? { line: module.location.line, column: module.location.column }
                : undefined,
            });
          }
        }
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove unused exports from modules
   */
  private removeUnusedExports(
    code: string,
    sourceFile: ts.SourceFile
  ): { code: string; changes: OptimizationChange[] } {
    if (!this.moduleAnalysis) {
      return { code, changes: [] };
    }

    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    for (const module of this.moduleAnalysis.modules) {
      if (!module.exports) continue;

      const usageInfo = this.usageInfo.get(module.id);
      if (!usageInfo) continue;

      // Remove unused exported providers
      for (const provider of module.exports.providers) {
        if (!usageInfo.exportsUsed.has(provider)) {
          // This export is never used
          const pattern = this.createExportRemovalPattern(provider, 'providers', module, sourceFile);
          if (pattern) {
            const beforeLength = optimizedCode.length;
            optimizedCode = optimizedCode.replace(pattern, '');
            const afterLength = optimizedCode.length;

            if (beforeLength !== afterLength) {
              changes.push({
                type: 'tree-shake',
                description: `Removed unused export provider '${provider}' from module '${module.id}'`,
                sizeImpact: beforeLength - afterLength,
              });
            }
          }
        }
      }

      // Remove unused exported stores
      for (const store of module.exports.stores) {
        if (!usageInfo.exportsUsed.has(store)) {
          // This export is never used
          const pattern = this.createExportRemovalPattern(store, 'stores', module, sourceFile);
          if (pattern) {
            const beforeLength = optimizedCode.length;
            optimizedCode = optimizedCode.replace(pattern, '');
            const afterLength = optimizedCode.length;

            if (beforeLength !== afterLength) {
              changes.push({
                type: 'tree-shake',
                description: `Removed unused export store '${store}' from module '${module.id}'`,
                sizeImpact: beforeLength - afterLength,
              });
            }
          }
        }
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove unused providers
   */
  private removeUnusedProviders(
    code: string,
    sourceFile: ts.SourceFile
  ): { code: string; changes: OptimizationChange[] } {
    if (!this.moduleAnalysis) {
      return { code, changes: [] };
    }

    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    for (const module of this.moduleAnalysis.modules) {
      const usageInfo = this.usageInfo.get(module.id);
      if (!usageInfo) continue;

      for (const provider of module.providers) {
        // Skip exported providers unless in aggressive mode
        if (provider.exported && !this.options.aggressive) {
          continue;
        }

        // Check if provider is used
        if (!usageInfo.providersUsed.has(provider.name)) {
          // Remove unused provider
          const pattern = this.createProviderRemovalPattern(provider, module, sourceFile);
          if (pattern) {
            const beforeLength = optimizedCode.length;
            optimizedCode = optimizedCode.replace(pattern, '');
            const afterLength = optimizedCode.length;

            if (beforeLength !== afterLength) {
              changes.push({
                type: 'tree-shake',
                description: `Removed unused provider '${provider.name}' from module '${module.id}'`,
                sizeImpact: beforeLength - afterLength,
                location: provider.location?.line !== undefined && provider.location?.column !== undefined
                  ? { line: provider.location.line, column: provider.location.column }
                  : undefined,
              });
            }
          }
        }
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove unused stores
   */
  private removeUnusedStores(
    code: string,
    sourceFile: ts.SourceFile
  ): { code: string; changes: OptimizationChange[] } {
    if (!this.moduleAnalysis) {
      return { code, changes: [] };
    }

    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    for (const module of this.moduleAnalysis.modules) {
      const usageInfo = this.usageInfo.get(module.id);
      if (!usageInfo) continue;

      for (const store of module.stores) {
        // Skip exported stores unless in aggressive mode
        if (store.exported && !this.options.aggressive) {
          continue;
        }

        // Check if store is used
        if (!usageInfo.storesUsed.has(store.id)) {
          // Remove unused store
          const pattern = this.createStoreRemovalPattern(store, module, sourceFile);
          if (pattern) {
            const beforeLength = optimizedCode.length;
            optimizedCode = optimizedCode.replace(pattern, '');
            const afterLength = optimizedCode.length;

            if (beforeLength !== afterLength) {
              changes.push({
                type: 'tree-shake',
                description: `Removed unused store '${store.id}' from module '${module.id}'`,
                sizeImpact: beforeLength - afterLength,
                location: store.location?.line !== undefined && store.location?.column !== undefined
                  ? { line: store.location.line, column: store.location.column }
                  : undefined,
              });
            }
          }
        }
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Create regex pattern for module removal
   */
  private createModuleRemovalPattern(module: ModuleMetadata, sourceFile: ts.SourceFile): RegExp | null {
    // Create pattern to match: export const ModuleName = defineModule({ ... });
    // This is a simplified pattern - may need refinement for edge cases
    return new RegExp(
      `export\\s+const\\s+\\w+\\s*=\\s*defineModule\\s*\\(\\s*\\{[^}]*id\\s*:\\s*['"\`]${module.id}['"\`][^}]*\\}\\s*\\)\\s*;?`,
      'gs'
    );
  }

  /**
   * Create regex pattern for export removal
   */
  private createExportRemovalPattern(
    exportName: string,
    exportType: 'providers' | 'stores',
    module: ModuleMetadata,
    sourceFile: ts.SourceFile
  ): RegExp | null {
    // Pattern to match the export entry within the exports object
    // This is simplified and may need refinement
    return new RegExp(`${exportName}\\s*,?\\s*`, 'g');
  }

  /**
   * Create regex pattern for provider removal
   */
  private createProviderRemovalPattern(
    provider: { name: string },
    module: ModuleMetadata,
    sourceFile: ts.SourceFile
  ): RegExp | null {
    // Pattern to match provider in providers array
    // Handle both class providers and object providers
    return new RegExp(
      `(?:${provider.name}\\s*,?|\\{[^}]*provide\\s*:\\s*${provider.name}[^}]*\\}\\s*,?)`,
      'g'
    );
  }

  /**
   * Create regex pattern for store removal
   */
  private createStoreRemovalPattern(
    store: { id: string },
    module: ModuleMetadata,
    sourceFile: ts.SourceFile
  ): RegExp | null {
    // Pattern to match store factory in stores array
    // Store is usually an arrow function
    return new RegExp(`\\(\\)\\s*=>\\s*define\\w*Store\\s*\\([^)]*\\)\\s*,?`, 'g');
  }
}

/**
 * Create module tree shaker pass
 */
export function createModuleTreeShaker(options: Required<OptimizerOptions>): ModuleTreeShakerPass {
  return new ModuleTreeShakerPass(options);
}
