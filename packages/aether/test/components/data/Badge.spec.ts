/**
 * Tests for Badge styled component
 */

import { describe, it, expect } from 'vitest';
import { Badge } from '../../../src/components/data/Badge.js';

describe('Badge Component', () => {
  it('should be defined', () => {
    expect(Badge).toBeDefined();
  });

  it('should accept size variant', () => {
    const component = Badge({ size: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept variant prop', () => {
    const component = Badge({ variant: 'solid', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept colorScheme prop', () => {
    const component = Badge({ colorScheme: 'primary', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept shape prop', () => {
    const component = Badge({ shape: 'pill', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Badge({
      size: 'lg',
      variant: 'outline',
      colorScheme: 'success',
      shape: 'rounded',
      children: 'Test',
    });
    expect(component).toBeDefined();
  });

  it('should accept custom class names', () => {
    const component = Badge({ class: 'custom-class', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept inline CSS prop', () => {
    const component = Badge({ css: { fontSize: '10px' }, children: 'Test' });
    expect(component).toBeDefined();
  });
});
