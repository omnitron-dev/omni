/**
 * Tests for cn (class name) utility
 */
import { describe, it, expect } from 'vitest';
import { cn } from '../cn.js';

describe('cn utility', () => {
  it('combines multiple class strings', () => {
    expect(cn('px-4', 'py-2', 'bg-blue-500')).toBe('px-4 py-2 bg-blue-500');
  });

  it('handles conditional classes', () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn('base', isActive && 'active', isDisabled && 'disabled')).toBe('base active');
  });

  it('handles object syntax', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });

  it('handles array syntax', () => {
    expect(cn(['class1', 'class2'], 'class3')).toBe('class1 class2 class3');
  });

  it('handles undefined and null', () => {
    expect(cn('base', undefined, null, 'other')).toBe('base other');
  });

  it('handles empty inputs', () => {
    expect(cn()).toBe('');
    expect(cn('')).toBe('');
  });

  it('handles mixed inputs', () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn('base-class', isActive && 'active', isDisabled && 'disabled', { visible: true, hidden: false }, [
      'extra1',
      'extra2',
    ]);
    expect(result).toBe('base-class active visible extra1 extra2');
  });

  it('handles numeric values', () => {
    expect(cn('class', 0)).toBe('class');
  });

  it('handles nested arrays', () => {
    expect(cn(['a', ['b', 'c']])).toBe('a b c');
  });

  it('filters out falsy values correctly', () => {
    expect(cn('a', false, 'b', null, 'c', undefined, 'd', 0, 'e')).toBe('a b c d e');
  });
});
