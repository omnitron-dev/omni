/**
 * Tests for Avatar styled component
 */

import { describe, it, expect } from 'vitest';
import { Avatar } from '../../../src/components/data/Avatar.js';

describe('Avatar Component', () => {
  it('should be defined', () => {
    expect(Avatar).toBeDefined();
  });

  it('should accept size variant', () => {
    const component = Avatar({ size: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept shape prop', () => {
    const component = Avatar({ shape: 'circle', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept ring prop', () => {
    const component = Avatar({ ring: true, children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Avatar({
      size: 'xl',
      shape: 'rounded',
      ring: true,
      children: 'Test',
    });
    expect(component).toBeDefined();
  });

  it('should have sub-components', () => {
    expect((Avatar as any).Image).toBeDefined();
    expect((Avatar as any).Fallback).toBeDefined();
  });

  it('should accept custom class names', () => {
    const component = Avatar({ class: 'custom-class', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept inline CSS prop', () => {
    const component = Avatar({ css: { border: '2px solid red' }, children: 'Test' });
    expect(component).toBeDefined();
  });
});
