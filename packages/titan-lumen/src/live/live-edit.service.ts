import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { LiveEditPayload, LiveEditResult } from '../interfaces.js';

export interface DocumentState {
  docId: string;
  content: string;
  revision: number;
  hash: string;
  updatedAt: number;
}

export class LiveEditService extends EventEmitter {
  private readonly documents = new Map<string, DocumentState>();

  constructor() {
    super();
    this.setMaxListeners(100);
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
    return { valid: true };
  }

  private sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  getDocument(docId: string): DocumentState | undefined {
    return this.documents.get(docId);
  }

  setDocument(docId: string, content: string, revision = 1): DocumentState {
    const state: DocumentState = {
      docId,
      content,
      revision,
      hash: this.sha256(content),
      updatedAt: Date.now(),
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
      return {
        success: false,
        revision: payload?.baseRevision ?? 0,
        error: validation.error,
      };
    }

    let current = this.documents.get(payload.docId);
    if (!current) {
      current = this.setDocument(payload.docId, '', payload.baseRevision);
    }

    // Zero-character / empty diff is treated as no-op preserving document hash and revision
    if (!payload.patch || payload.patch.trim().length === 0) {
      return {
        success: true,
        revision: current.revision,
        hash: current.hash,
        content: current.content,
      };
    }

    // Conflict detection: baseRevision must match current revision
    if (payload.baseRevision !== current.revision) {
      return {
        success: false,
        conflict: true,
        revision: current.revision,
        error: `Conflict: baseRevision ${payload.baseRevision} does not match current ${current.revision}`,
      };
    }

    // Apply patch / append diff
    const newContent = current.content ? `${current.content}\n${payload.patch}` : payload.patch;
    const newRevision = current.revision + 1;
    const newHash = this.sha256(newContent);

    current.content = newContent;
    current.revision = newRevision;
    current.hash = newHash;
    current.updatedAt = Date.now();

    // Broadcast change over event emitter
    this.emit('live-edit', {
      docId: payload.docId,
      revision: newRevision,
      hash: newHash,
      patch: payload.patch,
      author: payload.author,
    });

    return {
      success: true,
      revision: newRevision,
      hash: newHash,
      content: newContent,
    };
  }
}
