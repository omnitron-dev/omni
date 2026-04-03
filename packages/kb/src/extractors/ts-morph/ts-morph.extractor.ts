import { Project, type SourceFile, SyntaxKind } from 'ts-morph';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { SymbolExtractor } from './symbol.extractor.js';
import { DecoratorExtractor } from './decorator.extractor.js';
import { DependencyExtractor } from './dependency.extractor.js';
import type {
  IKbConfig,
  IExtractedData,
  ISymbolDoc,
  IDependency,
  IDecoratorUsageMap,
  IManifest,
  IPackageOverview,
} from '../../core/types.js';

export interface TsMorphExtractorOptions {
  /** Absolute path to package root */
  packageRoot: string;
  /** KB configuration */
  config: IKbConfig;
  /** Package name from package.json */
  packageName: string;
  /** Package version */
  packageVersion: string;
  /** tsconfig.json path (defaults to packageRoot/tsconfig.json) */
  tsConfigPath?: string;
}

/**
 * Main ts-morph-based extractor. Parses TypeScript source, resolves types,
 * and produces structured API surface data for the knowledge base.
 */
export class TsMorphExtractor {
  private readonly symbolExtractor = new SymbolExtractor();
  private readonly decoratorExtractor = new DecoratorExtractor();
  private readonly dependencyExtractor = new DependencyExtractor();

  /**
   * Extract all knowledge from a package's TypeScript sources.
   * Returns structured data ready for SurrealDB ingestion or JSON serialization.
   */
  async extract(options: TsMorphExtractorOptions): Promise<IExtractedData> {
    const {
      packageRoot,
      config,
      packageName,
      packageVersion,
      tsConfigPath,
    } = options;

    const tsConfig = tsConfigPath ?? resolve(packageRoot, 'tsconfig.json');

    // Create ts-morph project
    const project = new Project({
      tsConfigFilePath: tsConfig,
      skipAddingFilesFromTsConfig: false,
    });

    const sourceFiles = project.getSourceFiles()
      .filter(sf => !sf.getFilePath().includes('node_modules'))
      .filter(sf => !sf.getFilePath().includes('.spec.'))
      .filter(sf => !sf.getFilePath().includes('.test.'));

    // Extract symbols
    const symbols: ISymbolDoc[] = [];
    const decoratorUsages: IDecoratorUsageMap = {};
    const dependencies: IDependency[] = [];

    for (const sourceFile of sourceFiles) {
      const relPath = this.getRelativePath(sourceFile.getFilePath(), packageRoot);

      // Extract symbols (classes, interfaces, types, functions, enums, consts)
      const fileSymbols = this.symbolExtractor.extractFromFile(
        sourceFile,
        config.module,
        relPath,
        config.extract.decorators,
      );
      symbols.push(...fileSymbols);

      // Extract decorator usages
      const fileDecorators = this.decoratorExtractor.extractFromFile(
        sourceFile,
        relPath,
        config.extract.decorators,
      );
      for (const [name, usages] of Object.entries(fileDecorators)) {
        if (!decoratorUsages[name]) decoratorUsages[name] = [];
        decoratorUsages[name]!.push(...usages);
      }

      // Extract import dependencies
      const fileDeps = this.dependencyExtractor.extractFromFile(
        sourceFile,
        config.module,
      );
      dependencies.push(...fileDeps);
    }

    // Build manifest
    const manifest = await this.buildManifest(sourceFiles, packageRoot, packageVersion);

    // Build package overview for repo map
    const repoMap = this.buildPackageOverview(
      packageName,
      config,
      symbols,
      dependencies,
    );

    return {
      symbols,
      decorators: decoratorUsages,
      dependencies,
      repoMap,
      manifest,
    };
  }

  /**
   * Build file hash manifest for incremental extraction.
   */
  private async buildManifest(
    sourceFiles: SourceFile[],
    packageRoot: string,
    packageVersion: string,
  ): Promise<IManifest> {
    const files: Record<string, string> = {};
    const hashParts: string[] = [];

    for (const sf of sourceFiles) {
      const filePath = this.getRelativePath(sf.getFilePath(), packageRoot);
      const content = sf.getFullText();
      const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
      files[filePath] = hash;
      hashParts.push(hash);
    }

    const overallHash = createHash('sha256')
      .update(hashParts.sort().join(''))
      .digest('hex')
      .slice(0, 32);

    return {
      files,
      hash: overallHash,
      extractedAt: new Date().toISOString(),
      packageVersion,
    };
  }

  /**
   * Build a condensed package overview for the repo map.
   */
  private buildPackageOverview(
    packageName: string,
    config: IKbConfig,
    symbols: ISymbolDoc[],
    dependencies: IDependency[],
  ): IPackageOverview {
    // Rank symbols by importance: exported classes > interfaces > types > functions
    const ranked = [...symbols]
      .filter(s => s.exportPath)
      .sort((a, b) => {
        const kindOrder: Record<string, number> = {
          class: 0,
          interface: 1,
          enum: 2,
          type: 3,
          function: 4,
          const: 5,
          decorator: 6,
        };
        return (kindOrder[a.kind] ?? 99) - (kindOrder[b.kind] ?? 99);
      });

    const keySymbols = ranked.slice(0, 20).map(s => s.name);
    const exportPaths = [...new Set(symbols.map(s => s.exportPath).filter(Boolean))] as string[];
    const depModules = [...new Set(dependencies.filter(d => d.kind === 'import').map(d => d.to))];

    return {
      name: packageName,
      description: config.name,
      keySymbols,
      exports: exportPaths,
      dependencies: depModules,
    };
  }

  private getRelativePath(absolutePath: string, root: string): string {
    return absolutePath.startsWith(root)
      ? absolutePath.slice(root.length + 1)
      : absolutePath;
  }
}
