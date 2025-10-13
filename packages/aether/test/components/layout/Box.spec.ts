/**
 * Tests for Box styled component
 */

import { describe, it, expect } from 'vitest';
import { Box } from '../../../src/components/layout/Box.js';

describe('Box Component', () => {
  it('should be defined', () => {
    expect(Box).toBeDefined();
  });

  it('should accept padding variant', () => {
    const component = Box({ padding: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept margin variant', () => {
    const component = Box({ margin: 'lg', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept background color variant', () => {
    const component = Box({ bg: 'primary', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept rounded variant', () => {
    const component = Box({ rounded: 'lg', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept shadow variant', () => {
    const component = Box({ shadow: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Box({
      padding: 'md',
      margin: 'sm',
      bg: 'white',
      rounded: 'md',
      shadow: 'sm',
      children: 'Test',
    });
    expect(component).toBeDefined();
  });

  it('should accept custom class names', () => {
    const component = Box({ class: 'custom-class', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept inline CSS prop', () => {
    const component = Box({ css: { color: 'red' }, children: 'Test' });
    expect(component).toBeDefined();
  });
});
