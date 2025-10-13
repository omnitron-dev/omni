/**
 * Input Component Tests
 */

import { describe, it, expect } from 'vitest';
import { Input } from '../../../src/components/forms/Input.js';

describe('Input', () => {
  it('should be defined', () => {
    expect(Input).toBeDefined();
  });

  it('should have display name', () => {
    expect((Input as any).displayName).toBe('Input');
  });

  it('should be a function', () => {
    expect(typeof Input).toBe('function');
  });
});
