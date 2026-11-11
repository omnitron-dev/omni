import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr, parseTwoslashAnnotations, type LumenNode } from '@omnitron-dev/lumen-ast';
import {
  defineCorpusGate,
  type GateContext,
  type GateResult,
  type LumenGateDiagnostic,
  CorpusGraph,
  defineLumenConfig,
} from '@omnitron-dev/lumen';

describe('Tier 4: Scenario 12 — Shiki Twoslash TypeScript Verification', () => {
  it('parses TypeScript code blocks with Twoslash compiler directives and verifies diagnostics', async () => {
    const docWithTwoslash = `---
title: Twoslash Type Verification
---

# Type Analysis

\`\`\`ts twoslash
// @errors: 2322
const num: number = "this is not a number";
\`\`\`

\`\`\`ts twoslash
function computeSpectralRadius(matrix: number[][]): number {
  return 1.0;
}
const r = computeSpectralRadius([[1, 0], [0, 1]]);
//    ^?
\`\`\`
`;

    const ast = await parseDocument(docWithTwoslash, 'docs/twoslash-verification.pdx');
    expect(ast.rawContent).toContain('```ts twoslash');
    expect(ast.rawContent).toContain('@errors: 2322');
    expect(ast.rawContent).toContain('computeSpectralRadius');
    expect(ast.rawContent).toContain('//    ^?');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-code-block');
    expect(html).toContain('computeSpectralRadius');
  });

  it('verifies code blocks via Corpus Gate to ensure code blocks have non-empty contents and valid tags', async () => {
    function findCodeBlocks(nodes: LumenNode[]): Array<{ lang?: string; meta?: string; value: string }> {
      const results: Array<{ lang?: string; meta?: string; value: string }> = [];
      function walk(nodeList: LumenNode[]) {
        for (const node of nodeList) {
          if (node.type === 'codeBlock') {
            results.push({
              lang: (node as any).lang,
              meta: (node as any).meta,
              value: String((node as any).value ?? ''),
            });
          }
          if ('children' in node && Array.isArray((node as any).children)) {
            walk((node as any).children);
          }
        }
      }
      walk(nodes);
      return results;
    }

    const documentSources = new Map<string, string>();

    const codeBlockGate = defineCorpusGate({
      name: 'code-block-syntax-gate',
      description: 'Validates that code blocks have non-empty content and valid Twoslash annotations',
      async run(context: GateContext): Promise<GateResult> {
        const diagnostics: LumenGateDiagnostic[] = [];

        for (const doc of context.documents) {
          const rawSource = documentSources.get(doc.path) ?? '';
          if (!rawSource) continue;

          const ast = await parseDocument(rawSource, doc.path);
          const codeBlocks = findCodeBlocks(ast.children);

          for (const block of codeBlocks) {
            // Check 1: Code block must not be empty
            if (block.value.trim().length === 0) {
              diagnostics.push({
                code: 'EMPTY_CODE_BLOCK',
                message: `Document ${doc.path} contains an empty code block`,
                file: doc.path,
                severity: 'error',
              });
              continue;
            }

            // Check 2: Twoslash directives validation
            if (block.meta?.includes('twoslash')) {
              const twoslashResult = parseTwoslashAnnotations(block.value);

              // If block has @errors directive, ensure expected errors were parsed
              if (block.value.includes('// @errors:') && twoslashResult.expectedErrors.length === 0) {
                diagnostics.push({
                  code: 'INVALID_TWOSLASH_DIRECTIVE',
                  message: `Twoslash code block in ${doc.path} has malformed @errors directive`,
                  file: doc.path,
                  severity: 'error',
                });
              }

              // If block has query annotation // ^?, ensure hover annotation was registered
              if (block.value.includes('//    ^?') && !twoslashResult.annotations.some((a) => a.type === 'hover')) {
                diagnostics.push({
                  code: 'MALFORMED_TWOSLASH_QUERY',
                  message: `Twoslash query in ${doc.path} failed to register hover annotation`,
                  file: doc.path,
                  severity: 'error',
                });
              }
            }
          }
        }

        return {
          name: 'code-block-syntax-gate',
          passed: diagnostics.length === 0,
          diagnostics,
        };
      },
    });

    // 1. Valid document with proper Twoslash annotations passes gate
    const validDocSource = `---
title: Twoslash Verification
---

# Code Section

\`\`\`ts twoslash
// @errors: 2322
const invalid: number = "test";
\`\`\`

\`\`\`ts twoslash
const radius = 42;
//    ^?
\`\`\`
`;
    documentSources.set('docs/ts.pdx', validDocSource);

    const validResult = await codeBlockGate.run({
      documents: [
        {
          id: 'doc-ts',
          path: 'docs/ts.pdx',
          title: 'Twoslash Verification',
          hash: 'hash-ts',
          anchors: [],
          mathObjects: [],
          backlinks: [],
        },
      ],
      graph: new CorpusGraph(),
      config: defineLumenConfig({ title: 'Code Verify' }),
      reportDiagnostic: () => {},
    });

    expect(validResult.passed).toBe(true);
    expect(validResult.diagnostics).toHaveLength(0);

    // 2. Invalid document with an empty code block is caught by gate
    const invalidDocSource = `---
title: Invalid Doc
---

# Empty Block Test

\`\`\`ts
\`\`\`
`;
    documentSources.set('docs/invalid.pdx', invalidDocSource);

    const invalidResult = await codeBlockGate.run({
      documents: [
        {
          id: 'doc-invalid',
          path: 'docs/invalid.pdx',
          title: 'Invalid Doc',
          hash: 'hash-invalid',
          anchors: [],
          mathObjects: [],
          backlinks: [],
        },
      ],
      graph: new CorpusGraph(),
      config: defineLumenConfig({ title: 'Code Verify' }),
      reportDiagnostic: () => {},
    });

    expect(invalidResult.passed).toBe(false);
    expect(invalidResult.diagnostics.length).toBeGreaterThan(0);
    expect(invalidResult.diagnostics[0]?.code).toBe('EMPTY_CODE_BLOCK');
  });
});
