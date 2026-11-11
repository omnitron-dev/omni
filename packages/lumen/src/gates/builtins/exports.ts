import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import type { LumenNode, LumenSmartRefNode } from '@omnitron-dev/lumen-ast';
import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';

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

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  if (!modifiers) return false;
  return modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function isInternalJsDoc(node: ts.Node): boolean {
  const tags = ts.getJSDocTags(node);
  return tags.some((t) => {
    const name = t.tagName.text.toLowerCase();
    return name === 'internal' || name === 'ignore' || name === 'private';
  });
}

function collectBindingNames(binding: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(binding)) {
    out.push(binding.text);
    return;
  }
  for (const elem of binding.elements) {
    if (ts.isBindingElement(elem)) {
      collectBindingNames(elem.name, out);
    }
  }
}

/**
 * Extracts exported symbol names from TypeScript/JavaScript source text via `ts.createSourceFile`
 * with zero regular expressions.
 */
function extractExportedDeclarationsFromAst(sourceText: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const exportedNames: string[] = [];

  for (const stmt of sf.statements) {
    if (isInternalJsDoc(stmt)) {
      continue;
    }

    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      hasExportModifier(stmt) &&
      stmt.name
    ) {
      exportedNames.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        collectBindingNames(decl.name, exportedNames);
      }
    } else if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) {
        exportedNames.push(spec.name.text);
      }
    }
  }

  return Array.from(new Set(exportedNames));
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

function extractLeadingIdentifier(text: string): string | undefined {
  const cleaned = text.replace(/^[`*\s]+|[`*\s]+$/g, '');
  let end = 0;
  while (end < cleaned.length) {
    const ch = cleaned.charCodeAt(end);
    const isIdent =
      (ch >= 48 && ch <= 57 && end > 0) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 36;
    if (!isIdent) break;
    end += 1;
  }
  return end > 0 ? cleaned.slice(0, end) : undefined;
}

function isTsCompatibleCodeBlock(lang?: string): boolean {
  if (!lang) return true;
  const primary = (lang.trim().split(/\s+/)[0] ?? '').toLowerCase();
  return CODE_BLOCK_TS_LANGS.has(primary);
}

export const undocumentedExportsGate: CorpusGate = {
  name: 'undocumentedExportsGate',
  description:
    'Verifies workspace package exports have corresponding documentation entries via TypeScript AST inspection',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];

    // 1. Build an index of all documented symbols, anchors, IDs, and API widgets across the corpus
    const documentedSymbols = new Set<string>();

    for (const doc of context.documents) {
      documentedSymbols.add(doc.id);

      if (doc.routePath) {
        documentedSymbols.add(doc.routePath);
      }

      for (const anchor of doc.anchors ?? []) {
        documentedSymbols.add(anchor);
      }

      for (const header of doc.headers ?? []) {
        if (header.id) {
          documentedSymbols.add(header.id);
        }
        if (header.title) {
          documentedSymbols.add(header.title);
          const leadingIdent = extractLeadingIdentifier(header.title);
          if (leadingIdent) {
            documentedSymbols.add(leadingIdent);
          }
        }
      }

      for (const math of doc.mathObjects ?? []) {
        documentedSymbols.add(math.id);
      }

      if (doc.frontmatter?.['symbols'] && Array.isArray(doc.frontmatter['symbols'])) {
        for (const sym of doc.frontmatter['symbols']) {
          if (typeof sym === 'string') {
            documentedSymbols.add(sym);
          }
        }
      }

      if (doc.ast?.children) {
        walkNodes(doc.ast.children, (node) => {
          if (node.type === 'heading' && typeof node.id === 'string' && node.id) {
            documentedSymbols.add(node.id);
          } else if (node.type === 'jsxWidget' && node.props && typeof node.props === 'object') {
            const sym = node.props['symbol'] ?? node.props['component'];
            if (typeof sym === 'string' && sym.trim()) {
              documentedSymbols.add(sym.trim());
            }
          }
        });
      }
    }

    // 2. Verify declared exports in frontmatter, referenced TypeScript source files, and TS code blocks
    for (const doc of context.documents) {
      const declaredExports = new Set<string>();

      if (Array.isArray(doc.frontmatter?.['exports'])) {
        for (const exp of doc.frontmatter['exports']) {
          if (typeof exp === 'string' && exp.trim()) declaredExports.add(exp.trim());
        }
      }

      if (doc.frontmatter?.['packageExports'] && typeof doc.frontmatter['packageExports'] === 'object') {
        const pkgExports = doc.frontmatter['packageExports'] as Record<string, unknown>;
        for (const list of Object.values(pkgExports)) {
          if (Array.isArray(list)) {
            for (const exp of list) {
              if (typeof exp === 'string' && exp.trim()) declaredExports.add(exp.trim());
            }
          }
        }
      }

      // Inspect referenced real `.ts`/`.tsx` workspace files via TypeScript AST
      const sourceFiles = resolveReferencedSourceFiles(doc.path, doc.frontmatter, context.config);
      for (const sourceFilePath of sourceFiles) {
        try {
          const sourceText = readFileSync(sourceFilePath, 'utf8');
          const astExports = extractExportedDeclarationsFromAst(sourceText, sourceFilePath);
          for (const exp of astExports) {
            declaredExports.add(exp);
          }
        } catch {
          // Ignore unreadable source files
        }
      }

      // Inspect TypeScript code blocks when opted in or when verifying exported declarations in code blocks
      if (doc.ast?.children) {
        walkNodes(doc.ast.children, (node) => {
          if (
            node.type === 'codeBlock' &&
            typeof node.value === 'string' &&
            isTsCompatibleCodeBlock(node.lang) &&
            !node.meta?.includes('no-export-check') &&
            !node.meta?.includes('example')
          ) {
            const astExports = extractExportedDeclarationsFromAst(node.value, `${doc.path || 'snippet'}.tsx`);
            for (const exp of astExports) {
              declaredExports.add(exp);
            }
          }
        });
      }

      for (const exp of declaredExports) {
        const hasDocEntry =
          documentedSymbols.has(exp) ||
          (doc.anchors ?? []).includes(exp) ||
          (doc.headers ?? []).some((h) => h.id === exp || h.title === exp);

        if (!hasDocEntry) {
          const candidate = Array.from(documentedSymbols).find(
            (s) => s.toLowerCase().includes(exp.toLowerCase()) || exp.toLowerCase().includes(s.toLowerCase())
          );

          diagnostics.push({
            code: 'LUMEN_UNDOCUMENTED_EXPORT',
            message: `Export "${exp}" declared in document "${doc.id}" has no corresponding documentation entry or anchor in corpus`,
            file: doc.path,
            severity: 'error',
            suggestedFix: candidate ? `{#${candidate}}` : `## ${exp}\n\n{#${exp}}`,
          });
        }
      }
    }

    // 3. Verify @api smart references point to documented symbols
    for (const doc of context.documents) {
      if (doc.ast?.children) {
        walkNodes(doc.ast.children, (node) => {
          if (node.type === 'smartRef') {
            const ref = node as LumenSmartRefNode;
            if (ref.domain === 'api') {
              const target = ref.symbol ?? ref.target;
              if (target) {
                const resolvedDoc = context.graph.getDocument(target);
                const resolvedMath = context.graph.resolveMathRef(target);
                const resolvedAnchor = context.graph.resolveAnchor(target, doc.id);
                const inIndex =
                  documentedSymbols.has(target) || Boolean(ref.symbol && documentedSymbols.has(ref.symbol));

                if (!resolvedDoc && !resolvedMath && !resolvedAnchor.resolved && !inIndex) {
                  const candidate = Array.from(documentedSymbols).find(
                    (s) =>
                      s.toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(s.toLowerCase())
                  );

                  diagnostics.push({
                    code: 'LUMEN_UNDOCUMENTED_API_SYMBOL',
                    message: `Referenced API symbol "${target}" has no corresponding documentation entry or anchor in corpus`,
                    file: doc.path,
                    line: ref.position?.start?.line,
                    severity: 'error',
                    suggestedFix: candidate ? `@api:${candidate}` : undefined,
                  });
                }
              }
            }
          }
        });
      }
    }

    return {
      name: 'undocumentedExportsGate',
      passed: diagnostics.filter((d) => d.severity === 'error').length === 0,
      diagnostics,
    };
  },
};
