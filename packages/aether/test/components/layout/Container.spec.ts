/**
 * Tests for Container styled component
 */

import { describe, it, expect } from 'vitest';
import { Container } from '../../../src/components/layout/Container.js';

describe('Container Component', () => {
  it('should be defined', () => {
    expect(Container).toBeDefined();
  });

  it('should accept padding variant', () => {
    const component = Container({ padding: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept background color variant', () => {
    const component = Container({ bg: 'white', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept shadow variant', () => {
    const component = Container({ shadow: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept size prop from primitive', () => {
    const component = Container({ size: 'lg', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept fluid prop from primitive', () => {
    const component = Container({ fluid: true, children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Container({
      padding: 'xl',
      bg: 'gray',
      shadow: 'lg',
      size: 'md',
      children: 'Test',
    });
    expect(component).toBeDefined();
  });
});
