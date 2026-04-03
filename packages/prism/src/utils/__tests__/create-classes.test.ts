/**
 * Tests for create-classes utility
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createClasses,
  createClassesObject,
  createComponentClasses,
  setClassPrefix,
  getClassPrefix,
  DEFAULT_CLASS_PREFIX,
} from '../create-classes.js';

describe('create-classes', () => {
  beforeEach(() => {
    // Reset to default prefix before each test
    setClassPrefix(DEFAULT_CLASS_PREFIX);
  });

  describe('createClasses', () => {
    it('creates prefixed class name with default prefix', () => {
      expect(createClasses('button__root')).toBe('prism__button__root');
    });

    it('creates prefixed class name with custom prefix', () => {
      setClassPrefix('my-app');
      expect(createClasses('button__root')).toBe('my-app__button__root');
    });

    it('handles nested class names', () => {
      expect(createClasses('chart__loading__spinner')).toBe('prism__chart__loading__spinner');
    });

    it('handles empty string', () => {
      expect(createClasses('')).toBe('prism__');
    });
  });

  describe('createClassesObject', () => {
    it('creates object with prefixed class names', () => {
      const classes = createClassesObject(['root', 'label', 'icon'] as const);
      expect(classes).toEqual({
        root: 'prism__root',
        label: 'prism__label',
        icon: 'prism__icon',
      });
    });

    it('creates empty object for empty array', () => {
      const classes = createClassesObject([]);
      expect(classes).toEqual({});
    });

    it('respects custom prefix', () => {
      setClassPrefix('custom');
      const classes = createClassesObject(['root'] as const);
      expect(classes.root).toBe('custom__root');
    });
  });

  describe('createComponentClasses', () => {
    it('creates component class factory', () => {
      const chartClass = createComponentClasses('chart');
      expect(chartClass('root')).toBe('prism__chart__root');
      expect(chartClass('loading')).toBe('prism__chart__loading');
    });

    it('works with custom prefix', () => {
      setClassPrefix('app');
      const buttonClass = createComponentClasses('button');
      expect(buttonClass('primary')).toBe('app__button__primary');
    });
  });

  describe('setClassPrefix/getClassPrefix', () => {
    it('sets and gets custom prefix', () => {
      setClassPrefix('my-prefix');
      expect(getClassPrefix()).toBe('my-prefix');
    });

    it('default prefix is correct', () => {
      expect(getClassPrefix()).toBe('prism');
    });
  });
});
