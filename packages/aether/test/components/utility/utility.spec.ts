/**
 * Utility Components Test Suite
 *
 * Tests for utility components:
 * - VisuallyHidden
 * - Affix
 */

import { describe, it, expect } from 'vitest';

describe('Utility Components', () => {
  describe('VisuallyHidden', () => {
    it('should export VisuallyHidden component', async () => {
      const { VisuallyHidden } = await import('../../../src/components/utility/VisuallyHidden.js');
      expect(VisuallyHidden).toBeDefined();
    });
  });

  describe('Affix', () => {
    it('should export Affix component', async () => {
      const { Affix } = await import('../../../src/components/utility/Affix.js');
      expect(Affix).toBeDefined();
    });
  });
});
