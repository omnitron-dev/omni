import type { LumenDocumentAst } from '@omnitron-dev/lumen-ast';

export type MathEnvType =
  | 'axiom'
  | 'theorem'
  | 'definition'
  | 'lemma'
  | 'proposition'
  | 'corollary'
  | 'proof'
  | 'remark'
  | 'example'
  | 'hypothesis';

export interface CorpusMathObject {
  id: string;
  type: MathEnvType | string;
  title?: string;
  docId?: string;
  number?: string;
  status?: 'verified' | 'draft' | 'unverified';
  dependsOn?: string[];
  proves?: string[];
}

export interface CorpusHeader {
  id: string;
  title: string;
  depth: number;
}

export interface CorpusDocumentRelations {
  dependsOn?: string[];
  proves?: string[];
  seeAlso?: string[];
  relatesTo?: string[];
}

export interface CorpusDocument {
  id: string;
  path: string;
  title: string;
  locale?: string;
  hash: string;
  anchors: string[];
  mathObjects: CorpusMathObject[];
  backlinks: string[];
  relations?: CorpusDocumentRelations;
  ast?: LumenDocumentAst;
  routePath?: string;
  frontmatter?: Record<string, unknown>;
  headers?: CorpusHeader[];
}

export interface AnchorResolutionResult {
  resolved: boolean;
  targetDocId?: string;
  anchor?: string;
}

export interface LinkResolutionResult {
  resolved: boolean;
  targetDocId?: string;
}

export interface OutdatedTranslation {
  locale: string;
  canonicalId: string;
}
