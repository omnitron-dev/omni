import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { defineLumenConfig } from './define.js';
import { expandEnvVariables } from './env.js';
import type { LumenConfig, LumenUserConfig } from './schema.js';

const CONFIG_FILENAMES = ['lumen.config.ts', 'lumen.config.mjs', 'lumen.config.js'];

function unwrapConfigExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  let progressing = true;
  while (progressing) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression;
    } else if (ts.isCallExpression(current) && current.arguments.length > 0 && current.arguments[0]) {
      current = current.arguments[0];
    } else {
      progressing = false;
    }
  }
  return current;
}

function evaluateStaticAstNode(node: ts.Expression, decls: Map<string, ts.Expression>, visiting: Set<string>): unknown {
  const expr = unwrapConfigExpression(node);

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isNumericLiteral(expr)) {
    return Number(expr.text);
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  if (expr.kind === ts.SyntaxKind.UndefinedKeyword) {
    return undefined;
  }
  if (ts.isPrefixUnaryExpression(expr)) {
    const inner = evaluateStaticAstNode(expr.operand, decls, visiting);
    if (expr.operator === ts.SyntaxKind.MinusToken && typeof inner === 'number') return -inner;
    if (expr.operator === ts.SyntaxKind.PlusToken && typeof inner === 'number') return inner;
    if (expr.operator === ts.SyntaxKind.ExclamationToken) return !inner;
  }
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    if (!visiting.has(name) && decls.has(name)) {
      const nextVisiting = new Set(visiting);
      nextVisiting.add(name);
      return evaluateStaticAstNode(decls.get(name)!, decls, nextVisiting);
    }
    return undefined;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const arr: unknown[] = [];
    for (const el of expr.elements) {
      if (ts.isSpreadElement(el)) {
        const spreadVal = evaluateStaticAstNode(el.expression, decls, visiting);
        if (Array.isArray(spreadVal)) arr.push(...spreadVal);
      } else {
        arr.push(evaluateStaticAstNode(el, decls, visiting));
      }
    }
    return arr;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const obj: Record<string, unknown> = {};
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        let key: string | undefined;
        if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)) {
          key = prop.name.text;
        }
        if (key && key !== '__proto__') {
          obj[key] = evaluateStaticAstNode(prop.initializer, decls, visiting);
        }
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        if (key !== '__proto__' && !visiting.has(key) && decls.has(key)) {
          const nextVisiting = new Set(visiting);
          nextVisiting.add(key);
          obj[key] = evaluateStaticAstNode(decls.get(key)!, decls, nextVisiting);
        }
      } else if (ts.isSpreadAssignment(prop)) {
        const spreadObj = evaluateStaticAstNode(prop.expression, decls, visiting);
        if (spreadObj && typeof spreadObj === 'object' && !Array.isArray(spreadObj)) {
          for (const [k, v] of Object.entries(spreadObj as Record<string, unknown>)) {
            if (k !== '__proto__') obj[k] = v;
          }
        }
      }
    }
    return obj;
  }

  return undefined;
}

function parseConfigFromTsAst(filePath: string): unknown {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const decls = new Map<string, ts.Expression>();
  let exportedExpr: ts.Expression | undefined;

  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          decls.set(decl.name.text, decl.initializer);
          if (isExported && !exportedExpr) {
            exportedExpr = decl.initializer;
          }
        }
      }
    } else if (ts.isExportAssignment(stmt)) {
      exportedExpr = stmt.expression;
    } else if (
      ts.isExpressionStatement(stmt) &&
      ts.isBinaryExpression(stmt.expression) &&
      stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const leftText = stmt.expression.left.getText(sourceFile);
      if (leftText === 'module.exports' || leftText === 'exports.default') {
        exportedExpr = stmt.expression.right;
      }
    }
  }

  const target = exportedExpr ?? decls.get('config');
  if (!target) {
    return { title: 'Documentation' };
  }
  return evaluateStaticAstNode(target, decls, new Set()) ?? { title: 'Documentation' };
}

export async function resolveConfigFile(cwd: string = process.cwd()): Promise<string | null> {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = resolve(cwd, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function loadLumenConfig(cwdOrFilePath: string = process.cwd()): Promise<LumenConfig> {
  let configPath: string | null = null;
  if (
    existsSync(cwdOrFilePath) &&
    !cwdOrFilePath.endsWith('.ts') &&
    !cwdOrFilePath.endsWith('.mjs') &&
    !cwdOrFilePath.endsWith('.js')
  ) {
    configPath = await resolveConfigFile(cwdOrFilePath);
  } else if (existsSync(cwdOrFilePath)) {
    configPath = cwdOrFilePath;
  }

  if (!configPath) {
    return defineLumenConfig({ title: 'Documentation' });
  }

  let rawConfig: unknown;
  try {
    const fileUrl = pathToFileURL(configPath).href;
    const importedModule = await import(fileUrl);
    rawConfig = importedModule.default ?? importedModule.config ?? importedModule;
  } catch (err: any) {
    const code = err?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      rawConfig = parseConfigFromTsAst(configPath);
    } else {
      throw err;
    }
  }

  const expanded = expandEnvVariables(rawConfig) as LumenUserConfig;
  return defineLumenConfig(expanded);
}
