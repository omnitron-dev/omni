import { describe, it, expect } from 'vitest';
import { Reference, Definition } from '../src/index.js';

describe('Reference', () => {
  it('holds the defId it is constructed with', () => {
    const ref = new Reference('abc-123');
    expect(ref.defId).toBe('abc-123');
  });

  it('throws on an empty or non-string defId', () => {
    expect(() => new Reference('')).toThrow('non-empty string');
    // @ts-expect-error — exercising the runtime guard
    expect(() => new Reference(undefined)).toThrow('non-empty string');
  });

  it('references a freshly-minted Definition id', () => {
    const id = Definition.nextId();
    expect(() => new Reference(id)).not.toThrow();
    expect(new Reference(id).defId).toBe(id);
  });
});
