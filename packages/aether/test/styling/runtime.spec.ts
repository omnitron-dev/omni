/**
 * Styling Runtime Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createStyleSheet,
  getGlobalSheet,
  injectStyles,
  extractStyles,
  getSSRStyleTags,
  cleanupStyles,
  clearSSRStyles,
  resetStyleIdCounter,
  isServerSide,
  setSSRMode,
} from '../../src/styling/runtime.js';

describe('Styling Runtime', () => {
  beforeEach(() => {
    resetStyleIdCounter();
    clearSSRStyles();
    cleanupStyles();
    setSSRMode(false);
  });

  afterEach(() => {
    cleanupStyles();
  });

  describe('createStyleSheet', () => {
    it('should create a style sheet with unique id', () => {
      const sheet1 = createStyleSheet('test-1');
      const sheet2 = createStyleSheet('test-2');

      expect(sheet1.id).toBeTruthy();
      expect(sheet2.id).toBeTruthy();
      expect(sheet1.id).not.toBe(sheet2.id);
    });

    it('should create style element in DOM', () => {
      const sheet = createStyleSheet('test-sheet');

      expect(sheet.element).toBeTruthy();
      expect(sheet.element?.getAttribute('data-aether')).toBe('test-sheet');
      expect(document.head.contains(sheet.element!)).toBe(true);
    });

    it('should allow custom sheet id', () => {
      const sheet = createStyleSheet('custom-id');

      expect(sheet.id).toBe('custom-id');
    });
  });

  describe('StyleSheet.insert', () => {
    it('should insert basic styles', () => {
      const sheet = createStyleSheet();

      const className = sheet.insert({
        selector: '',
        properties: {
          color: 'red',
          fontSize: 16,
        },
      });

      expect(className).toBeTruthy();
      expect(className).toMatch(/^aether-/);
      expect(sheet.rules.has(className)).toBe(true);
    });

    it('should handle pseudo-selectors', () => {
      const sheet = createStyleSheet();

      const className = sheet.insert({
        selector: `.test`,
        properties: { color: 'red' },
        pseudoSelector: ':hover',
      });

      expect(className).toBeTruthy();
      expect(sheet.rules.has(className)).toBe(true);
    });

    it('should handle media queries', () => {
      const sheet = createStyleSheet();

      const className = sheet.insert({
        selector: '',
        properties: { fontSize: 20 },
        media: '(min-width: 768px)',
      });

      expect(className).toBeTruthy();
      expect(sheet.rules.has(className)).toBe(true);
    });

    it('should deduplicate identical styles', () => {
      const sheet = createStyleSheet();

      const className1 = sheet.insert({
        selector: '',
        properties: { color: 'blue' },
      });

      const className2 = sheet.insert({
        selector: '',
        properties: { color: 'blue' },
      });

      expect(className1).toBe(className2);
    });

    it('should convert camelCase to kebab-case', () => {
      const sheet = createStyleSheet();

      sheet.insert({
        selector: '.test',
        properties: {
          backgroundColor: 'red',
          fontSize: 16,
        },
      });

      const css = sheet.extractCSS();
      expect(css).toContain('background-color');
      expect(css).toContain('font-size');
    });

    it('should add px suffix to numeric values', () => {
      const sheet = createStyleSheet();

      sheet.insert({
        selector: '.test',
        properties: {
          width: 100,
          fontSize: 16,
          opacity: 0.5, // unitless property
        },
      });

      const css = sheet.extractCSS();
      expect(css).toContain('width: 100px');
      expect(css).toContain('font-size: 16px');
      expect(css).toContain('opacity: 0.5'); // no px
    });
  });

  describe('StyleSheet.remove', () => {
    it('should remove a rule', () => {
      const sheet = createStyleSheet();

      const className = sheet.insert({
        selector: '',
        properties: { color: 'red' },
      });

      expect(sheet.rules.has(className)).toBe(true);

      sheet.remove(className);

      expect(sheet.rules.has(className)).toBe(false);
    });
  });

  describe('StyleSheet.clear', () => {
    it('should clear all rules', () => {
      const sheet = createStyleSheet();

      sheet.insert({ selector: '', properties: { color: 'red' } });
      sheet.insert({ selector: '', properties: { color: 'blue' } });

      expect(sheet.rules.size).toBeGreaterThan(0);

      sheet.clear();

      expect(sheet.rules.size).toBe(0);
      expect(sheet.element?.textContent).toBe('');
    });
  });

  describe('StyleSheet.extractCSS', () => {
    it('should extract CSS from rules', () => {
      const sheet = createStyleSheet();

      sheet.insert({
        selector: '.test',
        properties: {
          color: 'red',
          fontSize: 16,
        },
      });

      const css = sheet.extractCSS();

      expect(css).toContain('.test');
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
    });

    it('should extract media queries', () => {
      const sheet = createStyleSheet();

      sheet.insert({
        selector: '.test',
        properties: { fontSize: 20 },
        media: '(min-width: 768px)',
      });

      const css = sheet.extractCSS();

      expect(css).toContain('@media (min-width: 768px)');
      expect(css).toContain('.test');
    });

    it('should extract pseudo-selectors', () => {
      const sheet = createStyleSheet();

      sheet.insert({
        selector: '.test',
        properties: { color: 'blue' },
        pseudoSelector: ':hover',
      });

      const css = sheet.extractCSS();

      expect(css).toContain('.test:hover');
    });
  });

  describe('getGlobalSheet', () => {
    it('should return the same global sheet', () => {
      const sheet1 = getGlobalSheet();
      const sheet2 = getGlobalSheet();

      expect(sheet1).toBe(sheet2);
    });

    it('should have id "aether-global"', () => {
      const sheet = getGlobalSheet();

      expect(sheet.id).toBe('aether-global');
    });
  });

  describe('injectStyles', () => {
    it('should inject styles and return class name', () => {
      const className = injectStyles({
        color: 'red',
        fontSize: 16,
      });

      expect(className).toBeTruthy();
      expect(className).toMatch(/^aether-/);
    });

    it('should handle pseudo-selectors', () => {
      const className = injectStyles(
        { color: 'red' },
        {
          pseudoSelectors: {
            ':hover': { color: 'blue' },
            ':focus': { outline: 'none' },
          },
        }
      );

      expect(className).toBeTruthy();
    });

    it('should handle media queries', () => {
      const className = injectStyles(
        { fontSize: 16 },
        {
          media: '(min-width: 768px)',
        }
      );

      expect(className).toBeTruthy();
    });

    it('should apply nonce if provided', () => {
      const className = injectStyles({ color: 'red' }, { nonce: 'test-nonce' });

      const sheet = getGlobalSheet();
      expect(sheet.element?.getAttribute('nonce')).toBe('test-nonce');
    });
  });

  describe('SSR', () => {
    beforeEach(() => {
      setSSRMode(true);
      clearSSRStyles();
    });

    afterEach(() => {
      setSSRMode(false);
    });

    it('should collect styles during SSR', () => {
      injectStyles({ color: 'red' });
      injectStyles({ fontSize: 16 });

      const css = extractStyles();

      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
    });

    it('should generate style tags for SSR', () => {
      injectStyles({ color: 'blue' });

      const tags = getSSRStyleTags();

      expect(tags).toContain('<style');
      expect(tags).toContain('data-aether="ssr"');
      expect(tags).toContain('color: blue');
    });

    it('should include nonce in SSR style tags', () => {
      injectStyles({ color: 'green' });

      const tags = getSSRStyleTags('test-nonce');

      expect(tags).toContain('nonce="test-nonce"');
    });

    it('should clear SSR styles', () => {
      injectStyles({ color: 'red' });

      expect(extractStyles()).toContain('color: red');

      clearSSRStyles();

      expect(extractStyles()).toBe('');
    });
  });

  describe('cleanupStyles', () => {
    it('should cleanup specific sheet', () => {
      const sheet = createStyleSheet('cleanup-test');

      expect(document.head.contains(sheet.element!)).toBe(true);

      cleanupStyles('cleanup-test');

      expect(document.head.contains(sheet.element!)).toBe(false);
    });

    it('should cleanup all sheets when no id provided', () => {
      const sheet1 = createStyleSheet('sheet1');
      const sheet2 = createStyleSheet('sheet2');

      cleanupStyles();

      expect(document.head.contains(sheet1.element!)).toBe(false);
      expect(document.head.contains(sheet2.element!)).toBe(false);
    });
  });

  describe('isServerSide', () => {
    it('should return false in browser', () => {
      setSSRMode(false);
      expect(isServerSide()).toBe(false);
    });

    it('should return true when SSR mode enabled', () => {
      setSSRMode(true);
      expect(isServerSide()).toBe(true);
    });
  });

  describe('resetStyleIdCounter', () => {
    it('should reset counter to 0', () => {
      injectStyles({ color: 'red' });
      injectStyles({ color: 'blue' });

      resetStyleIdCounter();

      const className = injectStyles({ color: 'green' });

      // After reset, should start from 0 again
      expect(className).toMatch(/aether-0/);
    });
  });
});
