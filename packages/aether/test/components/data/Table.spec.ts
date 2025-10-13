/**
 * Tests for Table styled component
 */

import { describe, it, expect } from 'vitest';
import { Table } from '../../../src/components/data/Table.js';

describe('Table Component', () => {
  it('should be defined', () => {
    expect(Table).toBeDefined();
  });

  it('should accept size variant', () => {
    const component = Table({ size: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept variant prop', () => {
    const component = Table({ variant: 'simple', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept layout prop', () => {
    const component = Table({ layout: 'fixed', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Table({
      size: 'lg',
      variant: 'bordered',
      layout: 'auto',
      children: 'Test',
    });
    expect(component).toBeDefined();
  });

  it('should have sub-components', () => {
    expect((Table as any).Caption).toBeDefined();
    expect((Table as any).Header).toBeDefined();
    expect((Table as any).Body).toBeDefined();
    expect((Table as any).Footer).toBeDefined();
    expect((Table as any).Row).toBeDefined();
    expect((Table as any).Head).toBeDefined();
    expect((Table as any).Cell).toBeDefined();
  });

  it('should accept custom class names', () => {
    const component = Table({ class: 'custom-class', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept inline CSS prop', () => {
    const component = Table({ css: { width: '100%' }, children: 'Test' });
    expect(component).toBeDefined();
  });
});
