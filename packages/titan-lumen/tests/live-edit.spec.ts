import { describe, it, expect, vi } from 'vitest';
import { LiveEditService } from '../src/live/live-edit.service.js';

describe('LiveEditService', () => {
  it('validates payloads correctly', () => {
    const service = new LiveEditService();

    expect(service.validatePayload(null).valid).toBe(false);
    expect(service.validatePayload({}).valid).toBe(false);
    expect(service.validatePayload({ docId: 123, patch: 'abc', baseRevision: 0 }).valid).toBe(false);
    expect(service.validatePayload({ docId: 'doc1', patch: 123, baseRevision: 0 }).valid).toBe(false);
    expect(service.validatePayload({ docId: 'doc1', patch: 'abc', baseRevision: -1 }).valid).toBe(false);
    expect(service.validatePayload({ docId: 'doc1', patch: 'abc', baseRevision: 1 }).valid).toBe(true);
  });

  it('handles empty patch as no-op preserving revision and hash', async () => {
    const service = new LiveEditService();
    service.setDocument('doc1', 'Initial text', 5);

    const result = await service.applyEdit({ docId: 'doc1', patch: '', baseRevision: 5 });
    expect(result.success).toBe(true);
    expect(result.revision).toBe(5);
    expect(result.content).toBe('Initial text');
  });

  it('detects revision conflicts when baseRevision does not match', async () => {
    const service = new LiveEditService();
    service.setDocument('doc1', 'Initial text', 2);

    const result = await service.applyEdit({ docId: 'doc1', patch: 'New text', baseRevision: 1 });
    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.revision).toBe(2);
  });

  it('applies patch, increments revision, updates hash, and emits live-edit event', async () => {
    const service = new LiveEditService();
    service.setDocument('doc1', 'Line 1', 1);

    const listener = vi.fn();
    service.on('live-edit', listener);

    const result = await service.applyEdit({
      docId: 'doc1',
      patch: 'Line 2',
      baseRevision: 1,
      author: 'alice',
    });

    expect(result.success).toBe(true);
    expect(result.revision).toBe(2);
    expect(result.content).toContain('Line 1\nLine 2');
    expect(result.hash).toBeDefined();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'doc1',
        revision: 2,
        author: 'alice',
      })
    );
  });
});
