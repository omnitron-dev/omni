/**
 * Interactive Components Test Suite
 *
 * Tests for interactive components:
 * - Accordion, Collapsible, Carousel
 * - Calendar, Toggle, ToggleGroup
 * - Resizable, ScrollArea
 */

import { describe, it, expect } from 'vitest';

describe('Interactive Components', () => {
  describe('Accordion', () => {
    it('should export Accordion component', async () => {
      const { Accordion } = await import('../../../src/components/interactive/Accordion.js');
      expect(Accordion).toBeDefined();
    });
  });

  describe('Collapsible', () => {
    it('should export Collapsible component', async () => {
      const { Collapsible } = await import('../../../src/components/interactive/Collapsible.js');
      expect(Collapsible).toBeDefined();
    });
  });

  describe('Carousel', () => {
    it('should export Carousel component', async () => {
      const { Carousel } = await import('../../../src/components/interactive/Carousel.js');
      expect(Carousel).toBeDefined();
    });
  });

  describe('Calendar', () => {
    it('should export Calendar component', async () => {
      const { Calendar } = await import('../../../src/components/interactive/Calendar.js');
      expect(Calendar).toBeDefined();
    });
  });

  describe('Toggle', () => {
    it('should export Toggle component', async () => {
      const { Toggle } = await import('../../../src/components/interactive/Toggle.js');
      expect(Toggle).toBeDefined();
    });
  });

  describe('ToggleGroup', () => {
    it('should export ToggleGroup component', async () => {
      const { ToggleGroup } = await import('../../../src/components/interactive/ToggleGroup.js');
      expect(ToggleGroup).toBeDefined();
    });
  });

  describe('Resizable', () => {
    it('should export Resizable component', async () => {
      const { Resizable } = await import('../../../src/components/interactive/Resizable.js');
      expect(Resizable).toBeDefined();
    });
  });

  describe('ScrollArea', () => {
    it('should export ScrollArea component', async () => {
      const { ScrollArea } = await import('../../../src/components/interactive/ScrollArea.js');
      expect(ScrollArea).toBeDefined();
    });
  });
});
