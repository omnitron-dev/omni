/**
 * Structured Diagnostics Data Model for Lumen AST Compiler
 */

export interface LumenDiagnosticFix {
  range?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  replacement: string;
}

export interface LumenDiagnostic {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  length?: number;
  severity: 'error' | 'warning' | 'info';
  suggestedFix?: string;
  fix?: LumenDiagnosticFix;
}

export function createDiagnostic(
  code: string,
  message: string,
  severity: 'error' | 'warning' | 'info' = 'warning',
  options?: {
    file?: string;
    line?: number;
    column?: number;
    length?: number;
    suggestedFix?: string;
    fix?: LumenDiagnosticFix;
  }
): LumenDiagnostic {
  return {
    code,
    message,
    severity,
    file: options?.file,
    line: options?.line,
    column: options?.column,
    length: options?.length,
    suggestedFix: options?.suggestedFix,
    fix: options?.fix,
  };
}
