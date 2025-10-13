/**
 * Slider Component Tests
 */

import { describe, it, expect } from 'vitest';
import { Slider } from '../../../src/components/forms/Slider.js';

describe('Slider', () => {
  it('should be defined', () => {
    expect(Slider).toBeDefined();
  });

  it('should have display name', () => {
    expect((Slider as any).displayName).toBe('Slider');
  });

  it('should be a function', () => {
    expect(typeof Slider).toBe('function');
  });

  it('should have sub-components', () => {
    expect((Slider as any).Track).toBeDefined();
    expect((Slider as any).Range).toBeDefined();
    expect((Slider as any).Thumb).toBeDefined();
  });
});
