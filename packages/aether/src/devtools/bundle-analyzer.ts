/**
 * Bundle Analyzer
 *
 * Provides bundle size analysis, duplicate dependency detection,
 * import cost analysis, tree-shaking effectiveness, and lazy loading
 * opportunity identification.
 *
 * @module devtools/bundle-analyzer
 */

/**
 * Bundle analyzer configuration
 */
export interface BundleAnalyzerConfig {
  /** Enable tree-shaking analysis */
  analyzeTreeShaking?: boolean;
  /** Enable duplicate detection */
  detectDuplicates?: boolean;
  /** Enable import cost analysis */
  analyzeImportCost?: boolean;
  /** Enable lazy loading analysis */
  analyzeLazyLoading?: boolean;
  /** Size threshold for warnings (bytes) */
  sizeThreshold?: number;
}

/**
 * Module info
 */
export interface ModuleInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  gzipSize: number;
  imports: string[];
  importedBy: string[];
  isEntry: boolean;
  isExternal: boolean;
  isLazyLoaded: boolean;
  treeShakenExports?: string[];
  unusedExports?: string[];
}

/**
 * Bundle tree node
 */
export interface BundleTreeNode {
  name: string;
  path: string;
  size: number;
  gzipSize: number;
  percentage: number;
  children: BundleTreeNode[];
  depth: number;
}

/**
 * Duplicate dependency
 */
export interface DuplicateDependency {
  name: string;
  versions: Array<{
    version: string;
    locations: string[];
    size: number;
  }>;
  totalWastedSize: number;
  recommendation: string;
}

/**
 * Import cost
 */
export interface ImportCost {
  moduleName: string;
  importedBy: string;
  size: number;
  gzipSize: number;
  isLarge: boolean;
  alternatives?: string[];
}

/**
 * Tree-shaking effectiveness
 */
export interface TreeShakingEffectiveness {
  moduleName: string;
  totalExports: number;
  usedExports: number;
  unusedExports: string[];
  effectiveness: number; // 0-100%
  wastedSize: number;
}

/**
 * Lazy loading opportunity
 */
export interface LazyLoadingOpportunity {
  componentName: string;
  path: string;
  size: number;
  currentUsage: 'eager' | 'lazy';
  recommendation: 'should-lazy-load' | 'keep-eager';
  reason: string;
  potentialSavings: number;
}

/**
 * Code coverage info
 */
export interface CodeCoverageInfo {
  file: string;
  totalLines: number;
  coveredLines: number;
  uncoveredLines: number[];
  coverage: number; // 0-100%
  isDeadCode: boolean;
}

/**
 * Bundle analysis result
 */
export interface BundleAnalysis {
  totalSize: number;
  totalGzipSize: number;
  modules: ModuleInfo[];
  duplicates: DuplicateDependency[];
  largeDependencies: ImportCost[];
  treeShakingEffectiveness: TreeShakingEffectiveness[];
  lazyLoadingOpportunities: LazyLoadingOpportunity[];
  recommendations: string[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<BundleAnalyzerConfig> = {
  analyzeTreeShaking: true,
  detectDuplicates: true,
  analyzeImportCost: true,
  analyzeLazyLoading: true,
  sizeThreshold: 100 * 1024, // 100KB
};

/**
 * Bundle analyzer implementation
 */
export class BundleAnalyzer {
  private config: Required<BundleAnalyzerConfig>;
  private modules = new Map<string, ModuleInfo>();
  private moduleGraph = new Map<string, Set<string>>();

  constructor(config: Partial<BundleAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register module
   */
  registerModule(module: ModuleInfo): void {
    this.modules.set(module.id, module);

    // Build module graph
    for (const importPath of module.imports) {
      if (!this.moduleGraph.has(module.id)) {
        this.moduleGraph.set(module.id, new Set());
      }
      this.moduleGraph.get(module.id)!.add(importPath);
    }
  }

  /**
   * Analyze bundle
   */
  analyze(): BundleAnalysis {
    const totalSize = this.calculateTotalSize();
    const totalGzipSize = this.calculateTotalGzipSize();
    const modules = Array.from(this.modules.values());

    const analysis: BundleAnalysis = {
      totalSize,
      totalGzipSize,
      modules,
      duplicates: this.config.detectDuplicates ? this.detectDuplicates() : [],
      largeDependencies: this.config.analyzeImportCost ? this.analyzeLargeDependencies() : [],
      treeShakingEffectiveness: this.config.analyzeTreeShaking
        ? this.analyzeTreeShaking()
        : [],
      lazyLoadingOpportunities: this.config.analyzeLazyLoading
        ? this.analyzeLazyLoading()
        : [],
      recommendations: [],
    };

    analysis.recommendations = this.generateRecommendations(analysis);

    return analysis;
  }

  /**
   * Calculate total size
   */
  private calculateTotalSize(): number {
    let total = 0;
    for (const module of this.modules.values()) {
      if (!module.isExternal) {
        total += module.size;
      }
    }
    return total;
  }

  /**
   * Calculate total gzip size
   */
  private calculateTotalGzipSize(): number {
    let total = 0;
    for (const module of this.modules.values()) {
      if (!module.isExternal) {
        total += module.gzipSize;
      }
    }
    return total;
  }

  /**
   * Generate bundle tree (treemap data)
   */
  generateBundleTree(): BundleTreeNode {
    const root: BundleTreeNode = {
      name: 'root',
      path: '/',
      size: this.calculateTotalSize(),
      gzipSize: this.calculateTotalGzipSize(),
      percentage: 100,
      children: [],
      depth: 0,
    };

    // Group modules by directory
    const tree = new Map<string, BundleTreeNode>();

    for (const module of this.modules.values()) {
      if (module.isExternal) continue;

      const parts = module.path.split('/');
      let currentPath = '';
      let parent = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue; // Skip empty parts
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        let node = tree.get(currentPath);
        if (!node) {
          node = {
            name: part,
            path: currentPath,
            size: 0,
            gzipSize: 0,
            percentage: 0,
            children: [],
            depth: i + 1,
          };
          tree.set(currentPath, node);
          parent.children.push(node);
        }

        parent = node;
      }

      // Add module size to all parent nodes
      let path = module.path;
      while (path) {
        const node = tree.get(path);
        if (node) {
          node.size += module.size;
          node.gzipSize += module.gzipSize;
        }
        path = path.substring(0, path.lastIndexOf('/'));
      }
    }

    // Calculate percentages
    this.calculatePercentages(root, root.size);

    return root;
  }

  /**
   * Calculate percentages recursively
   */
  private calculatePercentages(node: BundleTreeNode, totalSize: number): void {
    node.percentage = totalSize > 0 ? (node.size / totalSize) * 100 : 0;
    for (const child of node.children) {
      this.calculatePercentages(child, totalSize);
    }
  }

  /**
   * Detect duplicate dependencies
   */
  private detectDuplicates(): DuplicateDependency[] {
    const packageVersions = new Map<string, Map<string, string[]>>();

    // Group by package name and version
    for (const module of this.modules.values()) {
      const match = module.path.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
      if (match && match[1]) {
        const packageName = match[1];
        const rest = match[2];

        if (!rest) continue;

        // Try to extract version
        const versionMatch = rest.match(/^(\d+\.\d+\.\d+)/);
        const version = versionMatch?.[1] || 'unknown';

        if (!packageVersions.has(packageName)) {
          packageVersions.set(packageName, new Map());
        }

        const versions = packageVersions.get(packageName)!;
        if (!versions.has(version)) {
          versions.set(version, []);
        }
        versions.get(version)!.push(module.path);
      }
    }

    // Find duplicates
    const duplicates: DuplicateDependency[] = [];

    for (const [packageName, versions] of packageVersions.entries()) {
      if (versions.size > 1) {
        const versionArray = Array.from(versions.entries()).map(([version, locations]) => {
          const size = locations.reduce((sum, path) => {
            const module = Array.from(this.modules.values()).find(m => m.path === path);
            return sum + (module?.size || 0);
          }, 0);

          return { version, locations, size };
        });

        const totalWastedSize = versionArray.slice(1).reduce((sum, v) => sum + v.size, 0);

        duplicates.push({
          name: packageName,
          versions: versionArray,
          totalWastedSize,
          recommendation: `Use a single version of ${packageName}. Consider using resolutions or peerDependencies.`,
        });
      }
    }

    return duplicates.sort((a, b) => b.totalWastedSize - a.totalWastedSize);
  }

  /**
   * Analyze large dependencies
   */
  private analyzeLargeDependencies(): ImportCost[] {
    const costs: ImportCost[] = [];

    for (const module of this.modules.values()) {
      if (module.size > this.config.sizeThreshold) {
        const isLarge = module.size > this.config.sizeThreshold;
        const alternatives = this.findAlternatives(module);

        for (const importer of module.importedBy) {
          costs.push({
            moduleName: module.name,
            importedBy: importer,
            size: module.size,
            gzipSize: module.gzipSize,
            isLarge,
            alternatives,
          });
        }
      }
    }

    return costs.sort((a, b) => b.size - a.size);
  }

  /**
   * Find alternative libraries
   */
  private findAlternatives(module: ModuleInfo): string[] | undefined {
    // Common large libraries with alternatives
    const alternatives: Record<string, string[]> = {
      moment: ['date-fns', 'dayjs'],
      lodash: ['lodash-es', 'ramda'],
      'react-dom': ['preact'],
      axios: ['fetch API', 'ky'],
    };

    const packageName = module.name.split('/')[0];
    if (!packageName) return undefined;
    return alternatives[packageName];
  }

  /**
   * Analyze tree-shaking effectiveness
   */
  private analyzeTreeShaking(): TreeShakingEffectiveness[] {
    const effectiveness: TreeShakingEffectiveness[] = [];

    for (const module of this.modules.values()) {
      if (module.treeShakenExports && module.unusedExports) {
        const totalExports =
          module.treeShakenExports.length + module.unusedExports.length;
        const usedExports = module.treeShakenExports.length;

        const effectivenessPercent =
          totalExports > 0 ? (usedExports / totalExports) * 100 : 100;

        // Estimate wasted size based on unused exports
        const wastedSize = Math.floor(
          (module.size * module.unusedExports.length) / totalExports,
        );

        effectiveness.push({
          moduleName: module.name,
          totalExports,
          usedExports,
          unusedExports: module.unusedExports,
          effectiveness: effectivenessPercent,
          wastedSize,
        });
      }
    }

    return effectiveness
      .filter(e => e.effectiveness < 80) // Focus on poorly tree-shaken modules
      .sort((a, b) => b.wastedSize - a.wastedSize);
  }

  /**
   * Analyze lazy loading opportunities
   */
  private analyzeLazyLoading(): LazyLoadingOpportunity[] {
    const opportunities: LazyLoadingOpportunity[] = [];

    for (const module of this.modules.values()) {
      // Skip small modules
      if (module.size < this.config.sizeThreshold / 2) continue;

      // Skip already lazy-loaded modules
      if (module.isLazyLoaded) continue;

      // Identify components that could be lazy-loaded
      if (this.isComponent(module)) {
        const isUsedInCriticalPath = this.isInCriticalPath(module);

        if (!isUsedInCriticalPath) {
          opportunities.push({
            componentName: module.name,
            path: module.path,
            size: module.size,
            currentUsage: 'eager',
            recommendation: 'should-lazy-load',
            reason: 'Component is not in critical render path',
            potentialSavings: module.size,
          });
        }
      }
    }

    return opportunities.sort((a, b) => b.potentialSavings - a.potentialSavings);
  }

  /**
   * Check if module is a component
   */
  private isComponent(module: ModuleInfo): boolean {
    // Simple heuristic: check if name contains common component patterns
    const componentPatterns = [
      /Component$/,
      /Page$/,
      /Modal$/,
      /Dialog$/,
      /Drawer$/,
      /Panel$/,
    ];
    return componentPatterns.some(pattern => pattern.test(module.name));
  }

  /**
   * Check if module is in critical path
   */
  private isInCriticalPath(module: ModuleInfo): boolean {
    // Check if module is imported by entry point
    const entryModules = Array.from(this.modules.values()).filter(m => m.isEntry);

    for (const entry of entryModules) {
      if (this.hasDirectImport(entry.id, module.id)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if there's a direct import path
   */
  private hasDirectImport(fromId: string, toId: string): boolean {
    const visited = new Set<string>();
    const queue = [fromId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      if (current === toId) return true;

      const imports = this.moduleGraph.get(current);
      if (imports) {
        queue.push(...Array.from(imports));
      }
    }

    return false;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(analysis: BundleAnalysis): string[] {
    const recommendations: string[] = [];

    // Bundle size recommendations
    if (analysis.totalSize > 500 * 1024) {
      recommendations.push(
        `Bundle size is ${this.formatSize(analysis.totalSize)}. Consider code splitting.`,
      );
    }

    // Duplicate recommendations
    if (analysis.duplicates.length > 0) {
      recommendations.push(
        `Found ${analysis.duplicates.length} duplicate dependencies. Total wasted: ${this.formatSize(analysis.duplicates.reduce((sum, d) => sum + d.totalWastedSize, 0))}.`,
      );
    }

    // Large dependency recommendations
    const largeDeps = analysis.largeDependencies.filter(d => d.isLarge);
    if (largeDeps.length > 0) {
      recommendations.push(
        `Found ${largeDeps.length} large dependencies. Consider alternatives or lazy loading.`,
      );
    }

    // Tree-shaking recommendations
    const poorTreeShaking = analysis.treeShakingEffectiveness.filter(
      t => t.effectiveness < 50,
    );
    if (poorTreeShaking.length > 0) {
      recommendations.push(
        `Found ${poorTreeShaking.length} modules with poor tree-shaking. Use named imports instead of default imports.`,
      );
    }

    // Lazy loading recommendations
    if (analysis.lazyLoadingOpportunities.length > 0) {
      const potentialSavings = analysis.lazyLoadingOpportunities.reduce(
        (sum, o) => sum + o.potentialSavings,
        0,
      );
      recommendations.push(
        `Found ${analysis.lazyLoadingOpportunities.length} lazy loading opportunities. Potential savings: ${this.formatSize(potentialSavings)}.`,
      );
    }

    return recommendations;
  }

  /**
   * Format size in human-readable format
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * Export analysis report
   */
  exportReport(analysis: BundleAnalysis): string {
    const report = {
      summary: {
        totalSize: this.formatSize(analysis.totalSize),
        totalGzipSize: this.formatSize(analysis.totalGzipSize),
        moduleCount: analysis.modules.length,
      },
      duplicates: analysis.duplicates,
      largeDependencies: analysis.largeDependencies.slice(0, 10),
      treeShaking: analysis.treeShakingEffectiveness.slice(0, 10),
      lazyLoading: analysis.lazyLoadingOpportunities.slice(0, 10),
      recommendations: analysis.recommendations,
    };

    return JSON.stringify(report, null, 2);
  }

  /**
   * Clear analysis data
   */
  clear(): void {
    this.modules.clear();
    this.moduleGraph.clear();
  }
}

/**
 * Create bundle analyzer
 */
export function createBundleAnalyzer(config?: Partial<BundleAnalyzerConfig>): BundleAnalyzer {
  return new BundleAnalyzer(config);
}
