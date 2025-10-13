/**
 * Tests for Grid styled component
 */

import { describe, it, expect } from 'vitest';
import { Grid } from '../../../src/components/layout/Grid.js';

describe('Grid Component', () => {
  it('should be defined', () => {
    expect(Grid).toBeDefined();
  });

  it('should accept gap variant', () => {
    const component = Grid({ gap: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept padding variant', () => {
    const component = Grid({ padding: 'lg', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept columns variant', () => {
    const component = Grid({ columns: 3, children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept background color variant', () => {
    const component = Grid({ bg: 'gray', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept rounded variant', () => {
    const component = Grid({ rounded: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept template props from primitive', () => {
    const component = Grid({ templateColumns: 'repeat(3, 1fr)', gap: 'sm', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Grid({
      gap: 'lg',
      padding: 'md',
      columns: 4,
      bg: 'white',
      rounded: 'sm',
      children: 'Test',
    });
    expect(component).toBeDefined();
  });
});
