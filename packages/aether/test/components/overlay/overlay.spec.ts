/**
 * Overlay Components Test Suite
 *
 * Tests for overlay components:
 * - Dialog, AlertDialog, Drawer, Sheet
 * - Popover, HoverCard, Tooltip
 * - ContextMenu, DropdownMenu, CommandPalette, Popconfirm
 */

import { describe, it, expect } from 'vitest';

describe('Overlay Components', () => {
  describe('Dialog', () => {
    it('should export Dialog component', async () => {
      const { Dialog } = await import('../../../src/components/overlay/Dialog.js');
      expect(Dialog).toBeDefined();
    });
  });

  describe('AlertDialog', () => {
    it('should export AlertDialog component', async () => {
      const { AlertDialog } = await import('../../../src/components/overlay/AlertDialog.js');
      expect(AlertDialog).toBeDefined();
    });
  });

  describe('Drawer', () => {
    it('should export Drawer component', async () => {
      const { Drawer } = await import('../../../src/components/overlay/Drawer.js');
      expect(Drawer).toBeDefined();
    });
  });

  describe('Sheet', () => {
    it('should export Sheet component', async () => {
      const { Sheet } = await import('../../../src/components/overlay/Sheet.js');
      expect(Sheet).toBeDefined();
    });
  });

  describe('Popover', () => {
    it('should export Popover component', async () => {
      const { Popover } = await import('../../../src/components/overlay/Popover.js');
      expect(Popover).toBeDefined();
    });
  });

  describe('HoverCard', () => {
    it('should export HoverCard component', async () => {
      const { HoverCard } = await import('../../../src/components/overlay/HoverCard.js');
      expect(HoverCard).toBeDefined();
    });
  });

  describe('Tooltip', () => {
    it('should export Tooltip component', async () => {
      const { Tooltip } = await import('../../../src/components/overlay/Tooltip.js');
      expect(Tooltip).toBeDefined();
    });
  });

  describe('ContextMenu', () => {
    it('should export ContextMenu component', async () => {
      const { ContextMenu } = await import('../../../src/components/overlay/ContextMenu.js');
      expect(ContextMenu).toBeDefined();
    });
  });

  describe('DropdownMenu', () => {
    it('should export DropdownMenu component', async () => {
      const { DropdownMenu } = await import('../../../src/components/overlay/DropdownMenu.js');
      expect(DropdownMenu).toBeDefined();
    });
  });

  describe('CommandPalette', () => {
    it('should export CommandPalette component', async () => {
      const { CommandPalette } = await import('../../../src/components/overlay/CommandPalette.js');
      expect(CommandPalette).toBeDefined();
    });
  });

  describe('Popconfirm', () => {
    it('should export Popconfirm component', async () => {
      const { Popconfirm } = await import('../../../src/components/overlay/Popconfirm.js');
      expect(Popconfirm).toBeDefined();
    });
  });
});
