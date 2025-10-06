/**
 * ID Generation Utilities Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateId, useId, createIdGenerator } from '../../../../src/primitives/utils/id.js';

describe('ID Generation Utilities', () => {
  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      const id3 = generateId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should use default prefix "aether"', () => {
      const id = generateId();
      expect(id).toMatch(/^aether-\d+$/);
    });

    it('should use custom prefix when provided', () => {
      const id1 = generateId('dialog');
      const id2 = generateId('tooltip');
      const id3 = generateId('menu');

      expect(id1).toMatch(/^dialog-\d+$/);
      expect(id2).toMatch(/^tooltip-\d+$/);
      expect(id3).toMatch(/^menu-\d+$/);
    });

    it('should increment counter for each call', () => {
      const id1 = generateId('test');
      const id2 = generateId('test');
      const id3 = generateId('test');

      // Extract numeric parts
      const num1 = parseInt(id1.split('-')[1]);
      const num2 = parseInt(id2.split('-')[1]);
      const num3 = parseInt(id3.split('-')[1]);

      expect(num2).toBe(num1 + 1);
      expect(num3).toBe(num2 + 1);
    });
  });

  describe('useId', () => {
    it('should generate ID with component name', () => {
      const id = useId('MyComponent');
      expect(id).toMatch(/^MyComponent-\d+$/);
    });

    it('should append suffix when provided', () => {
      const id = useId('Dialog', 'trigger');
      expect(id).toMatch(/^Dialog-\d+-trigger$/);
    });

    it('should not append suffix when not provided', () => {
      const id = useId('Button');
      expect(id).toMatch(/^Button-\d+$/);
      expect(id).not.toContain('undefined');
    });

    it('should generate unique IDs for same component', () => {
      const id1 = useId('Input');
      const id2 = useId('Input');
      const id3 = useId('Input');

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
    });

    it('should handle different suffixes', () => {
      const id1 = useId('Form', 'name');
      const id2 = useId('Form', 'email');
      const id3 = useId('Form', 'submit');

      expect(id1).toMatch(/-name$/);
      expect(id2).toMatch(/-email$/);
      expect(id3).toMatch(/-submit$/);
    });
  });

  describe('createIdGenerator', () => {
    it('should create generator with fixed base ID', () => {
      const generate = createIdGenerator('modal-123');

      const id1 = generate('title');
      const id2 = generate('description');
      const id3 = generate('close');

      expect(id1).toBe('modal-123-title');
      expect(id2).toBe('modal-123-description');
      expect(id3).toBe('modal-123-close');
    });

    it('should return consistent IDs for same suffix', () => {
      const generate = createIdGenerator('accordion-456');

      const id1 = generate('header');
      const id2 = generate('header');

      expect(id1).toBe(id2);
      expect(id1).toBe('accordion-456-header');
    });

    it('should work with numeric base IDs', () => {
      const generate = createIdGenerator('item-999');

      const id = generate('label');
      expect(id).toBe('item-999-label');
    });

    it('should handle empty suffix', () => {
      const generate = createIdGenerator('base');

      const id = generate('');
      expect(id).toBe('base-');
    });

    it('should allow multiple generators with different base IDs', () => {
      const gen1 = createIdGenerator('dialog-1');
      const gen2 = createIdGenerator('dialog-2');

      const id1 = gen1('content');
      const id2 = gen2('content');

      expect(id1).toBe('dialog-1-content');
      expect(id2).toBe('dialog-2-content');
      expect(id1).not.toBe(id2);
    });
  });

  describe('Integration', () => {
    it('should work together for component ID management', () => {
      // Create base ID
      const baseId = generateId('dropdown');

      // Create generator
      const getId = createIdGenerator(baseId);

      // Generate related IDs
      const triggerId = getId('trigger');
      const menuId = getId('menu');
      const itemId = getId('item-1');

      expect(triggerId).toMatch(/^dropdown-\d+-trigger$/);
      expect(menuId).toMatch(/^dropdown-\d+-menu$/);
      expect(itemId).toMatch(/^dropdown-\d+-item-1$/);

      // All should share same base
      const base = baseId;
      expect(triggerId).toContain(base);
      expect(menuId).toContain(base);
      expect(itemId).toContain(base);
    });
  });
});
