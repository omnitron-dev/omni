/**
 * Navigation Components Test Suite
 *
 * Tests for navigation components:
 * - Tabs, Breadcrumb, Pagination
 * - NavigationMenu, Menubar, Toolbar
 */

import { describe, it, expect } from 'vitest';

describe('Navigation Components', () => {
  describe('Tabs', () => {
    it('should export Tabs component', async () => {
      const { Tabs } = await import('../../../src/components/navigation/Tabs.js');
      expect(Tabs).toBeDefined();
    });
  });

  describe('Breadcrumb', () => {
    it('should export Breadcrumb component', async () => {
      const { Breadcrumb } = await import('../../../src/components/navigation/Breadcrumb.js');
      expect(Breadcrumb).toBeDefined();
    });
  });

  describe('Pagination', () => {
    it('should export Pagination component', async () => {
      const { Pagination } = await import('../../../src/components/navigation/Pagination.js');
      expect(Pagination).toBeDefined();
    });
  });

  describe('NavigationMenu', () => {
    it('should export NavigationMenu component', async () => {
      const { NavigationMenu } = await import('../../../src/components/navigation/NavigationMenu.js');
      expect(NavigationMenu).toBeDefined();
    });
  });

  describe('Menubar', () => {
    it('should export Menubar component', async () => {
      const { Menubar } = await import('../../../src/components/navigation/Menubar.js');
      expect(Menubar).toBeDefined();
    });
  });

  describe('Toolbar', () => {
    it('should export Toolbar component', async () => {
      const { Toolbar } = await import('../../../src/components/navigation/Toolbar.js');
      expect(Toolbar).toBeDefined();
    });
  });
});
