import { describe, it, expect } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal';
import {
  styles,
  reactiveStyles,
  mergeStyles,
  cssVar,
  cssVars,
  conditionalStyles,
  sizeStyles,
  positionStyles,
  flexStyles,
  gridStyles,
} from '../../../src/utils/styles';

describe('Style Utilities', () => {
  describe('styles', () => {
    it('should create style object from values', () => {
      const result = styles({
        color: 'red',
        fontSize: '16px',
        padding: '10px',
      });

      expect(result).toEqual({
        color: 'red',
        'font-size': '16px',
        padding: '10px',
      });
    });

    it('should handle numeric values', () => {
      const result = styles({
        fontSize: 16,
        padding: 10,
      });

      expect(result).toEqual({
        'font-size': '16',
        padding: '10',
      });
    });

    it('should resolve function values', () => {
      const color = () => 'blue';
      const result = styles({
        color,
      });

      expect(result).toEqual({
        color: 'blue',
      });
    });

    it('should filter out undefined and null values', () => {
      const result = styles({
        color: 'red',
        fontSize: undefined,
        padding: null,
      });

      expect(result).toEqual({
        color: 'red',
      });
    });

    it('should handle CSS custom properties', () => {
      const result = styles({
        '--primary-color': '#007bff',
        '--spacing': '1rem',
      });

      expect(result).toEqual({
        '--primary-color': '#007bff',
        '--spacing': '1rem',
      });
    });

    it('should convert camelCase to kebab-case', () => {
      const result = styles({
        backgroundColor: 'white',
        borderRadius: '4px',
        fontWeight: 'bold',
      });

      expect(result).toEqual({
        'background-color': 'white',
        'border-radius': '4px',
        'font-weight': 'bold',
      });
    });
  });

  describe('reactiveStyles', () => {
    it('should evaluate function to get styles', () => {
      const color = signal('red');
      const result = reactiveStyles(() => ({
        color: color(),
      }));

      expect(result).toEqual({
        color: 'red',
      });
    });
  });

  describe('mergeStyles', () => {
    it('should merge multiple style objects', () => {
      const base = { color: 'red', fontSize: '16px' };
      const overrides = { color: 'blue', padding: '10px' };

      const result = mergeStyles(base, overrides);

      expect(result).toEqual({
        color: 'blue',
        'font-size': '16px',
        padding: '10px',
      });
    });

    it('should filter out undefined and null objects', () => {
      const result = mergeStyles({ color: 'red' }, undefined, { fontSize: '16px' }, null);

      expect(result).toEqual({
        color: 'red',
        'font-size': '16px',
      });
    });
  });

  describe('cssVar', () => {
    it('should create CSS custom property style', () => {
      const result = cssVar('primary-color', '#007bff');

      expect(result).toEqual({
        '--primary-color': '#007bff',
      });
    });

    it('should handle variable names with --', () => {
      const result = cssVar('--theme-color', 'blue');

      expect(result).toEqual({
        '--theme-color': 'blue',
      });
    });

    it('should handle reactive values', () => {
      const color = () => 'green';
      const result = cssVar('color', color);

      expect(result).toEqual({
        '--color': 'green',
      });
    });
  });

  describe('cssVars', () => {
    it('should create multiple CSS custom properties', () => {
      const result = cssVars({
        'primary-color': '#007bff',
        'secondary-color': '#6c757d',
      });

      expect(result).toEqual({
        '--primary-color': '#007bff',
        '--secondary-color': '#6c757d',
      });
    });

    it('should handle reactive values', () => {
      const primary = () => '#007bff';
      const result = cssVars({
        'primary-color': primary,
        spacing: '1rem',
      });

      expect(result).toEqual({
        '--primary-color': '#007bff',
        '--spacing': '1rem',
      });
    });
  });

  describe('conditionalStyles', () => {
    it('should apply true styles when condition is true', () => {
      const result = conditionalStyles(true, { color: 'green', fontWeight: 'bold' }, { color: 'gray' });

      expect(result).toEqual({
        color: 'green',
        'font-weight': 'bold',
      });
    });

    it('should apply false styles when condition is false', () => {
      const result = conditionalStyles(false, { color: 'green', fontWeight: 'bold' }, { color: 'gray' });

      expect(result).toEqual({
        color: 'gray',
      });
    });

    it('should handle function conditions', () => {
      const isActive = () => true;
      const result = conditionalStyles(isActive, { color: 'green' }, { color: 'gray' });

      expect(result).toEqual({
        color: 'green',
      });
    });

    it('should return empty object when false and no false styles', () => {
      const result = conditionalStyles(false, { color: 'green' });

      expect(result).toEqual({});
    });
  });

  describe('sizeStyles', () => {
    it('should create size styles from number', () => {
      const result = sizeStyles(100);

      expect(result).toEqual({
        width: '100',
        height: '100',
      });
    });

    it('should create size styles from string', () => {
      const result = sizeStyles('100px');

      expect(result).toEqual({
        width: '100px',
        height: '100px',
      });
    });

    it('should create size styles from object', () => {
      const result = sizeStyles({ width: 200, height: 100 });

      expect(result).toEqual({
        width: '200',
        height: '100',
      });
    });

    it('should handle function that returns number', () => {
      const getSize = () => 150;
      const result = sizeStyles(getSize);

      expect(result).toEqual({
        width: '150',
        height: '150',
      });
    });
  });

  describe('positionStyles', () => {
    it('should create position styles', () => {
      const result = positionStyles({
        position: 'absolute',
        top: '10px',
        left: '20px',
      });

      expect(result).toEqual({
        position: 'absolute',
        top: '10px',
        left: '20px',
      });
    });

    it('should handle reactive values', () => {
      const top = () => '15px';
      const result = positionStyles({
        position: 'fixed',
        top,
      });

      expect(result).toEqual({
        position: 'fixed',
        top: '15px',
      });
    });
  });

  describe('flexStyles', () => {
    it('should create flexbox styles', () => {
      const result = flexStyles({
        direction: 'row',
        justify: 'center',
        align: 'center',
        gap: '1rem',
      });

      expect(result).toEqual({
        display: 'flex',
        'flex-direction': 'row',
        'justify-content': 'center',
        'align-items': 'center',
        gap: '1rem',
      });
    });

    it('should handle partial config', () => {
      const result = flexStyles({
        direction: 'column',
      });

      expect(result).toEqual({
        display: 'flex',
        'flex-direction': 'column',
      });
    });
  });

  describe('gridStyles', () => {
    it('should create grid styles with numeric columns', () => {
      const result = gridStyles({
        columns: 3,
        gap: '1rem',
      });

      expect(result).toEqual({
        display: 'grid',
        'grid-template-columns': 'repeat(3, 1fr)',
        gap: '1rem',
      });
    });

    it('should handle string columns template', () => {
      const result = gridStyles({
        columns: '200px 1fr 1fr',
        rows: 2,
      });

      expect(result).toEqual({
        display: 'grid',
        'grid-template-columns': '200px 1fr 1fr',
        'grid-template-rows': 'repeat(2, 1fr)',
      });
    });

    it('should handle separate gap values', () => {
      const result = gridStyles({
        columns: 2,
        columnGap: '1rem',
        rowGap: '2rem',
      });

      expect(result).toEqual({
        display: 'grid',
        'grid-template-columns': 'repeat(2, 1fr)',
        'column-gap': '1rem',
        'row-gap': '2rem',
      });
    });
  });

  describe('Integration tests', () => {
    it('should work with reactive signals', () => {
      const color = signal('red');
      const fontSize = signal(16);

      const result = styles({
        color: () => color(),
        fontSize: () => `${fontSize()}px`,
      });

      expect(result).toEqual({
        color: 'red',
        'font-size': '16px',
      });

      color.set('blue');
      fontSize.set(18);

      const result2 = styles({
        color: () => color(),
        fontSize: () => `${fontSize()}px`,
      });

      expect(result2).toEqual({
        color: 'blue',
        'font-size': '18px',
      });
    });

    it('should compose multiple utilities', () => {
      const theme = signal({ primary: '#007bff', spacing: '1rem' });

      const base = styles({
        padding: () => theme().spacing,
      });

      const vars = cssVars({
        'primary-color': () => theme().primary,
      });

      const layout = flexStyles({
        direction: 'column',
        gap: () => theme().spacing,
      });

      const result = mergeStyles(base, vars, layout);

      expect(result).toEqual({
        padding: '1rem',
        '--primary-color': '#007bff',
        display: 'flex',
        'flex-direction': 'column',
        gap: '1rem',
      });
    });
  });
});
