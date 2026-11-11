import type { DocusaurusConfigInput } from '../types.js';

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import ts from 'typescript';

import { extractKatexMacrosFromConfig } from '../katex/macro-extractor.js';

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_AST_RECURSION_DEPTH = 64;

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

function resolvePropertyKey(name: ts.PropertyName, bindings: Map<string, ts.Expression>, depth: number): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const val = extractAstValue(name.expression, bindings, new Set(), depth + 1);
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
  depth = 0
): unknown {
  if (depth > MAX_AST_RECURSION_DEPTH) {
    return undefined;
  }

  const expr = unwrapExpression(rawExpr);

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }

  if (ts.isTemplateExpression(expr)) {
    let out = expr.head.text;
    for (const span of expr.templateSpans) {
      const spanVal = extractAstValue(span.expression, bindings, seenIdentifiers, depth + 1);
      if (spanVal === undefined || spanVal === null || typeof spanVal === 'object') {
        return undefined;
      }
      out += String(spanVal) + span.literal.text;
    }
    return out;
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

  if (ts.isPrefixUnaryExpression(expr)) {
    const operand = extractAstValue(expr.operand, bindings, seenIdentifiers, depth + 1);
    switch (expr.operator) {
      case ts.SyntaxKind.MinusToken:
        return typeof operand === 'number' ? -operand : undefined;
      case ts.SyntaxKind.PlusToken:
        return typeof operand === 'number' ? +operand : undefined;
      case ts.SyntaxKind.ExclamationToken:
        return operand !== undefined ? !operand : undefined;
      default:
        return undefined;
    }
  }

  if (ts.isIdentifier(expr)) {
    if (expr.text === 'undefined') {
      return undefined;
    }
    if (seenIdentifiers.has(expr.text)) {
      return undefined;
    }
    const bound = bindings.get(expr.text);
    if (!bound) {
      return undefined;
    }
    const nextSeen = new Set(seenIdentifiers);
    nextSeen.add(expr.text);
    return extractAstValue(bound, bindings, nextSeen, depth + 1);
  }

  if (ts.isCallExpression(expr)) {
    // Support require.resolve('./sidebars.js') and wrapper calls like defineConfig({ ... })
    if (expr.arguments.length >= 1 && expr.arguments[0]) {
      const firstArg = unwrapExpression(expr.arguments[0]);
      if (
        ts.isObjectLiteralExpression(firstArg) ||
        ts.isArrayLiteralExpression(firstArg) ||
        ts.isStringLiteral(firstArg) ||
        ts.isNoSubstitutionTemplateLiteral(firstArg) ||
        ts.isIdentifier(firstArg)
      ) {
        return extractAstValue(firstArg, bindings, seenIdentifiers, depth + 1);
      }
    }
    return undefined;
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const items: unknown[] = [];
    for (const element of expr.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }
      if (ts.isSpreadElement(element)) {
        const spreadVal = extractAstValue(element.expression, bindings, seenIdentifiers, depth + 1);
        if (Array.isArray(spreadVal)) {
          items.push(...spreadVal);
        }
        continue;
      }
      const extracted = extractAstValue(element, bindings, seenIdentifiers, depth + 1);
      if (extracted !== undefined) {
        items.push(extracted);
      } else if (unwrapExpression(element).kind === ts.SyntaxKind.NullKeyword) {
        items.push(null);
      }
    }
    return items;
  }

  if (ts.isObjectLiteralExpression(expr)) {
    const obj: Record<string, unknown> = {};
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = resolvePropertyKey(prop.name, bindings, depth + 1);
        if (!key || FORBIDDEN_OBJECT_KEYS.has(key)) {
          continue;
        }
        const val = extractAstValue(prop.initializer, bindings, seenIdentifiers, depth + 1);
        setSafeProperty(obj, key, val);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        if (FORBIDDEN_OBJECT_KEYS.has(key) || seenIdentifiers.has(key)) {
          continue;
        }
        const bound = bindings.get(key);
        if (bound) {
          const nextSeen = new Set(seenIdentifiers);
          nextSeen.add(key);
          const val = extractAstValue(bound, bindings, nextSeen, depth + 1);
          setSafeProperty(obj, key, val);
        }
      } else if (ts.isSpreadAssignment(prop)) {
        const spreadVal = extractAstValue(prop.expression, bindings, seenIdentifiers, depth + 1);
        if (spreadVal && typeof spreadVal === 'object' && !Array.isArray(spreadVal)) {
          for (const [k, v] of Object.entries(spreadVal as Record<string, unknown>)) {
            setSafeProperty(obj, k, v);
          }
        }
      }
    }
    return obj;
  }

  return undefined;
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
  const parseFromSource = (sourceText: string): Record<string, unknown> | null => {
    const sourceFile = ts.createSourceFile('module.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const bindings = new Map<string, ts.Expression>();
    const exportedVarCandidates: ts.Expression[] = [];
    let primaryExportExpr: ts.Expression | undefined;
    let standaloneObjectExpr: ts.Expression | undefined;

    for (const stmt of sourceFile.statements) {
      if (ts.isVariableStatement(stmt)) {
        const isExported = hasExportModifier(stmt);
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer) {
            bindings.set(decl.name.text, decl.initializer);
            if (isExported) {
              if (preferredNames.includes(decl.name.text)) {
                primaryExportExpr = decl.initializer;
              } else {
                exportedVarCandidates.push(decl.initializer);
              }
            }
          }
        }
      } else if (ts.isExportAssignment(stmt)) {
        primaryExportExpr = stmt.expression;
      } else if (ts.isExpressionStatement(stmt)) {
        const inner = unwrapExpression(stmt.expression);
        if (
          ts.isBinaryExpression(inner) &&
          inner.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          isCommonJsExportLeft(inner.left)
        ) {
          primaryExportExpr = inner.right;
        } else if (
          ts.isBinaryExpression(inner) &&
          inner.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(unwrapExpression(inner.left))
        ) {
          // Support `exports.tutorialSidebar = [...]`
          const propAccess = unwrapExpression(inner.left) as ts.PropertyAccessExpression;
          const target = unwrapExpression(propAccess.expression);
          if (
            ts.isIdentifier(target) &&
            target.text === 'exports' &&
            !FORBIDDEN_OBJECT_KEYS.has(propAccess.name.text)
          ) {
            bindings.set(`__cjs_named_${propAccess.name.text}`, inner.right);
          }
        } else if (!standaloneObjectExpr && (ts.isObjectLiteralExpression(inner) || ts.isCallExpression(inner))) {
          standaloneObjectExpr = inner;
        }
      }
    }

    const candidates: ts.Expression[] = [];
    if (primaryExportExpr) {
      candidates.push(primaryExportExpr);
    }
    candidates.push(...exportedVarCandidates);
    for (const name of preferredNames) {
      const bound = bindings.get(name);
      if (bound) {
        candidates.push(bound);
      }
    }
    if (standaloneObjectExpr) {
      candidates.push(standaloneObjectExpr);
    }
    // Last fallback: if there is exactly one variable binding in the file, inspect it
    if (candidates.length === 0 && bindings.size === 1) {
      const firstBinding = bindings.values().next().value;
      if (firstBinding) {
        candidates.push(firstBinding);
      }
    }

    for (const candidate of candidates) {
      const extracted = extractAstValue(candidate, bindings, new Set());
      if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) {
        return extracted as Record<string, unknown>;
      }
    }

    // Named CommonJS exports fallback (`exports.foo = [...]`)
    const cjsNamed: Record<string, unknown> = {};
    let hasCjsNamed = false;
    for (const [key, expr] of bindings.entries()) {
      if (key.startsWith('__cjs_named_')) {
        const cleanKey = key.slice('__cjs_named_'.length);
        const val = extractAstValue(expr, bindings, new Set());
        if (val !== undefined) {
          setSafeProperty(cjsNamed, cleanKey, val);
          hasCjsNamed = true;
        }
      }
    }
    if (hasCjsNamed) {
      return cjsNamed;
    }

    return null;
  };

  const direct = parseFromSource(content);
  if (direct && Object.keys(direct).length > 0) {
    return direct;
  }

  // Fallback for bare object-property snippets (`tutorialSidebar: ['intro']`) passed without outer braces
  const trimmed = content.trim();
  if (trimmed && !trimmed.startsWith('{')) {
    const wrapped = parseFromSource(`const __snippet = {\n${content}\n};\nexport default __snippet;`);
    if (wrapped && Object.keys(wrapped).length > 0) {
      return wrapped;
    }
  } else if (trimmed.startsWith('{')) {
    const wrappedObj = parseFromSource(`const __snippet = (${content});\nexport default __snippet;`);
    if (wrappedObj && Object.keys(wrappedObj).length > 0) {
      return wrappedObj;
    }
  }

  return direct ?? {};
}

export function parseDocusaurusConfigContent(content: string): DocusaurusConfigInput {
  if (!content || typeof content !== 'string') {
    return {};
  }

  try {
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
  } catch {
    return {};
  }
}

export function parseDocusaurusSidebarsContent(content: string): Record<string, unknown> {
  if (!content || typeof content !== 'string') {
    return {};
  }

  try {
    return parseModuleObjectLiteral(content, ['sidebars', 'sidebar', 'default']);
  } catch {
    return {};
  }
}

export function parseConfigFile(filePath: string): DocusaurusConfigInput {
  if (!filePath || typeof filePath !== 'string' || !existsSync(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    return parseDocusaurusConfigContent(content);
  } catch {
    return {};
  }
}

export function parseSidebarsFile(filePath: string): Record<string, unknown> {
  if (!filePath || typeof filePath !== 'string' || !existsSync(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    return parseDocusaurusSidebarsContent(content);
  } catch {
    return {};
  }
}

export function loadDocusaurusConfigFromDir(dirPath: string): {
  config: DocusaurusConfigInput;
  rawSidebars?: Record<string, unknown>;
} {
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

  for (const candidate of configCandidates) {
    const fullPath = resolve(dirPath, candidate);
    if (existsSync(fullPath)) {
      config = parseConfigFile(fullPath);
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

  for (const candidate of sidebarCandidates) {
    const fullPath = resolve(dirPath, candidate);
    if (existsSync(fullPath)) {
      rawSidebars = parseSidebarsFile(fullPath);
      break;
    }
  }

  return { config, rawSidebars };
}
