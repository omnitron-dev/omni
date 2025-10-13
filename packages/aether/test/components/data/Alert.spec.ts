/**
 * Tests for Alert styled component
 */

import { describe, it, expect } from 'vitest';
import { Alert } from '../../../src/components/data/Alert.js';

describe('Alert Component', () => {
  it('should be defined', () => {
    expect(Alert).toBeDefined();
  });

  it('should accept variant prop', () => {
    const component = Alert({ variant: 'solid', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept status prop', () => {
    const component = Alert({ status: 'success', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept size prop', () => {
    const component = Alert({ size: 'md', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept multiple variants', () => {
    const component = Alert({
      variant: 'outline',
      status: 'error',
      size: 'lg',
      children: 'Test',
    });
    expect(component).toBeDefined();
  });

  it('should have sub-components', () => {
    expect((Alert as any).Icon).toBeDefined();
    expect((Alert as any).Title).toBeDefined();
    expect((Alert as any).Description).toBeDefined();
  });

  it('should accept custom class names', () => {
    const component = Alert({ class: 'custom-class', children: 'Test' });
    expect(component).toBeDefined();
  });

  it('should accept inline CSS prop', () => {
    const component = Alert({ css: { padding: '10px' }, children: 'Test' });
    expect(component).toBeDefined();
  });
});
