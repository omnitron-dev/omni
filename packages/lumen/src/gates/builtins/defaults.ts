import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import type { LumenNode } from '@omnitron-dev/lumen-ast';
import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';

const TWOSLASH_BOOLEAN_FLAGS = new Set([
  'strict',
  'noimplicitany',
  'esmoduleinterop',
  'skiplibcheck',
  'allowjs',
  'checkjs',
  'isolatedmodules',
  'noemit',
]);

const CODE_BLOCK_TS_LANGS = new Set([
  '',
  'ts',
  'tsx',
  'typescript',
  'js',
  'jsx',
  'javascript',
  'mts',
  'cts',
  'mjs',
  'cjs',
]);

function walkNodes(nodes: LumenNode[], visitor: (node: LumenNode) => void): void {
  for (const node of nodes) {
    visitor(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      walkNodes(node.children, visitor);
    }
  }
}

function cleanLiteral(val: string): string {
  let out = val.trim();
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"') || (first === '`' && last === '`')) {
      out = out.slice(1, -1).trim();
    }
  }
  return out;
}

function formatAstInitializer(expr: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isNumericLiteral(expr)) {
    return expr.text;
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return 'true';
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return 'false';
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return 'null';
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return `-${expr.operand.text}`;
  }
  return cleanLiteral(expr.getText(sf));
}

function extractJsDocCommentText(comment: ts.JSDoc['comment']): string {
  if (!comment) return '';
  if (typeof comment === 'string') return comment;
  return comment.map((part) => part.text).join('');
}

function extractFirstLineLiteral(raw: string): string {
  const nlIdx = raw.indexOf('\n');
  const firstLine = (nlIdx === -1 ? raw : raw.slice(0, nlIdx)).replace(/\r$/, '').trim();
  return cleanLiteral(firstLine);
}

/**
 * Extracts `[paramName=defaultVal]` from a `@param` JSDoc tag text using O(N) linear scanning
 * with zero regular expressions (eliminating any ReDoS surface).
 */
function extractBracketedParamDefault(tagText: string): { name: string; defaultVal?: string } | null {
  const openIdx = tagText.indexOf('[');
  if (openIdx === -1) return null;
  const closeIdx = tagText.indexOf(']', openIdx + 1);
  if (closeIdx === -1) return null;

  const inside = tagText.slice(openIdx + 1, closeIdx).trim();
  if (!inside) return null;

  const eqIdx = inside.indexOf('=');
  if (eqIdx === -1) {
    return { name: inside };
  }

  const name = inside.slice(0, eqIdx).trim();
  const defaultVal = cleanLiteral(inside.slice(eqIdx + 1));
  return name ? { name, defaultVal } : null;
}

/**
 * Linearly parses `// @flag: val` or `// @flag val` Twoslash compiler directives without backtracking regexes.
 */
function parseTwoslashDirective(line: string): { rawName: string; rawValue: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('//')) return null;

  const afterSlashes = trimmed.slice(2).trimStart();
  if (!afterSlashes.startsWith('@')) return null;

  let idx = 1;
  while (idx < afterSlashes.length) {
    const ch = afterSlashes.charCodeAt(idx);
    const isNameChar =
      (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 45;
    if (!isNameChar) break;
    idx += 1;
  }

  const rawName = afterSlashes.slice(1, idx);
  if (!rawName || idx >= afterSlashes.length) return null;

  const sep = afterSlashes[idx];
  if (sep !== ':' && sep !== ' ' && sep !== '\t') return null;

  const rest = sep === ':' ? afterSlashes.slice(idx + 1) : afterSlashes.slice(idx);
  return {
    rawName,
    rawValue: rest.trim(),
  };
}

interface ExtractedParamDefault {
  codeDefault: string;
  line: number;
}

function inspectTypeScriptSourceForDefaults(
  sourceText: string,
  virtualFileName: string,
  reportFilePath: string,
  baseLineOffset: number,
  diagnostics: LumenGateDiagnostic[],
  collectedDefaultsOut: Map<string, string>
): void {
  const sf = ts.createSourceFile(virtualFileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const getLineNumber = (node: ts.Node): number => {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return baseLineOffset + pos.line;
  };

  const extractFunctionParameters = (
    params: readonly ts.ParameterDeclaration[]
  ): Map<string, ExtractedParamDefault> => {
    const paramMap = new Map<string, ExtractedParamDefault>();

    for (const param of params) {
      if (ts.isIdentifier(param.name) && param.initializer) {
        const name = param.name.text;
        const val = formatAstInitializer(param.initializer, sf);
        paramMap.set(name, { codeDefault: val, line: getLineNumber(param) });
        collectedDefaultsOut.set(name, val);
      } else if (ts.isObjectBindingPattern(param.name)) {
        for (const elem of param.name.elements) {
          const propName = elem.propertyName ? elem.propertyName.getText(sf) : elem.name.getText(sf);
          if (propName && elem.initializer) {
            const val = formatAstInitializer(elem.initializer, sf);
            paramMap.set(propName, { codeDefault: val, line: getLineNumber(elem) });
            collectedDefaultsOut.set(propName, val);
          }
        }
      }

      // Check inline JSDoc `@default` directly attached to the parameter
      if (ts.isIdentifier(param.name) && param.initializer) {
        const inlineTags = ts.getJSDocTags(param);
        for (const tag of inlineTags) {
          const tagName = tag.tagName.text.toLowerCase();
          if (tagName === 'default' || tagName === 'defaultvalue') {
            const docDefault = extractFirstLineLiteral(extractJsDocCommentText(tag.comment));
            const codeDefault = formatAstInitializer(param.initializer, sf);
            if (docDefault && codeDefault && docDefault !== codeDefault) {
              diagnostics.push({
                code: 'LUMEN_CODE_DEFAULT_MISMATCH',
                message: `Documented default "${docDefault}" for parameter "${param.name.text}" does not match code definition "${codeDefault}"`,
                file: reportFilePath,
                line: getLineNumber(param),
                severity: 'error',
                suggestedFix: codeDefault,
              });
            }
          }
        }
      }
    }

    return paramMap;
  };

  const verifyCallableNode = (fnNode: ts.SignatureDeclarationBase, jsdocHost: ts.Node) => {
    const paramDefaults = extractFunctionParameters(fnNode.parameters);
    if (paramDefaults.size === 0) return;

    const tags = ts.getJSDocTags(jsdocHost);
    if (tags.length === 0) return;

    const documentedParamDefaults = new Map<string, string>();
    const paramNamesInJsDoc: string[] = [];
    let hostLevelDefault: string | undefined;

    for (const tag of tags) {
      const tagName = tag.tagName.text.toLowerCase();
      if (ts.isJSDocParameterTag(tag)) {
        const pName = tag.name.getText(sf).trim();
        if (pName) {
          paramNamesInJsDoc.push(pName);
        }
        if (tag.isBracketed) {
          const bracketed = extractBracketedParamDefault(tag.getText(sf));
          if (bracketed?.name && bracketed.defaultVal !== undefined) {
            documentedParamDefaults.set(bracketed.name, bracketed.defaultVal);
          }
        }
      } else if (tagName === 'default' || tagName === 'defaultvalue') {
        const parsed = extractFirstLineLiteral(extractJsDocCommentText(tag.comment));
        if (parsed !== '') {
          hostLevelDefault = parsed;
        }
      }
    }

    if (hostLevelDefault !== undefined) {
      const targetParam =
        paramNamesInJsDoc.find((name) => paramDefaults.has(name) && !documentedParamDefaults.has(name)) ??
        (paramDefaults.size === 1 ? Array.from(paramDefaults.keys())[0] : undefined);
      if (targetParam) {
        documentedParamDefaults.set(targetParam, hostLevelDefault);
      }
    }

    for (const [paramName, docDefault] of documentedParamDefaults.entries()) {
      const actual = paramDefaults.get(paramName);
      if (actual && actual.codeDefault && docDefault !== actual.codeDefault) {
        diagnostics.push({
          code: 'LUMEN_CODE_DEFAULT_MISMATCH',
          message: `Documented default "${docDefault}" for parameter "${paramName}" does not match code definition "${actual.codeDefault}"`,
          file: reportFilePath,
          line: actual.line,
          severity: 'error',
          suggestedFix: actual.codeDefault,
        });
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
      verifyCallableNode(node, node);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          verifyCallableNode(decl.initializer, node);
        }
      }
    } else if (ts.isPropertyDeclaration(node) && node.initializer) {
      const propName = node.name.getText(sf);
      const codeDefault = formatAstInitializer(node.initializer, sf);
      collectedDefaultsOut.set(propName, codeDefault);

      for (const tag of ts.getJSDocTags(node)) {
        const tagName = tag.tagName.text.toLowerCase();
        if (tagName === 'default' || tagName === 'defaultvalue') {
          const docDefault = extractFirstLineLiteral(extractJsDocCommentText(tag.comment));
          if (docDefault && codeDefault && docDefault !== codeDefault) {
            diagnostics.push({
              code: 'LUMEN_CODE_DEFAULT_MISMATCH',
              message: `Documented default "${docDefault}" for property "${propName}" does not match code definition "${codeDefault}"`,
              file: reportFilePath,
              line: getLineNumber(node),
              severity: 'error',
              suggestedFix: codeDefault,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
}

function resolveReferencedSourceFiles(
  docPath: string,
  frontmatter?: Record<string, unknown>,
  config?: unknown
): string[] {
  const rawRefs: string[] = [];

  if (typeof frontmatter?.['sourceFile'] === 'string') {
    rawRefs.push(frontmatter['sourceFile']);
  }
  if (Array.isArray(frontmatter?.['sourceFiles'])) {
    for (const item of frontmatter['sourceFiles']) {
      if (typeof item === 'string') rawRefs.push(item);
    }
  }

  const cfgRecord = config && typeof config === 'object' ? (config as Record<string, unknown>) : undefined;
  if (typeof cfgRecord?.['sourceFile'] === 'string') {
    rawRefs.push(cfgRecord['sourceFile']);
  }
  if (Array.isArray(cfgRecord?.['sourceFiles'])) {
    for (const item of cfgRecord['sourceFiles']) {
      if (typeof item === 'string') rawRefs.push(item);
    }
  }

  const resolvedFiles = new Set<string>();
  const docDir = docPath ? dirname(resolve(process.cwd(), docPath)) : process.cwd();

  for (const raw of rawRefs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const candidates = [resolve(process.cwd(), trimmed), resolve(docDir, trimmed)];
    for (const candidate of candidates) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        resolvedFiles.add(candidate);
        break;
      }
    }
  }

  return Array.from(resolvedFiles);
}

function isTsCompatibleCodeBlock(lang?: string): boolean {
  if (!lang) return true;
  const primary = (lang.trim().split(/\s+/)[0] ?? '').toLowerCase();
  return CODE_BLOCK_TS_LANGS.has(primary);
}

export const codeDefaultsGate: CorpusGate = {
  name: 'codeDefaultsGate',
  description: 'Verifies documented component and function parameter defaults against TypeScript AST definitions',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];

    for (const doc of context.documents) {
      const referencedFiles = resolveReferencedSourceFiles(doc.path, doc.frontmatter, context.config);
      const externalSourceDefaults = new Map<string, string>();

      for (const sourceFilePath of referencedFiles) {
        try {
          const sourceText = readFileSync(sourceFilePath, 'utf8');
          inspectTypeScriptSourceForDefaults(
            sourceText,
            sourceFilePath,
            doc.path,
            1,
            diagnostics,
            externalSourceDefaults
          );
        } catch {
          // Ignore unreadable external source files
        }
      }

      if (!doc.ast?.children) continue;

      const inlineCodeDefaults = new Map<string, string>();

      walkNodes(doc.ast.children, (node) => {
        // 1. Inspect TypeScript/JavaScript code blocks via TypeScript compiler AST
        if (node.type === 'codeBlock' && typeof node.value === 'string') {
          const code = node.value;
          const blockStartLine = node.position?.start?.line ?? 1;

          if (isTsCompatibleCodeBlock(node.lang)) {
            inspectTypeScriptSourceForDefaults(
              code,
              `${doc.path || 'snippet'}.tsx`,
              doc.path,
              blockStartLine,
              diagnostics,
              inlineCodeDefaults
            );
          }

          // B. Scan Twoslash compiler option flags linearly without backtracking regexes
          if (node.lang?.includes('twoslash') || node.meta?.includes('twoslash')) {
            const lines = code.split('\n');
            for (const line of lines) {
              const parsedOpt = parseTwoslashDirective(line);
              if (parsedOpt) {
                const optName = parsedOpt.rawName.toLowerCase();
                const optVal = parsedOpt.rawValue.toLowerCase();
                if (TWOSLASH_BOOLEAN_FLAGS.has(optName) && optVal !== 'true' && optVal !== 'false') {
                  diagnostics.push({
                    code: 'LUMEN_INVALID_TWOSLASH_OPTION',
                    message: `Invalid boolean value "${parsedOpt.rawValue}" for Twoslash compiler option "@${parsedOpt.rawName}"`,
                    file: doc.path,
                    severity: 'warning',
                    suggestedFix: `// @${parsedOpt.rawName}: true`,
                  });
                }
              }
            }
          }
        }

        // 2. Inspect JSX Widgets documenting props (e.g. PropsTable, ComponentProps, ParamTable)
        if (node.type === 'jsxWidget' && node.props && typeof node.props === 'object') {
          const propsObj = node.props as Record<string, unknown>;
          const rawItems =
            propsObj['items'] ??
            propsObj['properties'] ??
            propsObj['rows'] ??
            propsObj['props'] ??
            (propsObj['name'] && (propsObj['default'] !== undefined || propsObj['defaultValue'] !== undefined)
              ? [propsObj]
              : []);

          if (Array.isArray(rawItems)) {
            for (const item of rawItems) {
              if (item && typeof item === 'object') {
                const propRecord = item as Record<string, unknown>;
                const propName = String(propRecord['name'] ?? propRecord['prop'] ?? propRecord['parameter'] ?? '');
                const propType = String(propRecord['type'] ?? propRecord['propType'] ?? '').toLowerCase();
                const defVal = propRecord['default'] !== undefined ? propRecord['default'] : propRecord['defaultValue'];

                if (propName && defVal !== undefined) {
                  if (propType) {
                    // Validate boolean defaults
                    if (propType === 'boolean' || propType === 'bool') {
                      const isValidBool =
                        defVal === true || defVal === false || defVal === 'true' || defVal === 'false';
                      if (!isValidBool) {
                        diagnostics.push({
                          code: 'LUMEN_INVALID_PROP_DEFAULT',
                          message: `Documented default value "${String(defVal)}" does not conform to declared type "${propType}" for prop "${propName}"`,
                          file: doc.path,
                          severity: 'error',
                        });
                      }
                    }

                    // Validate number defaults
                    if (propType === 'number' || propType === 'integer' || propType === 'int' || propType === 'float') {
                      const num = typeof defVal === 'number' ? defVal : Number(String(defVal).trim());
                      if (Number.isNaN(num)) {
                        diagnostics.push({
                          code: 'LUMEN_INVALID_PROP_DEFAULT',
                          message: `Documented default value "${String(defVal)}" does not conform to declared type "${propType}" for prop "${propName}"`,
                          file: doc.path,
                          severity: 'error',
                        });
                      }
                    }
                  }

                  // Cross-check documented widget prop default against referenced TypeScript sourceFile AST
                  const expectedCodeDefault = externalSourceDefaults.get(propName);
                  if (expectedCodeDefault !== undefined) {
                    const normalizedDocDefault = cleanLiteral(String(defVal));
                    if (normalizedDocDefault !== expectedCodeDefault) {
                      diagnostics.push({
                        code: 'LUMEN_CODE_DEFAULT_MISMATCH',
                        message: `Documented default "${normalizedDocDefault}" for prop "${propName}" does not match code definition "${expectedCodeDefault}"`,
                        file: doc.path,
                        line: node.position?.start?.line,
                        severity: 'error',
                        suggestedFix: expectedCodeDefault,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      });

      const fmDefaults = doc.frontmatter?.['documentedDefaults'];
      if (fmDefaults && typeof fmDefaults === 'object' && !Array.isArray(fmDefaults)) {
        for (const [paramName, rawDocDefault] of Object.entries(fmDefaults as Record<string, unknown>)) {
          const expectedCodeDefault = externalSourceDefaults.get(paramName) ?? inlineCodeDefaults.get(paramName);
          if (expectedCodeDefault !== undefined && rawDocDefault !== undefined) {
            const normalizedDocDefault = cleanLiteral(String(rawDocDefault));
            if (normalizedDocDefault !== expectedCodeDefault) {
              diagnostics.push({
                code: 'LUMEN_CODE_DEFAULT_MISMATCH',
                message: `Documented default "${normalizedDocDefault}" for parameter "${paramName}" does not match code definition "${expectedCodeDefault}"`,
                file: doc.path,
                severity: 'error',
                suggestedFix: expectedCodeDefault,
              });
            }
          }
        }
      }
    }

    return {
      name: 'codeDefaultsGate',
      passed: diagnostics.filter((d) => d.severity === 'error').length === 0,
      diagnostics,
    };
  },
};
