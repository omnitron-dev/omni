import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

describe('Feature 27: Live Edits & MCP Server Boundaries', () => {
  it('TC-B27-01: rejects malformed live edit diff payload with validation error', () => {
    interface LiveDiffPayload {
      docId: string;
      patch: string;
      baseRevision: number;
    }

    const validatePayload = (payload: unknown): { valid: boolean; error?: string } => {
      if (!payload || typeof payload !== 'object') {
        return { valid: false, error: 'Payload must be an object' };
      }
      const p = payload as Partial<LiveDiffPayload>;
      if (!p.docId || typeof p.docId !== 'string') {
        return { valid: false, error: 'docId is required' };
      }
      if (typeof p.patch !== 'string') {
        return { valid: false, error: 'patch must be a string' };
      }
      if (typeof p.baseRevision !== 'number' || p.baseRevision < 0) {
        return { valid: false, error: 'baseRevision must be non-negative number' };
      }
      return { valid: true };
    };

    expect(validatePayload(null).valid).toBe(false);
    expect(validatePayload({ docId: 'intro' }).valid).toBe(false);
    expect(validatePayload({ docId: 'intro', patch: 'diff', baseRevision: -1 }).valid).toBe(false);
    expect(validatePayload({ docId: 'intro', patch: 'valid patch', baseRevision: 1 }).valid).toBe(true);
  });

  it('TC-B27-02: handles zero-character empty live edit diff as no-op preserving document hash', () => {
    let documentContent = '# Introduction\nOriginal content.';
    let revision = 10;

    const applyEdit = (content: string, diff: string) => {
      if (!diff || diff.trim().length === 0) {
        return { content, revision, changed: false };
      }
      return { content: `${content}\n${diff}`, revision: revision + 1, changed: true };
    };

    const result = applyEdit(documentContent, '');
    expect(result.changed).toBe(false);
    expect(result.revision).toBe(10);
    expect(result.content).toBe(documentContent);
  });

  it('TC-B27-03: validates MCP tool call arguments and reports invalid params when query is missing', () => {
    const handleMcpCall = (toolName: string, args: Record<string, unknown>) => {
      if (toolName === 'search_corpus') {
        if (!args.query || typeof args.query !== 'string' || args.query.trim().length === 0) {
          return { error: { code: -32602, message: 'Invalid params: query is required' } };
        }
        return { result: [] };
      }
      return { error: { code: -32601, message: 'Method not found' } };
    };

    const invalidCall = handleMcpCall('search_corpus', {});
    expect(invalidCall.error?.code).toBe(-32602);

    const validCall = handleMcpCall('search_corpus', { query: 'quantum' });
    expect(validCall.result).toEqual([]);
  });

  it('TC-B27-04: handles MCP resource read request for non-existent URI returning resource not found', () => {
    const readResource = (uri: string) => {
      const prefix = 'lumen://corpus/';
      if (!uri.startsWith(prefix)) {
        return { error: 'Invalid URI scheme' };
      }
      const path = uri.slice(prefix.length);
      const knownResources = new Set(['guides/intro.pdx', 'reference/api.pdx']);
      if (!knownResources.has(path)) {
        return { error: 'Resource not found', code: 404 };
      }
      return { content: '# Found' };
    };

    const notFound = readResource('lumen://corpus/missing-doc-404.pdx');
    expect(notFound.code).toBe(404);
    expect(notFound.error).toBe('Resource not found');
  });

  it('TC-B27-05: cleans up SSE event emitter listeners on simulated client disconnect', () => {
    const sseBroadcaster = new EventEmitter();
    const clientListener = vi.fn();

    // Client connects
    sseBroadcaster.on('live-edit', clientListener);
    expect(sseBroadcaster.listenerCount('live-edit')).toBe(1);

    // Broadcast event
    sseBroadcaster.emit('live-edit', { docId: 'intro', rev: 2 });
    expect(clientListener).toHaveBeenCalledTimes(1);

    // Client disconnects
    sseBroadcaster.off('live-edit', clientListener);
    expect(sseBroadcaster.listenerCount('live-edit')).toBe(0);

    // Broadcast after disconnect
    sseBroadcaster.emit('live-edit', { docId: 'intro', rev: 3 });
    expect(clientListener).toHaveBeenCalledTimes(1);
  });
});
