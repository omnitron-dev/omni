import { describe, expect, it } from 'vitest';
import { createDefaultMetadata } from '../../src/types/metadata';

describe('Types', () => {
  describe('Metadata', () => {
    it('should create default metadata', () => {
      const metadata = createDefaultMetadata();

      expect(metadata).toMatchObject({
        scope: 'workspace',
        tags: [],
        labels: {},
        annotations: {},
        source: 'memory',
        owner: 'system',
        isEphemeral: false,
        changeCount: 0,
      });
    });

    it('should override default metadata', () => {
      const metadata = createDefaultMetadata({
        scope: 'global',
        tags: ['test'],
        owner: 'user',
      });

      expect(metadata.scope).toBe('global');
      expect(metadata.tags).toEqual(['test']);
      expect(metadata.owner).toBe('user');
    });
  });
});
