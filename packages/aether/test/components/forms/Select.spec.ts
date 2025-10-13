/**
 * Select Component Tests
 */

import { describe, it, expect } from 'vitest';
import { Select } from '../../../src/components/forms/Select.js';

describe('Select', () => {
  it('should be defined', () => {
    expect(Select).toBeDefined();
  });

  it('should have display name', () => {
    expect((Select as any).displayName).toBe('Select');
  });

  it('should be a function', () => {
    expect(typeof Select).toBe('function');
  });

  it('should have sub-components', () => {
    expect((Select as any).Trigger).toBeDefined();
    expect((Select as any).Value).toBeDefined();
    expect((Select as any).Content).toBeDefined();
    expect((Select as any).Item).toBeDefined();
  });
});
