import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { Injectable } from '@omnitron-dev/titan';
import { extractDocumentAccess } from '../access/access-filter.service.js';
import type {
  LiveEditEvent,
  LiveEditMode,
  LiveEditPayload,
  LiveEditResult,
  LiveEditServiceOptions,
} from '../types.js';

export const DEFAULT_MAX_LIVE_DOCUMENTS = 500;
export const DEFAULT_MAX_PATCH_BYTES = 262_144; // 256 KiB
export const DEFAULT_MAX_DOCUMENT_BYTES = 2_097_152; // 2 MiB

const VALID_MODES = new Set<LiveEditMode>(['append', 'replace', 'line-range']);

export interface DocumentState {
  docId: string;
  content: string;
  revision: number;
  hash: string;
  updatedAt: number;
  access?: string;
}

@Injectable()
export class LiveEditService extends EventEmitter {
  private readonly documents = new Map<string, DocumentState>();
  private readonly maxDocuments: number;
  private readonly maxPatchBytes: number;
  private readonly maxDocumentBytes: number;

  constructor(options?: LiveEditServiceOptions) {
    super();
    this.maxDocuments = options?.maxDocuments ?? DEFAULT_MAX_LIVE_DOCUMENTS;
    this.maxPatchBytes = options?.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
    this.maxDocumentBytes = options?.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
    this.setMaxListeners(Math.max(200, this.maxDocuments));
  }

  validatePayload(payload: unknown): { valid: boolean; error?: string } {
    if (!payload || typeof payload !== 'object') {
      return { valid: false, error: 'Payload must be an object' };
    }
    const p = payload as Partial<LiveEditPayload>;
    if (!p.docId || typeof p.docId !== 'string') {
      return { valid: false, error: 'docId is required' };
    }
    if (typeof p.patch !== 'string') {
      return { valid: false, error: 'patch must be a string' };
    }
    if (typeof p.baseRevision !== 'number' || p.baseRevision < 0 || !Number.isSafeInteger(p.baseRevision)) {
      return { valid: false, error: 'baseRevision must be non-negative safe integer' };
    }
    if (p.mode !== undefined && !VALID_MODES.has(p.mode)) {
      return { valid: false, error: 'mode must be append, replace, or line-range' };
    }
    if (p.mode === 'line-range') {
      if (typeof p.startLine !== 'number' || !Number.isSafeInteger(p.startLine) || p.startLine < 0) {
        return { valid: false, error: 'startLine must be a non-negative safe integer for line-range mode' };
      }
      if (typeof p.endLine !== 'number' || !Number.isSafeInteger(p.endLine) || p.endLine < p.startLine) {
        return { valid: false, error: 'endLine must be a safe integer >= startLine for line-range mode' };
      }
    }
    return { valid: true };
  }

  private sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private evictOldestIfNeeded(incomingDocId: string): void {
    if (this.maxDocuments <= 0 || this.documents.has(incomingDocId) || this.documents.size < this.maxDocuments) {
      return;
    }

    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, docState] of this.documents.entries()) {
      if (docState.updatedAt < oldestTime) {
        oldestTime = docState.updatedAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.documents.delete(oldestKey);
    }
  }

  getDocumentCount(): number {
    return this.documents.size;
  }

  getDocument(docId: string): DocumentState | undefined {
    return this.documents.get(docId);
  }

  setDocument(docId: string, content: string, revision = 1, access?: string): DocumentState {
    this.evictOldestIfNeeded(docId);
    const resolvedAccess = access ?? extractDocumentAccess(content);
    const state: DocumentState = {
      docId,
      content,
      revision,
      hash: this.sha256(content),
      updatedAt: Date.now(),
      access: resolvedAccess,
    };
    this.documents.set(docId, state);
    return state;
  }

  hasDocument(docId: string): boolean {
    return this.documents.has(docId);
  }

  async applyEdit(payload: LiveEditPayload): Promise<LiveEditResult> {
    const validation = this.validatePayload(payload);
    if (!validation.valid) {
      const fallbackRevision =
        typeof payload?.baseRevision === 'number' &&
        Number.isSafeInteger(payload.baseRevision) &&
        payload.baseRevision >= 0
          ? payload.baseRevision
          : 0;
      return {
        success: false,
        revision: fallbackRevision,
        error: validation.error,
      };
    }

    const existing = this.documents.get(payload.docId);
    const currentRevision = existing ? existing.revision : payload.baseRevision;

    // Enforce maxPatchBytes before mutating state
    const patchBytes = Buffer.byteLength(payload.patch, 'utf8');
    if (patchBytes > this.maxPatchBytes) {
      return {
        success: false,
        revision: currentRevision,
        error: `Patch size (${patchBytes} bytes) exceeds maximum limit of ${this.maxPatchBytes} bytes`,
      };
    }

    const mode: LiveEditMode = payload.mode ?? 'append';

    // Zero-character / whitespace-only diff in append mode is treated as no-op preserving hash and revision
    if (mode === 'append' && (!payload.patch || payload.patch.trim().length === 0)) {
      const current = existing ?? this.setDocument(payload.docId, '', payload.baseRevision, payload.access);
      return {
        success: true,
        revision: current.revision,
        hash: current.hash,
        content: current.content,
      };
    }

    // Conflict detection: baseRevision must match current revision
    if (payload.baseRevision !== currentRevision) {
      return {
        success: false,
        conflict: true,
        revision: currentRevision,
        error: `Conflict: baseRevision ${payload.baseRevision} does not match current ${currentRevision}`,
      };
    }

    const currentContent = existing ? existing.content : '';
    let newContent: string;

    if (mode === 'replace') {
      newContent = payload.patch;
    } else if (mode === 'line-range') {
      const lines = currentContent.length === 0 ? [] : currentContent.split('\n');
      const startLine = payload.startLine ?? 1;
      const endLine = payload.endLine ?? startLine;
      const startIdx = startLine >= 1 ? startLine - 1 : 0;
      const deleteCount = endLine - startLine + 1;
      const clampedStart = Math.min(startIdx, lines.length);
      const replacementLines = payload.patch.split('\n');
      lines.splice(clampedStart, deleteCount, ...replacementLines);
      newContent = lines.join('\n');
    } else {
      newContent = currentContent ? `${currentContent}\n${payload.patch}` : payload.patch;
    }

    // Enforce maxDocumentBytes before committing document state
    const newDocumentBytes = Buffer.byteLength(newContent, 'utf8');
    if (newDocumentBytes > this.maxDocumentBytes) {
      return {
        success: false,
        revision: currentRevision,
        error: `Document size (${newDocumentBytes} bytes) exceeds maximum limit of ${this.maxDocumentBytes} bytes`,
      };
    }

    const resolvedAccess =
      payload.access ??
      (newContent.startsWith('---') ? extractDocumentAccess(newContent) : undefined) ??
      existing?.access ??
      'public';

    const newRevision = currentRevision + 1;
    const newHash = this.sha256(newContent);

    if (existing) {
      existing.content = newContent;
      existing.revision = newRevision;
      existing.hash = newHash;
      existing.updatedAt = Date.now();
      existing.access = resolvedAccess;
    } else {
      this.evictOldestIfNeeded(payload.docId);
      this.documents.set(payload.docId, {
        docId: payload.docId,
        content: newContent,
        revision: newRevision,
        hash: newHash,
        updatedAt: Date.now(),
        access: resolvedAccess,
      });
    }

    const event: LiveEditEvent = {
      docId: payload.docId,
      revision: newRevision,
      hash: newHash,
      patch: payload.patch,
      author: payload.author,
      mode,
      access: resolvedAccess,
    };

    // Broadcast change over event emitter
    this.emit('live-edit', event);

    return {
      success: true,
      revision: newRevision,
      hash: newHash,
      content: newContent,
    };
  }
}
