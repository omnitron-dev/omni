/**
 * Module Analyzer
 *
 * Analyzes AST to detect defineModule() calls and extract module metadata
 * for optimization purposes
 */

import * as ts from 'typescript';
import { findNodes, getNodeLocation } from '../parser.js';
import type { SourceLocation } from '../types.js';

/**
 * Module metadata extracted from analysis
 */
export interface ModuleMetadata {
  /** Module ID */
  id: string;

  /** Module location in source */
  location: SourceLocation;

  /** Imported modules */
  imports: ModuleImport[];

  /** Service providers */
  providers: ProviderMetadata[];

  /** Store factories */
  stores: StoreMetadata[];

  /** Route definitions */
  routes: RouteMetadata[];

  /** Islands */
  islands: IslandMetadata[];

  /** Exports definition */
  exports: ExportMetadata | null;

  /** Optimization hints */
  optimization: OptimizationMetadata | null;

  /** Whether module has side effects */
  hasSideEffects: boolean;

  /** Estimated module size */
  estimatedSize: number;
}

/**
 * Module import metadata
 */
export interface ModuleImport {
  /** Import source */
  source: string;

  /** Whether import is dynamic */
  isDynamic: boolean;

  /** Import location */
  location: SourceLocation;
}

/**
 * Provider metadata
 */
export interface ProviderMetadata {
  /** Provider name/token */
  name: string;

  /** Provider type */
  type: 'class' | 'value' | 'factory' | 'existing';

  /** Whether provider is exported */
  exported: boolean;

  /** Location in source */
  location: SourceLocation;
}

/**
 * Store metadata
 */
export interface StoreMetadata {
  /** Store ID */
  id: string;

  /** Whether store is exported */
  exported: boolean;

  /** Store location */
  location: SourceLocation;
}

/**
 * Route metadata
 */
export interface RouteMetadata {
  /** Route path */
  path: string;

  /** Whether route has lazy component */
  isLazy: boolean;

  /** Route location */
  location: SourceLocation;
}

/**
 * Island metadata
 */
export interface IslandMetadata {
  /** Island ID */
  id: string;

  /** Hydration strategy */
  strategy: string;

  /** Island location */
  location: SourceLocation;
}

/**
 * Export metadata
 */
export interface ExportMetadata {
  /** Exported providers */
  providers: string[];

  /** Exported stores */
  stores: string[];

  /** Whether entire module is exported */
  isModuleExport: boolean;

  /** Location */
  location: SourceLocation;
}

/**
 * Optimization metadata
 */
export interface OptimizationMetadata {
  /** Modules to preload */
  preloadModules: string[];

  /** Modules to prefetch */
  prefetchModules: string[];

  /** Is lazy boundary */
  lazyBoundary: boolean;

  /** Force separate chunk */
  splitChunk: boolean;

  /** Inline into parent */
  inline: boolean;

  /** Has side effects */
  sideEffects: boolean;

  /** Pure module */
  pure: boolean;

  /** Priority */
  priority: 'high' | 'normal' | 'low';
}

/**
 * Module analyzer result
 */
export interface ModuleAnalysisResult {
  /** Detected modules */
  modules: ModuleMetadata[];

  /** Module dependency graph data */
  dependencies: Map<string, string[]>;

  /** Module usage map */
  usages: Map<string, string[]>;

  /** Optimization opportunities */
  opportunities: ModuleOptimizationOpportunity[];
}

/**
 * Module optimization opportunity
 */
export interface ModuleOptimizationOpportunity {
  /** Opportunity type */
  type: 'tree-shake' | 'inline' | 'split' | 'merge' | 'preload';

  /** Target module ID */
  moduleId: string;

  /** Description */
  description: string;

  /** Estimated impact */
  impact: 'low' | 'medium' | 'high';

  /** Location */
  location?: SourceLocation;
}

/**
 * Module Analyzer
 *
 * Analyzes source files to detect defineModule() calls and extract metadata
 */
export class ModuleAnalyzer {
  private sourceFile: ts.SourceFile;
  private modules: ModuleMetadata[] = [];
  private dependencies = new Map<string, string[]>();
  private usages = new Map<string, string[]>();

  constructor(sourceFile: ts.SourceFile) {
    this.sourceFile = sourceFile;
  }

  /**
   * Analyze the source file for modules
   */
  analyze(): ModuleAnalysisResult {
    this.modules = [];
    this.dependencies.clear();
    this.usages.clear();

    // Find all defineModule() calls
    const moduleCalls = findNodes<ts.CallExpression>(this.sourceFile, (node) => this.isDefineModuleCall(node));

    for (const call of moduleCalls) {
      const metadata = this.extractModuleMetadata(call);
      if (metadata) {
        this.modules.push(metadata);
        this.updateDependencyGraph(metadata);
      }
    }

    // Identify optimization opportunities
    const opportunities = this.identifyOptimizationOpportunities();

    return {
      modules: this.modules,
      dependencies: this.dependencies,
      usages: this.usages,
      opportunities,
    };
  }

  /**
   * Check if node is defineModule() call
   */
  private isDefineModuleCall(node: ts.Node): node is ts.CallExpression {
    if (!ts.isCallExpression(node)) {
      return false;
    }

    const expression = node.expression;
    return ts.isIdentifier(expression) && expression.text === 'defineModule';
  }

  /**
   * Extract module metadata from defineModule() call
   */
  private extractModuleMetadata(call: ts.CallExpression): ModuleMetadata | null {
    if (call.arguments.length === 0) {
      return null;
    }

    const arg = call.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) {
      return null;
    }

    const location = getNodeLocation(call, this.sourceFile);

    // Extract module ID
    const id = this.extractModuleId(arg);
    if (!id) {
      return null;
    }

    // Extract each property
    const imports = this.extractImports(arg);
    const providers = this.extractProviders(arg);
    const stores = this.extractStores(arg);
    const routes = this.extractRoutes(arg);
    const islands = this.extractIslands(arg);
    const exports = this.extractExports(arg);
    const optimization = this.extractOptimization(arg);

    // Determine if module has side effects
    const hasSideEffects = this.checkSideEffects(arg);

    // Estimate module size
    const estimatedSize = this.estimateModuleSize({
      providers: providers.length,
      stores: stores.length,
      routes: routes.length,
      islands: islands.length,
    });

    return {
      id,
      location,
      imports,
      providers,
      stores,
      routes,
      islands,
      exports,
      optimization,
      hasSideEffects,
      estimatedSize,
    };
  }

  /**
   * Extract module ID from module definition
   */
  private extractModuleId(obj: ts.ObjectLiteralExpression): string | null {
    const idProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'id'
    );

    if (idProp && ts.isPropertyAssignment(idProp) && ts.isStringLiteral(idProp.initializer)) {
      return idProp.initializer.text;
    }

    return null;
  }

  /**
   * Extract imports from module definition
   */
  private extractImports(obj: ts.ObjectLiteralExpression): ModuleImport[] {
    const imports: ModuleImport[] = [];

    const importsProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'imports'
    );

    if (!importsProp || !ts.isPropertyAssignment(importsProp)) {
      return imports;
    }

    const initializer = importsProp.initializer;
    if (!ts.isArrayLiteralExpression(initializer)) {
      return imports;
    }

    for (const element of initializer.elements) {
      // Static import (identifier)
      if (ts.isIdentifier(element)) {
        imports.push({
          source: element.text,
          isDynamic: false,
          location: getNodeLocation(element, this.sourceFile),
        });
      }
      // Dynamic import (arrow function with import())
      else if (ts.isArrowFunction(element) || ts.isFunctionExpression(element)) {
        imports.push({
          source: 'dynamic',
          isDynamic: true,
          location: getNodeLocation(element, this.sourceFile),
        });
      }
      // Call expression (e.g., lazy(() => import('./Module')))
      else if (ts.isCallExpression(element)) {
        imports.push({
          source: 'lazy',
          isDynamic: true,
          location: getNodeLocation(element, this.sourceFile),
        });
      }
    }

    return imports;
  }

  /**
   * Extract providers from module definition
   */
  private extractProviders(obj: ts.ObjectLiteralExpression): ProviderMetadata[] {
    const providers: ProviderMetadata[] = [];

    const providersProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'providers'
    );

    if (!providersProp || !ts.isPropertyAssignment(providersProp)) {
      return providers;
    }

    const initializer = providersProp.initializer;
    if (!ts.isArrayLiteralExpression(initializer)) {
      return providers;
    }

    for (const element of initializer.elements) {
      const location = getNodeLocation(element, this.sourceFile);

      // Class provider
      if (ts.isIdentifier(element)) {
        providers.push({
          name: element.text,
          type: 'class',
          exported: false,
          location,
        });
      }
      // Provider object
      else if (ts.isObjectLiteralExpression(element)) {
        const provider = this.parseProviderObject(element, location);
        if (provider) {
          providers.push(provider);
        }
      }
    }

    return providers;
  }

  /**
   * Parse provider object
   */
  private parseProviderObject(obj: ts.ObjectLiteralExpression, location: SourceLocation): ProviderMetadata | null {
    const provideProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'provide'
    );

    if (!provideProp || !ts.isPropertyAssignment(provideProp)) {
      return null;
    }

    const provide = provideProp.initializer;
    let name = 'unknown';

    if (ts.isIdentifier(provide)) {
      name = provide.text;
    } else if (ts.isStringLiteral(provide)) {
      name = provide.text;
    }

    // Determine provider type
    let type: ProviderMetadata['type'] = 'value';
    if (obj.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'useClass')) {
      type = 'class';
    } else if (obj.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'useFactory')) {
      type = 'factory';
    } else if (obj.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'useExisting')) {
      type = 'existing';
    }

    return {
      name,
      type,
      exported: false,
      location,
    };
  }

  /**
   * Extract stores from module definition
   */
  private extractStores(obj: ts.ObjectLiteralExpression): StoreMetadata[] {
    const stores: StoreMetadata[] = [];

    const storesProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'stores'
    );

    if (!storesProp || !ts.isPropertyAssignment(storesProp)) {
      return stores;
    }

    const initializer = storesProp.initializer;
    if (!ts.isArrayLiteralExpression(initializer)) {
      return stores;
    }

    for (const element of initializer.elements) {
      // Store factory is usually an arrow function
      if (ts.isArrowFunction(element) || ts.isFunctionExpression(element)) {
        stores.push({
          id: `store_${stores.length}`,
          exported: false,
          location: getNodeLocation(element, this.sourceFile),
        });
      }
    }

    return stores;
  }

  /**
   * Extract routes from module definition
   */
  private extractRoutes(obj: ts.ObjectLiteralExpression): RouteMetadata[] {
    const routes: RouteMetadata[] = [];

    const routesProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'routes'
    );

    if (!routesProp || !ts.isPropertyAssignment(routesProp)) {
      return routes;
    }

    const initializer = routesProp.initializer;
    if (!ts.isArrayLiteralExpression(initializer)) {
      return routes;
    }

    for (const element of initializer.elements) {
      if (ts.isObjectLiteralExpression(element)) {
        const route = this.parseRouteObject(element);
        if (route) {
          routes.push(route);
        }
      }
    }

    return routes;
  }

  /**
   * Parse route object
   */
  private parseRouteObject(obj: ts.ObjectLiteralExpression): RouteMetadata | null {
    const pathProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'path'
    );

    if (!pathProp || !ts.isPropertyAssignment(pathProp) || !ts.isStringLiteral(pathProp.initializer)) {
      return null;
    }

    const path = pathProp.initializer.text;

    // Check if component is lazy-loaded
    const componentProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'component'
    );

    const isLazy = componentProp && ts.isPropertyAssignment(componentProp) && (ts.isArrowFunction(componentProp.initializer) || ts.isFunctionExpression(componentProp.initializer));

    return {
      path,
      isLazy: !!isLazy,
      location: getNodeLocation(obj, this.sourceFile),
    };
  }

  /**
   * Extract islands from module definition
   */
  private extractIslands(obj: ts.ObjectLiteralExpression): IslandMetadata[] {
    const islands: IslandMetadata[] = [];

    const islandsProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'islands'
    );

    if (!islandsProp || !ts.isPropertyAssignment(islandsProp)) {
      return islands;
    }

    const initializer = islandsProp.initializer;
    if (!ts.isArrayLiteralExpression(initializer)) {
      return islands;
    }

    for (const element of initializer.elements) {
      if (ts.isObjectLiteralExpression(element)) {
        const island = this.parseIslandObject(element);
        if (island) {
          islands.push(island);
        }
      }
    }

    return islands;
  }

  /**
   * Parse island object
   */
  private parseIslandObject(obj: ts.ObjectLiteralExpression): IslandMetadata | null {
    const idProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'id'
    );

    if (!idProp || !ts.isPropertyAssignment(idProp) || !ts.isStringLiteral(idProp.initializer)) {
      return null;
    }

    const id = idProp.initializer.text;

    const strategyProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'strategy'
    );

    let strategy = 'idle';
    if (strategyProp && ts.isPropertyAssignment(strategyProp) && ts.isStringLiteral(strategyProp.initializer)) {
      strategy = strategyProp.initializer.text;
    }

    return {
      id,
      strategy,
      location: getNodeLocation(obj, this.sourceFile),
    };
  }

  /**
   * Extract exports from module definition
   */
  private extractExports(obj: ts.ObjectLiteralExpression): ExportMetadata | null {
    const exportsProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'exports'
    );

    if (!exportsProp || !ts.isPropertyAssignment(exportsProp)) {
      return null;
    }

    const initializer = exportsProp.initializer;
    if (!ts.isObjectLiteralExpression(initializer)) {
      return null;
    }

    const providers: string[] = [];
    const stores: string[] = [];

    // Extract exported providers
    const providersProp = initializer.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'providers'
    );

    if (providersProp && ts.isPropertyAssignment(providersProp) && ts.isArrayLiteralExpression(providersProp.initializer)) {
      for (const element of providersProp.initializer.elements) {
        if (ts.isIdentifier(element)) {
          providers.push(element.text);
        }
      }
    }

    // Extract exported stores
    const storesProp = initializer.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'stores'
    );

    if (storesProp && ts.isPropertyAssignment(storesProp) && ts.isArrayLiteralExpression(storesProp.initializer)) {
      for (const element of storesProp.initializer.elements) {
        if (ts.isStringLiteral(element)) {
          stores.push(element.text);
        }
      }
    }

    return {
      providers,
      stores,
      isModuleExport: false,
      location: getNodeLocation(initializer, this.sourceFile),
    };
  }

  /**
   * Extract optimization hints from module definition
   */
  private extractOptimization(obj: ts.ObjectLiteralExpression): OptimizationMetadata | null {
    const optimizationProp = obj.properties.find(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'optimization'
    );

    if (!optimizationProp || !ts.isPropertyAssignment(optimizationProp)) {
      return null;
    }

    const initializer = optimizationProp.initializer;
    if (!ts.isObjectLiteralExpression(initializer)) {
      return null;
    }

    const extractStringArray = (propName: string): string[] => {
      const prop = initializer.properties.find(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === propName
      );

      if (prop && ts.isPropertyAssignment(prop) && ts.isArrayLiteralExpression(prop.initializer)) {
        return prop.initializer.elements
          .filter(ts.isStringLiteral)
          .map((e) => e.text);
      }

      return [];
    };

    const extractBoolean = (propName: string, defaultValue = false): boolean => {
      const prop = initializer.properties.find(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === propName
      );

      if (prop && ts.isPropertyAssignment(prop)) {
        if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
      }

      return defaultValue;
    };

    const extractPriority = (): 'high' | 'normal' | 'low' => {
      const prop = initializer.properties.find(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'priority'
      );

      if (prop && ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)) {
        const value = prop.initializer.text;
        if (value === 'high' || value === 'low') return value;
      }

      return 'normal';
    };

    return {
      preloadModules: extractStringArray('preloadModules'),
      prefetchModules: extractStringArray('prefetchModules'),
      lazyBoundary: extractBoolean('lazyBoundary'),
      splitChunk: extractBoolean('splitChunk'),
      inline: extractBoolean('inline'),
      sideEffects: extractBoolean('sideEffects', true),
      pure: extractBoolean('pure'),
      priority: extractPriority(),
    };
  }

  /**
   * Check if module has side effects
   */
  private checkSideEffects(obj: ts.ObjectLiteralExpression): boolean {
    // Check if setup/register/ready functions are present
    const lifecycleProps = ['setup', 'register', 'ready', 'teardown'];

    for (const propName of lifecycleProps) {
      const prop = obj.properties.find(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === propName
      );

      if (prop) {
        // Has lifecycle = likely has side effects
        return true;
      }
    }

    return false;
  }

  /**
   * Estimate module size
   */
  private estimateModuleSize(counts: { providers: number; stores: number; routes: number; islands: number }): number {
    let size = 5000; // Base size

    size += counts.providers * 1000;
    size += counts.stores * 2000;
    size += counts.routes * 3000;
    size += counts.islands * 2500;

    return size;
  }

  /**
   * Update dependency graph with module metadata
   */
  private updateDependencyGraph(metadata: ModuleMetadata): void {
    const deps: string[] = [];

    // Add imports as dependencies
    for (const imp of metadata.imports) {
      if (!imp.isDynamic && imp.source !== 'dynamic' && imp.source !== 'lazy') {
        deps.push(imp.source);
      }
    }

    this.dependencies.set(metadata.id, deps);

    // Update reverse dependencies (usages)
    for (const dep of deps) {
      if (!this.usages.has(dep)) {
        this.usages.set(dep, []);
      }
      this.usages.get(dep)!.push(metadata.id);
    }
  }

  /**
   * Identify optimization opportunities
   */
  private identifyOptimizationOpportunities(): ModuleOptimizationOpportunity[] {
    const opportunities: ModuleOptimizationOpportunity[] = [];

    // Build a map from module ID to variable name for import resolution
    const moduleIdToName = new Map<string, string>();
    this.sourceFile.forEachChild((node) => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer && ts.isCallExpression(decl.initializer)) {
            const call = decl.initializer;
            if (this.isDefineModuleCall(call)) {
              // Extract the module ID from this call
              const arg = call.arguments[0];
              if (call.arguments.length > 0 && arg && ts.isObjectLiteralExpression(arg)) {
                const id = this.extractModuleId(arg);
                if (id) {
                  moduleIdToName.set(id, decl.name.text);
                }
              }
            }
          }
        }
      }
    });

    for (const module of this.modules) {
      // Tree-shaking opportunity: Pure modules with no side effects
      if (module.optimization?.pure && !module.hasSideEffects) {
        opportunities.push({
          type: 'tree-shake',
          moduleId: module.id,
          description: `Module '${module.id}' is pure and can be tree-shaken if unused`,
          impact: 'high',
          location: module.location,
        });
      }

      // Inline opportunity: Small modules with inline hint
      if (module.optimization?.inline && module.estimatedSize < 10000) {
        opportunities.push({
          type: 'inline',
          moduleId: module.id,
          description: `Module '${module.id}' is small and can be inlined`,
          impact: 'medium',
          location: module.location,
        });
      }

      // Split opportunity: Large modules or lazy boundaries
      if (module.optimization?.lazyBoundary || module.estimatedSize > 50000) {
        opportunities.push({
          type: 'split',
          moduleId: module.id,
          description: `Module '${module.id}' should be split into separate chunk`,
          impact: 'high',
          location: module.location,
        });
      }

      // Preload opportunity: High priority modules
      if (module.optimization?.priority === 'high') {
        opportunities.push({
          type: 'preload',
          moduleId: module.id,
          description: `Module '${module.id}' should be preloaded`,
          impact: 'medium',
          location: module.location,
        });
      }

      // Merge opportunity: Small modules with single usage
      // Look up by variable name (e.g., 'SmallModule') instead of module ID
      const moduleName = moduleIdToName.get(module.id);
      const usages = moduleName ? (this.usages.get(moduleName) || []) : [];
      if (usages.length === 1 && module.estimatedSize < 10000 && !module.optimization?.splitChunk) {
        opportunities.push({
          type: 'merge',
          moduleId: module.id,
          description: `Module '${module.id}' is small with single usage and can be merged`,
          impact: 'low',
          location: module.location,
        });
      }
    }

    return opportunities;
  }
}

/**
 * Analyze source file for module metadata
 *
 * @param sourceFile - TypeScript source file
 * @returns Module analysis result
 */
export function analyzeModules(sourceFile: ts.SourceFile): ModuleAnalysisResult {
  const analyzer = new ModuleAnalyzer(sourceFile);
  return analyzer.analyze();
}
