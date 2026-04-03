import type { SourceFile } from 'ts-morph';
import type { IDependency } from '../../core/types.js';

/**
 * Extracts dependency relationships from TypeScript source files.
 * Captures import-level and DI-level dependencies.
 */
export class DependencyExtractor {
  /**
   * Extract import dependencies from a source file.
   */
  extractFromFile(sourceFile: SourceFile, module: string): IDependency[] {
    const deps: IDependency[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();

      // Only track cross-package imports (not relative)
      if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) continue;

      // Normalize package name
      const packageName = this.normalizePackageName(moduleSpecifier);
      if (!packageName) continue;

      // Skip node built-ins
      if (moduleSpecifier.startsWith('node:')) continue;

      deps.push({
        from: module,
        to: packageName,
        kind: 'import',
      });
    }

    // Extract DI dependencies from constructor @Inject decorators
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() ?? 'Anonymous';
      const ctor = cls.getConstructors()[0];
      if (!ctor) continue;

      for (const param of ctor.getParameters()) {
        for (const dec of param.getDecorators()) {
          if (dec.getName() === 'Inject' || dec.getName() === 'Optional') {
            const args = dec.getArguments();
            if (args.length > 0) {
              deps.push({
                from: `${module}:${className}`,
                to: args[0]!.getText(),
                kind: 'di',
                token: args[0]!.getText(),
              });
            }
          }
        }
      }
    }

    // Extract class inheritance
    for (const cls of sourceFile.getClasses()) {
      if (!cls.isExported()) continue;
      const className = cls.getName() ?? 'Anonymous';

      const extendsExpr = cls.getExtends();
      if (extendsExpr) {
        deps.push({
          from: `${module}:${className}`,
          to: extendsExpr.getText(),
          kind: 'extends',
        });
      }

      for (const impl of cls.getImplements()) {
        deps.push({
          from: `${module}:${className}`,
          to: impl.getText(),
          kind: 'implements',
        });
      }
    }

    // Deduplicate
    return this.deduplicate(deps);
  }

  /**
   * Extract package name from module specifier.
   * '@omnitron-dev/titan/netron' → '@omnitron-dev/titan'
   * 'ioredis' → 'ioredis'
   */
  private normalizePackageName(specifier: string): string | null {
    if (specifier.startsWith('@')) {
      const parts = specifier.split('/');
      if (parts.length < 2) return null;
      return `${parts[0]}/${parts[1]}`;
    }
    return specifier.split('/')[0] ?? null;
  }

  private deduplicate(deps: IDependency[]): IDependency[] {
    const seen = new Set<string>();
    return deps.filter(d => {
      const key = `${d.from}→${d.to}:${d.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
