/**
 * Tests for Card styled component
 */

import { describe, it, expect } from 'vitest';
import { Card } from '../../../src/components/data/Card.js';

describe('Card Component', () => {
  it('should be defined', () => {
    expect(Card).toBeDefined();
  });

  it('should accept padding variant', () => {
    const component = Card({ padding: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept variant prop', () => {
    const component = Card({ variant: 'elevated', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept hoverable prop', () => {
    const component = Card({ hoverable: true, children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Card({
      padding: 'lg',
      variant: 'outline',
      hoverable: true,
      children: 'Test',
    });
    expect(component).toBeDefined();
  });

  it('should have sub-components', () => {
    expect((Card as any).Header).toBeDefined();
    expect((Card as any).Title).toBeDefined();
    expect((Card as any).Description).toBeDefined();
    expect((Card as any).Content).toBeDefined();
    expect((Card as any).Footer).toBeDefined();
  });

  it('should accept custom class names', () => {
    const component = Card({ class: 'custom-class', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept inline CSS prop', () => {
    const component = Card({ css: { backgroundColor: 'blue' }, children: 'Test' });
    expect(component).toBeDefined();
  });
});
