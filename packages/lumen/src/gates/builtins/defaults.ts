import type { CorpusGate, GateContext, GateResult, LumenGateDiagnostic } from '../types.js';
import type { LumenNode } from '@omnitron-dev/lumen-ast';

function walkNodes(nodes: LumenNode[], visitor: (node: LumenNode) => void): void {
  for (const node of nodes) {
    visitor(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      walkNodes(node.children, visitor);
    }
  }
}

function cleanLiteral(val: string): string {
  return val
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .trim();
}

export const codeDefaultsGate: CorpusGate = {
  name: 'codeDefaultsGate',
  description: 'Verifies documented component and function parameter defaults against code definitions',
  run(context: GateContext): GateResult {
    const diagnostics: LumenGateDiagnostic[] = [];

    for (const doc of context.documents) {
      if (!doc.ast?.children) continue;

      walkNodes(doc.ast.children, (node) => {
        // 1. Inspect code blocks for documented defaults vs signature defaults
        if (node.type === 'codeBlock' && typeof node.value === 'string') {
          const code = node.value;

          // A. Scan for JSDoc @default and parameter default mismatch
          const jsDocRegex = /\/\*\*([\s\S]*?)\*\//g;
          let jsDocMatch: RegExpExecArray | null;
          while ((jsDocMatch = jsDocRegex.exec(code)) !== null) {
            const jsDocContent = jsDocMatch[1] ?? '';

            // Extract @default <val>
            const defaultTagMatch = /@default\s+([^\r\n*]+)/.exec(jsDocContent);
            const docDefault = defaultTagMatch ? cleanLiteral(defaultTagMatch[1] ?? '') : undefined;

            // Extract @param [paramName=val] or @param paramName
            const paramTagMatch =
              /@param\s*(?:\{[^}]*\})?\s*(?:\[([a-zA-Z0-9_$]+)(?:=([^\]]+))?\]|([a-zA-Z0-9_$]+))/.exec(jsDocContent);
            const paramName = paramTagMatch ? (paramTagMatch[1] ?? paramTagMatch[3]) : undefined;
            const paramDefault = paramTagMatch?.[2] ? cleanLiteral(paramTagMatch[2]) : undefined;

            const effectiveDocDefault = docDefault ?? paramDefault;

            if (paramName && effectiveDocDefault !== undefined) {
              // Find matching parameter default in code signature
              const paramSigRegex = new RegExp(`\\b${paramName}\\s*(?::\\s*[^=,)\\n]+)?\\s*=\\s*([^,)\\n;]+)`);
              const sigMatch = paramSigRegex.exec(code);
              if (sigMatch) {
                const codeDefault = cleanLiteral(sigMatch[1] ?? '');
                if (codeDefault && effectiveDocDefault !== codeDefault) {
                  diagnostics.push({
                    code: 'LUMEN_CODE_DEFAULT_MISMATCH',
                    message: `Documented default "${effectiveDocDefault}" for parameter "${paramName}" does not match code definition "${codeDefault}"`,
                    file: doc.path,
                    line: node.position?.start?.line,
                    severity: 'error',
                    suggestedFix: codeDefault,
                  });
                }
              }
            }
          }

          // B. Scan Twoslash compiler option flags
          if (node.lang?.includes('twoslash') || node.meta?.includes('twoslash')) {
            const lines = code.split('\n');
            const booleanFlags = new Set([
              'strict',
              'noimplicitany',
              'esmoduleinterop',
              'skiplibcheck',
              'allowjs',
              'checkjs',
              'isolatedmodules',
              'noemit',
            ]);

            for (const line of lines) {
              const optMatch = /^\s*\/\/\s*@([a-zA-Z0-9_-]+)(?::|\s+)(.*)$/.exec(line);
              if (optMatch) {
                const optName = (optMatch[1] ?? '').toLowerCase();
                const optVal = (optMatch[2] ?? '').trim().toLowerCase();
                if (booleanFlags.has(optName) && optVal !== 'true' && optVal !== 'false') {
                  diagnostics.push({
                    code: 'LUMEN_INVALID_TWOSLASH_OPTION',
                    message: `Invalid boolean value "${optMatch[2]?.trim()}" for Twoslash compiler option "@${optMatch[1]}"`,
                    file: doc.path,
                    severity: 'warning',
                    suggestedFix: `// @${optMatch[1]}: true`,
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

                if (propName && propType && defVal !== undefined) {
                  // Validate boolean defaults
                  if (propType === 'boolean' || propType === 'bool') {
                    const isValidBool = defVal === true || defVal === false || defVal === 'true' || defVal === 'false';
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
              }
            }
          }
        }
      });
    }

    return {
      name: 'codeDefaultsGate',
      passed: diagnostics.filter((d) => d.severity === 'error').length === 0,
      diagnostics,
    };
  },
};
