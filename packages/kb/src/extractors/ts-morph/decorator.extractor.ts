import type { SourceFile } from 'ts-morph';
import type { IDecoratorUsageMap } from '../../core/types.js';

interface DecoratorUsage {
  symbol: string;
  filePath: string;
  args: Record<string, unknown>;
}

/**
 * Extracts decorator usage information from TypeScript source files.
 * Maps which decorators are used where and with what arguments.
 */
export class DecoratorExtractor {
  /**
   * Extract decorator usages from a source file.
   * Returns a map of decorator name → usage locations.
   */
  extractFromFile(
    sourceFile: SourceFile,
    relPath: string,
    significantDecorators: string[],
  ): IDecoratorUsageMap {
    const usages: IDecoratorUsageMap = {};

    // Scan classes and their members
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() ?? 'Anonymous';

      // Class-level decorators
      for (const dec of cls.getDecorators()) {
        const name = dec.getName();
        if (significantDecorators.length > 0 && !significantDecorators.includes(name)) continue;

        if (!usages[name]) usages[name] = [];
        usages[name]!.push({
          symbol: className,
          filePath: relPath,
          args: this.extractArgs(dec),
        });
      }

      // Method-level decorators
      for (const method of cls.getMethods()) {
        for (const dec of method.getDecorators()) {
          const name = dec.getName();
          if (significantDecorators.length > 0 && !significantDecorators.includes(name)) continue;

          if (!usages[name]) usages[name] = [];
          usages[name]!.push({
            symbol: `${className}.${method.getName()}`,
            filePath: relPath,
            args: this.extractArgs(dec),
          });
        }
      }

      // Property-level decorators (important for @Inject)
      for (const prop of cls.getProperties()) {
        for (const dec of prop.getDecorators()) {
          const name = dec.getName();
          if (significantDecorators.length > 0 && !significantDecorators.includes(name)) continue;

          if (!usages[name]) usages[name] = [];
          usages[name]!.push({
            symbol: `${className}.${prop.getName()}`,
            filePath: relPath,
            args: this.extractArgs(dec),
          });
        }
      }

      // Constructor parameter decorators
      const ctor = cls.getConstructors()[0];
      if (ctor) {
        for (const param of ctor.getParameters()) {
          for (const dec of param.getDecorators()) {
            const name = dec.getName();
            if (significantDecorators.length > 0 && !significantDecorators.includes(name)) continue;

            if (!usages[name]) usages[name] = [];
            usages[name]!.push({
              symbol: `${className}::constructor(${param.getName()})`,
              filePath: relPath,
              args: this.extractArgs(dec),
            });
          }
        }
      }
    }

    return usages;
  }

  private extractArgs(
    decorator: { getArguments(): Array<{ getText(): string }> },
  ): Record<string, unknown> {
    const args = decorator.getArguments();
    if (args.length === 0) return {};

    const result: Record<string, unknown> = {};
    args.forEach((arg, i) => {
      const text = arg.getText();
      result[i === 0 ? 'value' : `arg${i}`] = text;
    });
    return result;
  }
}
