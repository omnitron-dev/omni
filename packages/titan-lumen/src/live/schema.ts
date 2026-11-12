export interface DocumentRow {
  corpus: string;
  path: string;
  revision: number;
  content: string;
  bytes: number;
  hash: string;
  access: string;
  updated: string;
  author: string;
  origin: 'disk' | 'created';
  seed: string;
}

export type RevisionRow = Omit<DocumentRow, 'origin' | 'seed'>;

export interface LumenAuthoringDatabase {
  lumen_documents: DocumentRow;
  lumen_document_revisions: RevisionRow;
}
