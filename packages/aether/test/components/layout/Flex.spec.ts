/**
 * Tests for Flex styled component
 */

import { describe, it, expect } from 'vitest';
import { Flex } from '../../../src/components/layout/Flex.js';

describe('Flex Component', () => {
  it('should be defined', () => {
    expect(Flex).toBeDefined();
  });

  it('should accept gap variant', () => {
    const component = Flex({ gap: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept padding variant', () => {
    const component = Flex({ padding: 'lg', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept wrap variant', () => {
    const component = Flex({ wrap: 'wrap', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept background color variant', () => {
    const component = Flex({ bg: 'primary', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept rounded variant', () => {
    const component = Flex({ rounded: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept direction prop from primitive', () => {
    const component = Flex({ direction: 'column', gap: 'sm', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept align and justify props from primitive', () => {
    const component = Flex({ align: 'center', justify: 'center', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Flex({
      gap: 'md',
      padding: 'sm',
      bg: 'white',
      rounded: 'lg',
      direction: 'row',
      align: 'start',
      children: 'Test',
    });
    expect(component).toBeDefined();
  });
});
