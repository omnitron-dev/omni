import {
  type SourceFile,
  type ClassDeclaration,
  type InterfaceDeclaration,
  type FunctionDeclaration,
  type TypeAliasDeclaration,
  type EnumDeclaration,
  type VariableStatement,
  type MethodDeclaration,
  type PropertyDeclaration,
  type ParameterDeclaration,
  SyntaxKind,
  Scope,
} from 'ts-morph';
import type { ISymbolDoc, IDecoratorDoc, IMemberDoc, SymbolKind } from '../../core/types.js';

/**
 * Extracts symbol documentation from TypeScript source files.
 * Captures classes, interfaces, types, enums, functions, and exported constants.
 */
export class SymbolExtractor {
  /**
   * Extract all exportable symbols from a source file.
   */
  extractFromFile(
    sourceFile: SourceFile,
    module: string,
    relPath: string,
    significantDecorators: string[],
  ): ISymbolDoc[] {
    const symbols: ISymbolDoc[] = [];

    // Classes
    for (const cls of sourceFile.getClasses()) {
      if (!cls.isExported()) continue;
      symbols.push(this.extractClass(cls, module, relPath, significantDecorators));
    }

    // Interfaces
    for (const iface of sourceFile.getInterfaces()) {
      if (!iface.isExported()) continue;
      symbols.push(this.extractInterface(iface, module, relPath));
    }

    // Type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      if (!typeAlias.isExported()) continue;
      symbols.push(this.extractTypeAlias(typeAlias, module, relPath));
    }

    // Enums
    for (const enumDecl of sourceFile.getEnums()) {
      if (!enumDecl.isExported()) continue;
      symbols.push(this.extractEnum(enumDecl, module, relPath));
    }

    // Functions
    for (const fn of sourceFile.getFunctions()) {
      if (!fn.isExported()) continue;
      symbols.push(this.extractFunction(fn, module, relPath));
    }

    // Exported constants (export const X = ...)
    for (const varStmt of sourceFile.getVariableStatements()) {
      if (!varStmt.isExported()) continue;
      for (const decl of varStmt.getDeclarations()) {
        symbols.push({
          name: decl.getName(),
          kind: 'const',
          module,
          filePath: relPath,
          line: decl.getStartLineNumber(),
          signature: `const ${decl.getName()}: ${this.getTypeText(decl)}`,
          jsdoc: this.getJsDoc(varStmt),
          decorators: [],
          members: [],
        });
      }
    }

    return symbols;
  }

  private extractClass(
    cls: ClassDeclaration,
    module: string,
    relPath: string,
    significantDecorators: string[],
  ): ISymbolDoc {
    const name = cls.getName() ?? 'Anonymous';
    const decorators = this.getDecorators(cls, significantDecorators);
    const members = this.getClassMembers(cls, significantDecorators);
    const extendsClause = cls.getExtends()?.getText();
    const implementsClauses = cls.getImplements().map(i => i.getText());

    // Build compressed signature
    const parts: string[] = [];
    if (decorators.length > 0) {
      parts.push(decorators.map(d => `@${d.name}`).join(' '));
    }
    parts.push(`class ${name}`);
    if (extendsClause) parts.push(`extends ${extendsClause}`);
    if (implementsClauses.length > 0) parts.push(`implements ${implementsClauses.join(', ')}`);

    return {
      name,
      kind: 'class',
      module,
      filePath: relPath,
      line: cls.getStartLineNumber(),
      signature: parts.join(' '),
      jsdoc: this.getJsDoc(cls),
      decorators,
      members,
      extends: extendsClause,
      implements: implementsClauses.length > 0 ? implementsClauses : undefined,
    };
  }

  private extractInterface(
    iface: InterfaceDeclaration,
    module: string,
    relPath: string,
  ): ISymbolDoc {
    const name = iface.getName();
    const extendsClause = iface.getExtends().map(e => e.getText());
    const members: IMemberDoc[] = [];

    // Methods
    for (const method of iface.getMethods()) {
      const params = method.getParameters().map(p => this.formatParam(p)).join(', ');
      const returnType = method.getReturnType().getText(method);
      members.push({
        name: method.getName(),
        kind: 'method',
        visibility: 'public',
        signature: `${method.getName()}(${params}): ${this.truncateType(returnType)}`,
        decorators: [],
        isStatic: false,
        isAsync: false,
        jsdoc: this.getJsDoc(method),
      });
    }

    // Properties
    for (const prop of iface.getProperties()) {
      members.push({
        name: prop.getName(),
        kind: 'property',
        visibility: 'public',
        signature: `${prop.getName()}: ${this.truncateType(prop.getType().getText(prop))}`,
        decorators: [],
        isStatic: false,
        isAsync: false,
        jsdoc: this.getJsDoc(prop),
      });
    }

    return {
      name,
      kind: 'interface',
      module,
      filePath: relPath,
      line: iface.getStartLineNumber(),
      signature: extendsClause.length > 0
        ? `interface ${name} extends ${extendsClause.join(', ')}`
        : `interface ${name}`,
      jsdoc: this.getJsDoc(iface),
      decorators: [],
      members,
      extends: extendsClause.length > 0 ? extendsClause.join(', ') : undefined,
    };
  }

  private extractTypeAlias(
    typeAlias: TypeAliasDeclaration,
    module: string,
    relPath: string,
  ): ISymbolDoc {
    const name = typeAlias.getName();
    const typeText = typeAlias.getType().getText(typeAlias);

    return {
      name,
      kind: 'type',
      module,
      filePath: relPath,
      line: typeAlias.getStartLineNumber(),
      signature: `type ${name} = ${this.truncateType(typeText)}`,
      jsdoc: this.getJsDoc(typeAlias),
      decorators: [],
      members: [],
    };
  }

  private extractEnum(
    enumDecl: EnumDeclaration,
    module: string,
    relPath: string,
  ): ISymbolDoc {
    const name = enumDecl.getName();
    const memberNames = enumDecl.getMembers().map(m => m.getName());

    return {
      name,
      kind: 'enum',
      module,
      filePath: relPath,
      line: enumDecl.getStartLineNumber(),
      signature: `enum ${name} { ${memberNames.join(', ')} }`,
      jsdoc: this.getJsDoc(enumDecl),
      decorators: [],
      members: memberNames.map(mn => ({
        name: mn,
        kind: 'property' as const,
        visibility: 'public' as const,
        signature: mn,
        decorators: [],
        isStatic: true,
        isAsync: false,
      })),
    };
  }

  private extractFunction(
    fn: FunctionDeclaration,
    module: string,
    relPath: string,
  ): ISymbolDoc {
    const name = fn.getName() ?? 'anonymous';
    const params = fn.getParameters().map(p => this.formatParam(p)).join(', ');
    const returnType = fn.getReturnType().getText(fn);
    const isAsync = fn.isAsync();

    return {
      name,
      kind: 'function',
      module,
      filePath: relPath,
      line: fn.getStartLineNumber(),
      signature: `${isAsync ? 'async ' : ''}function ${name}(${params}): ${this.truncateType(returnType)}`,
      jsdoc: this.getJsDoc(fn),
      decorators: [],
      members: [],
    };
  }

  // ---- Helpers --------------------------------------------------------------

  private getClassMembers(
    cls: ClassDeclaration,
    significantDecorators: string[],
  ): IMemberDoc[] {
    const members: IMemberDoc[] = [];

    // Methods (public + protected only)
    for (const method of cls.getMethods()) {
      const scope = method.getScope() ?? Scope.Public;
      if (scope === Scope.Private) continue;

      const params = method.getParameters().map(p => this.formatParam(p)).join(', ');
      const returnType = method.getReturnType().getText(method);

      members.push({
        name: method.getName(),
        kind: 'method',
        visibility: scope === Scope.Protected ? 'protected' : 'public',
        signature: `${method.getName()}(${params}): ${this.truncateType(returnType)}`,
        decorators: this.getDecorators(method, significantDecorators),
        isStatic: method.isStatic(),
        isAsync: method.isAsync(),
        jsdoc: this.getJsDoc(method),
      });
    }

    // Properties (public + protected only)
    for (const prop of cls.getProperties()) {
      const scope = prop.getScope() ?? Scope.Public;
      if (scope === Scope.Private) continue;

      members.push({
        name: prop.getName(),
        kind: 'property',
        visibility: scope === Scope.Protected ? 'protected' : 'public',
        signature: `${prop.getName()}: ${this.truncateType(prop.getType().getText(prop))}`,
        decorators: this.getDecorators(prop, significantDecorators),
        isStatic: prop.isStatic(),
        isAsync: false,
        jsdoc: this.getJsDoc(prop),
      });
    }

    return members;
  }

  private getDecorators(
    node: { getDecorators?: () => Array<{ getName(): string; getArguments(): Array<{ getText(): string }> }> },
    significantNames: string[],
  ): IDecoratorDoc[] {
    if (!node.getDecorators) return [];

    return node.getDecorators()
      .filter(d => significantNames.length === 0 || significantNames.includes(d.getName()))
      .map(d => ({
        name: d.getName(),
        args: this.parseDecoratorArgs(d.getArguments()),
      }));
  }

  private parseDecoratorArgs(args: Array<{ getText(): string }>): Record<string, unknown> {
    if (args.length === 0) return {};
    if (args.length === 1) {
      const text = args[0]!.getText();
      // Try to parse as object literal
      try {
        // Simple heuristic: if it starts with {, treat as object
        if (text.startsWith('{')) {
          return { value: text };
        }
        return { value: text };
      } catch {
        return { value: text };
      }
    }
    const result: Record<string, unknown> = {};
    args.forEach((arg, i) => {
      result[`arg${i}`] = arg.getText();
    });
    return result;
  }

  private formatParam(param: ParameterDeclaration): string {
    const name = param.getName();
    const type = this.truncateType(param.getType().getText(param));
    const optional = param.isOptional() ? '?' : '';
    return `${name}${optional}: ${type}`;
  }

  private getTypeText(node: { getType(): { getText(n?: unknown): string } }): string {
    try {
      return this.truncateType(node.getType().getText());
    } catch {
      return 'unknown';
    }
  }

  private getJsDoc(node: { getJsDocs?: () => Array<{ getDescription(): string }> }): string | undefined {
    if (!node.getJsDocs) return undefined;
    const docs = node.getJsDocs();
    if (docs.length === 0) return undefined;
    const desc = docs[0]!.getDescription().trim();
    return desc || undefined;
  }

  /**
   * Truncate long type strings to keep signatures concise.
   */
  private truncateType(typeText: string, maxLength: number = 120): string {
    // Remove import(...) wrappers
    const cleaned = typeText.replace(/import\([^)]+\)\./g, '');
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength - 3) + '...';
  }
}
