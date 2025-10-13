/**
 * Checkbox Component Tests
 */

import { describe, it, expect } from 'vitest';
import { Checkbox } from '../../../src/components/forms/Checkbox.js';

describe('Checkbox', () => {
  it('should be defined', () => {
    expect(Checkbox).toBeDefined();
  });

  it('should have display name', () => {
    expect((Checkbox as any).displayName).toBe('Checkbox');
  });

  it('should be a function', () => {
    expect(typeof Checkbox).toBe('function');
  });

  it('should have Indicator sub-component', () => {
    expect((Checkbox as any).Indicator).toBeDefined();
  });
});
