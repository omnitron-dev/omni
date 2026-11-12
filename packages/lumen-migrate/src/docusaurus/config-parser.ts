import type { DocusaurusConfigInput } from '../types.js';

import { resolve } from 'node:path';

import ts from 'typescript';

import { extractKatexMacrosFromConfig } from '../katex/macro-extractor.js';
import {
  documentationText,
  pathExists,
  physicalDirectory,
  readDocumentationFile,
  type DocumentationFile,
} from '../utils/documentation-files.js';

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_AST_RECURSION_DEPTH = 64;
interface ExtractionBudget {
  remaining: number;
}

function setSafeProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  if (FORBIDDEN_OBJECT_KEYS.has(key) || value === undefined) {
    return;
  }
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  for (let i = 0; i < MAX_AST_RECURSION_DEPTH; i++) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isAsExpression(current)) {
      current = current.expression;
    } else if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    } else if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression;
    } else {
      break;
    }
  }
  return current;
}

function resolvePropertyKey(
  name: ts.PropertyName,
  bindings: Map<string, ts.Expression>,
  depth: number,
  budget: ExtractionBudget
): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const val = extractAstValue(name.expression, bindings, new Set(), depth + 1, budget);
    if (typeof val === 'string' || typeof val === 'number') {
      return String(val);
    }
  }
  return null;
}

function extractAstValue(
  rawExpr: ts.Expression,
  bindings: Map<string, ts.Expression>,
  seenIdentifiers: Set<string>,
  depth: number,
  budget: ExtractionBudget
): unknown {
  if (--budget.remaining < 0) throw Error('Configuration exceeds the static expression entry limit');
  if (depth > MAX_AST_RECURSION_DEPTH) {
    throw Error('Configuration exceeds the static expression depth limit');
  }

  const expr = unwrapExpression(rawExpr);

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }

  if (ts.isTemplateExpression(expr)) {
    let out = expr.head.text;
    for (const span of expr.templateSpans) {
      const spanVal = extractAstValue(span.expression, bindings, seenIdentifiers, depth + 1, budget);
      if (spanVal === undefined || spanVal === null || typeof spanVal === 'object') {
        throw Error('Unsupported template value in configuration');
      }
      out += String(spanVal) + span.literal.text;
    }
    return out;
  }

  if (ts.isNumericLiteral(expr)) {
    const value = Number(expr.text);
    if (!Number.isFinite(value)) throw Error('Non-finite configuration numbers are not supported');
    return value;
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

  if (ts.isPrefixUnaryExpression(expr)) {
    const operand = extractAstValue(expr.operand, bindings, seenIdentifiers, depth + 1, budget);
    switch (expr.operator) {
      case ts.SyntaxKind.MinusToken:
        if (typeof operand === 'number') return -operand;
        break;
      case ts.SyntaxKind.PlusToken:
        if (typeof operand === 'number') return +operand;
        break;
      case ts.SyntaxKind.ExclamationToken:
        return !operand;
      default:
        throw Error('Unsupported unary operator in configuration: ' + ts.SyntaxKind[expr.operator]);
    }
    throw Error('Unsupported unary expression in configuration');
  }

  if (ts.isIdentifier(expr)) {
    if (expr.text === 'undefined') {
      return undefined;
    }
    if (seenIdentifiers.has(expr.text)) {
      throw Error('Circular configuration binding: ' + expr.text);
    }
    const bound = bindings.get(expr.text);
    if (!bound) {
      throw Error('Configuration requires an unresolved binding: ' + expr.text);
    }
    const nextSeen = new Set(seenIdentifiers);
    nextSeen.add(expr.text);
    return extractAstValue(bound, bindings, nextSeen, depth + 1, budget);
  }

  if (ts.isCallExpression(expr)) {
    // Recognized declarative wrappers only; arbitrary calls are not identities.
    const callee = unwrapExpression(expr.expression);
    const wrapper = ts.isIdentifier(callee) && callee.text === 'defineConfig' && !bindings.has('defineConfig');
    const resolver =
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'require' &&
      callee.name.text === 'resolve' &&
      !bindings.has('require');
    if ((wrapper || resolver) && expr.arguments.length === 1 && expr.arguments[0]) {
      const firstArg = unwrapExpression(expr.arguments[0]);
      if (
        ts.isObjectLiteralExpression(firstArg) ||
        ts.isArrayLiteralExpression(firstArg) ||
        ts.isStringLiteral(firstArg) ||
        ts.isNoSubstitutionTemplateLiteral(firstArg) ||
        ts.isIdentifier(firstArg)
      ) {
        return extractAstValue(firstArg, bindings, seenIdentifiers, depth + 1, budget);
      }
    }
    throw Error('Unsupported computed configuration call');
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const items: unknown[] = [];
    for (const element of expr.elements) {
      if (ts.isOmittedExpression(element)) {
        throw Error('Sparse configuration arrays are not supported');
      }
      if (ts.isSpreadElement(element)) {
        const spreadVal = extractAstValue(element.expression, bindings, seenIdentifiers, depth + 1, budget);
        if (!Array.isArray(spreadVal)) throw Error('Expected an array in configuration spread');
        if (items.length + spreadVal.length > 10_000) throw Error('Configuration array exceeds the entry limit');
        items.push(...spreadVal);
        continue;
      }
      const extracted = extractAstValue(element, bindings, seenIdentifiers, depth + 1, budget);
      if (extracted !== undefined) {
        items.push(extracted);
      } else throw Error('Undefined configuration array entries are not supported');
    }
    return items;
  }

  if (ts.isObjectLiteralExpression(expr)) {
    const obj: Record<string, unknown> = {};
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = resolvePropertyKey(prop.name, bindings, depth + 1, budget);
        if (key === null) throw Error('Unsupported configuration property key');
        if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
        const val = extractAstValue(prop.initializer, bindings, seenIdentifiers, depth + 1, budget);
        setSafeProperty(obj, key, val);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
        setSafeProperty(obj, key, extractAstValue(prop.name, bindings, seenIdentifiers, depth + 1, budget));
      } else if (ts.isSpreadAssignment(prop)) {
        const spreadVal = extractAstValue(prop.expression, bindings, seenIdentifiers, depth + 1, budget);
        if (!spreadVal || typeof spreadVal !== 'object' || Array.isArray(spreadVal))
          throw Error('Expected an object in configuration spread');
        for (const [k, v] of Object.entries(spreadVal as Record<string, unknown>)) setSafeProperty(obj, k, v);
      } else throw Error('Configuration methods and accessors are not supported');
    }
    return obj;
  }

  throw Error('Unsupported static configuration expression: ' + ts.SyntaxKind[expr.kind]);
}

function isCommonJsExportLeft(left: ts.Expression): boolean {
  const unwrapped = unwrapExpression(left);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const target = unwrapExpression(unwrapped.expression);
    if (ts.isIdentifier(target) && target.text === 'module' && unwrapped.name.text === 'exports') {
      return true;
    }
    if (ts.isIdentifier(target) && target.text === 'exports' && unwrapped.name.text === 'default') {
      return true;
    }
  }
  return false;
}

function hasExportModifier(stmt: ts.VariableStatement): boolean {
  return Boolean(stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function parseModuleObjectLiteral(content: string, preferredNames: string[]): Record<string, unknown> {
  const sourceFile = ts.createSourceFile('module.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length)
    throw Error('Invalid configuration syntax: ' + ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, ' '));
  const budget = { remaining: 10_000 };
  const bindings = new Map<string, ts.Expression>();
  const namedExports = new Map<string, ts.Expression>();
  let primary: ts.Expression | undefined;
  const setPrimary = (expression: ts.Expression): void => {
    if (primary) throw Error('Ambiguous configuration exports');
    primary = expression;
  };
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      if (!(statement.declarationList.flags & ts.NodeFlags.Const))
        throw Error('Configuration bindings must be constant');
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
          throw Error('Unsupported configuration binding');
        if (bindings.has(declaration.name.text))
          throw Error('Duplicate configuration binding: ' + declaration.name.text);
        bindings.set(declaration.name.text, declaration.initializer);
        if (hasExportModifier(statement)) namedExports.set(declaration.name.text, declaration.initializer);
      }
    } else if (ts.isExportAssignment(statement)) setPrimary(statement.expression);
    else if (ts.isExpressionStatement(statement)) {
      const expression = unwrapExpression(statement.expression);
      if (ts.isStringLiteral(expression)) continue; // e.g. 'use strict'
      if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
        throw Error('Executable configuration statements are not supported');
      if (isCommonJsExportLeft(expression.left)) setPrimary(expression.right);
      else {
        const left = unwrapExpression(expression.left);
        if (
          !ts.isPropertyAccessExpression(left) ||
          !ts.isIdentifier(left.expression) ||
          left.expression.text !== 'exports'
        )
          throw Error('Configuration mutations are not supported');
        if (namedExports.has(left.name.text)) throw Error('Duplicate configuration export: ' + left.name.text);
        if (!FORBIDDEN_OBJECT_KEYS.has(left.name.text)) namedExports.set(left.name.text, expression.right);
      }
    } else if (
      !ts.isImportDeclaration(statement) &&
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      !ts.isEmptyStatement(statement)
    ) {
      throw Error('Unsupported configuration statement: ' + ts.SyntaxKind[statement.kind]);
    }
  }
  const preferred = [...namedExports].filter(([name]) => preferredNames.includes(name));
  if (!primary && preferred.length === 1) primary = preferred[0]![1];
  if (primary) {
    const value = extractAstValue(primary, bindings, new Set(), 0, budget);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('Expected a static configuration object export');
    return value as Record<string, unknown>;
  }
  if (preferred.length > 1 || !namedExports.size) throw Error('Expected one static configuration object export');
  const named: Record<string, unknown> = {};
  for (const [key, expression] of namedExports)
    setSafeProperty(named, key, extractAstValue(expression, bindings, new Set(), 0, budget));
  return named;
}

export function parseDocusaurusConfigContent(content: string): DocusaurusConfigInput {
  if (typeof content !== 'string' || !content.trim()) throw Error('Expected nonempty configuration source');

  const raw = parseModuleObjectLiteral(content, ['config', 'siteConfig', 'docusaurusConfig']);
  if (!raw || Object.keys(raw).length === 0) {
    return {};
  }

  const config: DocusaurusConfigInput = {};

  for (const [key, value] of Object.entries(raw)) {
    setSafeProperty(config as Record<string, unknown>, key, value);
  }

  const extractedMacros = extractKatexMacrosFromConfig(config);
  if (raw['macros'] && typeof raw['macros'] === 'object' && !Array.isArray(raw['macros'])) {
    for (const [mk, mv] of Object.entries(raw['macros'] as Record<string, unknown>)) {
      if (typeof mv === 'string' && !FORBIDDEN_OBJECT_KEYS.has(mk)) {
        extractedMacros[mk] = mv;
      }
    }
  }
  if (Object.keys(extractedMacros).length > 0) {
    config.katexMacros = extractedMacros;
  }

  return config;
}

export function parseDocusaurusSidebarsContent(content: string): Record<string, unknown> {
  if (typeof content !== 'string' || !content.trim()) throw Error('Expected nonempty sidebar source');
  return parseModuleObjectLiteral(content, ['sidebars', 'sidebar', 'default']);
}

export function parseConfigFile(filePath: string): DocusaurusConfigInput {
  return parseDocusaurusConfigContent(documentationText(readDocumentationFile(resolve(filePath))));
}

export function parseSidebarsFile(filePath: string): Record<string, unknown> {
  return parseDocusaurusSidebarsContent(documentationText(readDocumentationFile(resolve(filePath))));
}

export function loadDocusaurusConfigFromDir(
  dirPath: string,
  onRead?: (file: DocumentationFile) => void
): {
  config: DocusaurusConfigInput;
  rawSidebars?: Record<string, unknown>;
} {
  physicalDirectory(dirPath);
  let config: DocusaurusConfigInput = {};
  let rawSidebars: Record<string, unknown> | undefined;

  const configCandidates = [
    'docusaurus.config.ts',
    'docusaurus.config.mts',
    'docusaurus.config.cts',
    'docusaurus.config.js',
    'docusaurus.config.mjs',
    'docusaurus.config.cjs',
  ];

  if (configCandidates.filter((candidate) => pathExists(resolve(dirPath, candidate))).length > 1)
    throw Error('Ambiguous Docusaurus configuration files: ' + dirPath);
  for (const candidate of configCandidates) {
    const fullPath = resolve(dirPath, candidate);
    if (pathExists(fullPath)) {
      const file = readDocumentationFile(fullPath);
      onRead?.(file);
      config = parseDocusaurusConfigContent(documentationText(file));
      break;
    }
  }

  const sidebarCandidates = [
    'sidebars.ts',
    'sidebars.mts',
    'sidebars.cts',
    'sidebars.js',
    'sidebars.mjs',
    'sidebars.cjs',
  ];

  if (sidebarCandidates.filter((candidate) => pathExists(resolve(dirPath, candidate))).length > 1)
    throw Error('Ambiguous Docusaurus sidebar files: ' + dirPath);
  for (const candidate of sidebarCandidates) {
    const fullPath = resolve(dirPath, candidate);
    if (pathExists(fullPath)) {
      const file = readDocumentationFile(fullPath);
      onRead?.(file);
      rawSidebars = parseDocusaurusSidebarsContent(documentationText(file));
      break;
    }
  }

  return { config, rawSidebars };
}
