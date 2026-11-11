import type { CorpusDocument } from '../corpus/types.js';
import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';

export interface LumenGateDiagnostic {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestedFix?: string;
  severity: 'error' | 'warning' | 'info';
}

export interface GateResult {
  name: string;
  passed: boolean;
  diagnostics: LumenGateDiagnostic[];
}

export interface GateContext {
  documents: CorpusDocument[];
  graph: CorpusGraph;
  config: LumenConfig;
  reportDiagnostic(diagnostic: LumenGateDiagnostic): void;
}

export interface CorpusGate {
  name: string;
  description?: string;
  run(context: GateContext): Promise<GateResult> | GateResult;
}
