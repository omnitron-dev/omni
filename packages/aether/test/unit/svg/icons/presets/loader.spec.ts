/**
 * Tests for HugeIcons loader utilities
 */

import { describe, it, expect } from 'vitest';
import { loadIconPreset, loadIcon } from '../utils/loader.js';

describe('HugeIcons Loader', () => {
  describe('loadIconPreset', () => {
    it('should load stroke preset', async () => {
      const icons = await loadIconPreset('stroke');
      expect(icons).toBeDefined();
      expect(Object.keys(icons).length).toBeGreaterThan(0);
    });

    it('should load duotone preset', async () => {
      const icons = await loadIconPreset('duotone');
      expect(icons).toBeDefined();
      expect(Object.keys(icons).length).toBeGreaterThan(0);
    });

    it('should load twotone preset', async () => {
      const icons = await loadIconPreset('twotone');
      expect(icons).toBeDefined();
      expect(Object.keys(icons).length).toBeGreaterThan(0);
    });

    it('should throw error for invalid preset', async () => {
      await expect(loadIconPreset('invalid' as any)).rejects.toThrow();
    });
  });

  describe('loadIcon', () => {
    it('should load a specific icon from stroke preset', async () => {
      const icon = await loadIcon('stroke', 'abacus');
      expect(icon).toBeDefined();
      expect(icon.id).toBe('abacus');
      expect(icon.metadata?.preset).toBe('stroke');
    });

    it('should load a specific icon from duotone preset', async () => {
      const icon = await loadIcon('duotone', 'abacus');
      expect(icon).toBeDefined();
      expect(icon.id).toBe('abacus');
      expect(icon.metadata?.preset).toBe('duotone');
    });

    it('should load a specific icon from twotone preset', async () => {
      const icon = await loadIcon('twotone', 'abacus');
      expect(icon).toBeDefined();
      expect(icon.id).toBe('abacus');
      expect(icon.metadata?.preset).toBe('twotone');
    });

    it('should throw error for non-existent icon', async () => {
      await expect(loadIcon('stroke', 'non-existent-icon-xyz')).rejects.toThrow();
    });
  });
});
