import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { Injectable } from '@omnitron-dev/titan';
import { Errors } from '@omnitron-dev/titan/errors';
import { withTransactionRetry, type DatabaseManager, type Kysely, type Transaction } from '@omnitron-dev/titan-database';
import { AccessFilterService, extractDocumentAccess } from '../access/access-filter.service.js';
import type { LiveEditActor, LiveEditEvent, LiveEditMode, LiveEditPayload, LiveEditResult, LiveEditServiceOptions } from '../types.js';
import type { DocumentRow, LumenAuthoringDatabase, RevisionRow } from './schema.js';
import { isCanonicalDocumentPath } from '../corpus-files.js';

export const DEFAULT_MAX_PATCH_BYTES = 262_144;
export const DEFAULT_MAX_DOCUMENT_BYTES = 2_097_152;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_CORPUS_BYTES = 64 * 1024 * 1024;
const MAX_CORPUS_ENTRIES = 10_000;
const VALID_MODES = new Set<LiveEditMode>(['append', 'replace', 'line-range']);
const PAYLOAD_KEYS = new Set(['docId', 'patch', 'baseRevision', 'baseHash', 'mode', 'startLine', 'endLine']);
const DOCUMENT_EXTENSIONS = new Set(['.pdx', '.md', '.mdx']);

export interface DocumentState {
  docId: string;
  content: string;
  revision: number;
  hash: string;
  updatedAt: number;
  access: string;
  byteLength: number;
  author: string;
  origin: 'disk' | 'created';
  seedHash: string;
}
export type DocumentRevision = Omit<DocumentState, 'origin' | 'seedHash'>;

function sha256(content: string): string { return createHash('sha256').update(content).digest('hex'); }
function validPath(path: unknown): path is string {
  return isCanonicalDocumentPath(path, DOCUMENT_EXTENSIONS) && extname(path) !== '';
}
function bounded(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum)
    throw new RangeError(label + ' must be between 1 and ' + maximum);
  return resolved;
}
function asRevision(row: RevisionRow): DocumentRevision {
  const revision = Number(row.revision), bytes = Number(row.bytes);
  if (typeof row.content !== 'string' || !Number.isSafeInteger(revision) || revision < 0 ||
    !Number.isSafeInteger(bytes) || bytes !== Buffer.byteLength(row.content) || row.hash !== sha256(row.content))
    throw new Error('Lumen authoring revision integrity check failed');
  return { docId: row.path, content: row.content, revision, hash: row.hash,
    updatedAt: Date.parse(row.updated), access: row.access, byteLength: bytes, author: row.author };
}
function asDocument(row: DocumentRow): DocumentState { return { ...asRevision(row), origin: row.origin, seedHash: row.seed }; }
function historyRow(row: DocumentRow): RevisionRow {
  const { origin: _origin, seed: _seed, ...revision } = row;
  return revision;
}

/** Durable, corpus-scoped authoring. DatabaseManager owns every connection and transaction. */
@Injectable()
export class LiveEditService extends EventEmitter {
  private readonly options?: Readonly<LiveEditServiceOptions>;
  private readonly maxPatchBytes: number;
  private readonly maxDocumentBytes: number;
  private readonly accessFilter: AccessFilterService;

  constructor(options?: LiveEditServiceOptions, private readonly database?: DatabaseManager, accessFilter?: AccessFilterService) {
    super();
    if (options && (typeof options.corpusId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.corpusId)))
      throw new Error('Live editing requires a stable corpusId (1–128 characters)');
    this.options = options && Object.freeze({ ...options });
    this.maxPatchBytes = bounded(options?.maxPatchBytes, DEFAULT_MAX_PATCH_BYTES, MAX_DOCUMENT_BYTES, 'maxPatchBytes');
    this.maxDocumentBytes = bounded(options?.maxDocumentBytes, DEFAULT_MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES, 'maxDocumentBytes');
    this.accessFilter = accessFilter ?? new AccessFilterService();
  }

  isEnabled(): boolean { return this.options !== undefined; }

  private async connection(): Promise<Kysely<LumenAuthoringDatabase>> {
    if (!this.options) throw Errors.unavailable('Live editing is not configured');
    if (!this.database) throw Errors.unavailable('Live editing requires TitanDatabaseModule');
    const dialect = this.database.getDialect(this.options.connectionName);
    if (dialect !== 'postgres' && dialect !== 'sqlite')
      throw Errors.unavailable('Lumen authoring requires a configured PostgreSQL or SQLite connection');
    const pool = this.database.getPool(this.options.connectionName);
    if (dialect === 'sqlite' && pool && 'memory' in pool && pool.memory)
      throw Errors.unavailable('Durable authoring requires file-backed SQLite, not an in-memory database');
    return this.database.getConnection<LumenAuthoringDatabase>(this.options.connectionName);
  }

  validatePayload(payload: unknown): { valid: boolean; error?: string } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { valid: false, error: 'Payload must be an object' };
    const p = payload as Partial<LiveEditPayload>;
    if (Object.keys(p).some(key => !PAYLOAD_KEYS.has(key)))
      return { valid: false, error: 'Unknown edit field; identity and access come from the server and document' };
    if (!validPath(p.docId)) return { valid: false, error: 'docId must be a canonical relative .pdx, .md or .mdx path' };
    if (typeof p.patch !== 'string') return { valid: false, error: 'patch must be a string' };
    if (!p.patch.isWellFormed()) return { valid: false, error: 'patch must be well-formed Unicode' };
    if (!Number.isSafeInteger(p.baseRevision) || p.baseRevision! < 0 || p.baseRevision! >= Number.MAX_SAFE_INTEGER)
      return { valid: false, error: 'baseRevision must be a non-negative revision below Number.MAX_SAFE_INTEGER' };
    if (typeof p.baseHash !== 'string' || !/^[0-9a-f]{64}$/.test(p.baseHash)) return { valid: false, error: 'baseHash must be the SHA-256 of the editor revision' };
    if (p.mode !== undefined && !VALID_MODES.has(p.mode)) return { valid: false, error: 'mode must be append, replace, or line-range' };
    if (p.mode === 'line-range' && (!Number.isSafeInteger(p.startLine) || p.startLine! < 1 ||
      !Number.isSafeInteger(p.endLine) || p.endLine! < p.startLine!))
      return { valid: false, error: 'line-range requires one-based startLine and endLine >= startLine' };
    return { valid: true };
  }

  private authorize(content: string, actor: LiveEditActor): string {
    if (!actor || typeof actor.userId !== 'string' || !actor.userId || actor.userId.length > 256 ||
      !Array.isArray(actor.roles) || actor.roles.some(role => typeof role !== 'string'))
      throw Errors.unauthorized('An authenticated author is required');
    const access = extractDocumentAccess(content);
    const projected = this.accessFilter.projectContent(content, [...actor.roles], access);
    if (!projected.allowed || projected.strippedAny)
      throw Errors.forbidden('The author must have access to every section of both document versions');
    return access;
  }

  async getDocument(docId: string): Promise<DocumentState | undefined> {
    if (!validPath(docId)) throw new Error('Invalid canonical document path');
    const db = await this.connection();
    const row = await db.selectFrom('lumen_documents').selectAll().where('corpus', '=', this.options!.corpusId)
      .where('path', '=', docId).executeTakeFirst();
    return row && asDocument(row);
  }

  /** Check size in the same snapshot before loading any document content. */
  async readCorpus(limits: { maxEntries?: number; maxBytes?: number } = {}): Promise<DocumentState[]> {
    const maxEntries = bounded(limits.maxEntries, MAX_CORPUS_ENTRIES, MAX_CORPUS_ENTRIES, 'maxEntries');
    const maxBytes = bounded(limits.maxBytes, MAX_CORPUS_BYTES, MAX_CORPUS_BYTES, 'maxBytes');
    const db = await this.connection();
    return db.transaction().setIsolationLevel('serializable').execute(async transaction => {
      const sizes = await transaction.selectFrom('lumen_documents').where('corpus', '=', this.options!.corpusId)
        .select(({ fn }) => [fn.countAll().as('entries'), fn.sum('bytes').as('bytes')]).executeTakeFirstOrThrow();
      const entries = Number(sizes.entries), bytes = Number(sizes.bytes ?? 0);
      if (!Number.isSafeInteger(entries) || entries < 0 || !Number.isSafeInteger(bytes) || bytes < 0)
        throw new Error('Lumen authoring inventory metadata is invalid');
      if (entries > maxEntries || bytes > maxBytes)
        throw new Error('Lumen authoring corpus exceeds the configured inventory budget');
      const rows = await transaction.selectFrom('lumen_documents').selectAll().where('corpus', '=', this.options!.corpusId)
        .orderBy('path').limit(maxEntries).execute();
      return rows.map(asDocument);
    });
  }

  async getHistory(docId: string, actor: LiveEditActor, options: { beforeRevision?: number; limit?: number; maxBytes?: number } = {}): Promise<DocumentRevision[]> {
    if (!validPath(docId)) throw new Error('Invalid canonical document path');
    const limit = bounded(options.limit, 50, 100, 'history limit');
    const maxBytes = bounded(options.maxBytes, 8 * 1024 * 1024, MAX_CORPUS_BYTES, 'history maxBytes');
    const before = options.beforeRevision ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before) || before < 1) throw new RangeError('beforeRevision must be positive');
    const db = await this.connection();
    return db.transaction().setIsolationLevel('serializable').execute(async transaction => {
      const current = await transaction.selectFrom('lumen_documents').selectAll().where('corpus', '=', this.options!.corpusId)
        .where('path', '=', docId).executeTakeFirst();
      if (!current) return [];
      asDocument(current);
      this.authorize(current.content, actor);
      const metadata = await transaction.selectFrom('lumen_document_revisions').select(['revision', 'bytes'])
        .where('corpus', '=', this.options!.corpusId).where('path', '=', docId).where('revision', '<', before)
        .orderBy('revision', 'desc').limit(limit).execute();
      if (metadata.some(row => !Number.isSafeInteger(Number(row.bytes)) || Number(row.bytes) < 0))
        throw new Error('Lumen revision history metadata is invalid');
      if (metadata.reduce((sum, row) => sum + Number(row.bytes), 0) > maxBytes)
        throw new Error('Lumen revision history exceeds the configured byte budget');
      if (!metadata.length) return [];
      const rows = await transaction.selectFrom('lumen_document_revisions').selectAll()
        .where('corpus', '=', this.options!.corpusId).where('path', '=', docId)
        .where('revision', 'in', metadata.map(row => Number(row.revision))).orderBy('revision', 'desc').execute();
      const revisions = rows.map(asRevision);
      for (const revision of revisions) this.authorize(revision.content, actor);
      return revisions;
    });
  }

  private async conflict(transaction: Transaction<LumenAuthoringDatabase>, docId: string, actor: LiveEditActor): Promise<LiveEditResult> {
    const current = await transaction.selectFrom('lumen_documents').selectAll().where('corpus', '=', this.options!.corpusId)
      .where('path', '=', docId).executeTakeFirst();
    if (current) { asDocument(current); this.authorize(current.content, actor); }
    return { success: false, conflict: true, revision: Number(current?.revision ?? 0), error: 'Document revision changed; reload before editing' };
  }

  async applyEdit(payload: LiveEditPayload, actor: LiveEditActor, initialContent?: string): Promise<LiveEditResult> {
    const validation = this.validatePayload(payload);
    if (!validation.valid) return { success: false, revision: 0, error: validation.error };
    const db = await this.connection();
    if (Buffer.byteLength(payload.patch) > this.maxPatchBytes)
      return { success: false, revision: payload.baseRevision, error: 'Patch exceeds ' + this.maxPatchBytes + ' bytes' };
    const { event, ...result } = await withTransactionRetry(db, async (transaction): Promise<LiveEditResult & { event?: LiveEditEvent }> => {
      const existing = await transaction.selectFrom('lumen_documents').selectAll().where('corpus', '=', this.options!.corpusId)
        .where('path', '=', payload.docId).executeTakeFirst();
      if (existing) asDocument(existing);
      const content = existing?.content ?? initialContent ?? '';
      const oldAccess = this.authorize(content, actor);
      if (Buffer.byteLength(content) > this.maxDocumentBytes) throw new Error('Source document exceeds ' + this.maxDocumentBytes + ' bytes');
      if (payload.baseRevision !== Number(existing?.revision ?? 0) || payload.baseHash !== (existing?.hash ?? sha256(content)))
        return this.conflict(transaction, payload.docId, actor);
      const mode = payload.mode ?? 'append';
      let next: string;
      if (mode === 'replace') next = payload.patch;
      else if (mode === 'line-range') {
        const lines = content.split('\n');
        if (payload.startLine! > lines.length || payload.endLine! > lines.length)
          return { success: false, revision: payload.baseRevision, error: 'Line range is outside the current document' };
        lines.splice(payload.startLine! - 1, payload.endLine! - payload.startLine! + 1, ...payload.patch.split('\n'));
        next = lines.join('\n');
      } else next = payload.patch === '' ? content : content ? content + '\n' + payload.patch : payload.patch;
      const bytes = Buffer.byteLength(next);
      if (bytes > this.maxDocumentBytes) return { success: false, revision: payload.baseRevision, error: 'Document exceeds ' + this.maxDocumentBytes + ' bytes' };
      const access = this.authorize(next, actor);
      if (existing && next === content)
        return { success: true, revision: Number(existing.revision), hash: existing.hash, content };
      const row: DocumentRow = {
        corpus: this.options!.corpusId, path: payload.docId, revision: payload.baseRevision + 1,
        content: next, bytes, hash: sha256(next), access, updated: new Date().toISOString(), author: actor.userId,
        origin: existing?.origin ?? (initialContent === undefined ? 'created' : 'disk'), seed: existing?.seed ?? sha256(content),
      };
      if (existing) {
        const updated = await transaction.updateTable('lumen_documents').set(row).where('corpus', '=', row.corpus)
          .where('path', '=', row.path).where('revision', '=', payload.baseRevision).where('hash', '=', payload.baseHash)
          .returning('revision').executeTakeFirst();
        if (!updated) return this.conflict(transaction, payload.docId, actor);
      } else {
        const inserted = await transaction.insertInto('lumen_documents').values(row)
          .onConflict(conflict => conflict.columns(['corpus', 'path']).doNothing()).returning('revision').executeTakeFirst();
        if (!inserted) return this.conflict(transaction, payload.docId, actor);
        await transaction.insertInto('lumen_document_revisions').values({
          ...historyRow(row), revision: 0, content, access: oldAccess, bytes: Buffer.byteLength(content), hash: row.seed,
        }).execute();
      }
      await transaction.insertInto('lumen_document_revisions').values(historyRow(row)).execute();
      return { success: true, revision: row.revision, hash: row.hash, content: row.content,
        event: { docId: row.path, revision: row.revision, hash: row.hash, patch: payload.patch, author: actor.userId, mode, access } };
    }, { maxAttempts: 4, delayMs: 4, maxDelayMs: 16 });
    if (event) {
      // Notification failure cannot undo a durable commit or pretend it did not occur.
      try { this.emit('live-edit', event); }
      catch (error) { this.database!.logger.error({ error, docId: event.docId, revision: event.revision }, 'A committed Lumen edit could not notify a listener'); }
    }
    return result;
  }
}
