import { describe, it, expect } from 'vitest';
import { ServiceDescriptor, isServiceDescriptor } from '../src/service-descriptor.js';

interface IDemoService { echo(s: string): Promise<string> }

describe('ServiceDescriptor.of', () => {
  it('builds a descriptor with name + version + qualifiedName', () => {
    const d = ServiceDescriptor.of<IDemoService>('Demo', '1.0.0');
    expect(d.name).toBe('Demo');
    expect(d.version).toBe('1.0.0');
    expect(d.qualifiedName).toBe('Demo@1.0.0');
  });

  it('omits @version when version is empty', () => {
    const d = ServiceDescriptor.of<IDemoService>('Demo');
    expect(d.qualifiedName).toBe('Demo');
    expect(d.version).toBe('');
  });

  it('rejects empty name', () => {
    expect(() => ServiceDescriptor.of<IDemoService>('')).toThrow(/name is required/);
  });

  it('returns a frozen object — not mutable', () => {
    const d = ServiceDescriptor.of<IDemoService>('Demo');
    expect(Object.isFrozen(d)).toBe(true);
  });

  it('does not surface the phantom interface field at runtime', () => {
    const d = ServiceDescriptor.of<IDemoService>('Demo');
    // Phantom field uses a private symbol — never enumerable.
    expect(Object.keys(d)).toEqual(['name', 'version', 'qualifiedName']);
  });
});

describe('isServiceDescriptor', () => {
  it('returns true for ServiceDescriptor.of() output', () => {
    expect(isServiceDescriptor(ServiceDescriptor.of('Foo'))).toBe(true);
    expect(isServiceDescriptor(ServiceDescriptor.of('Foo', '1.0.0'))).toBe(true);
  });

  it('returns false for plain ServiceOptions object', () => {
    expect(isServiceDescriptor({ name: 'Foo' })).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isServiceDescriptor('Foo')).toBe(false);
    expect(isServiceDescriptor(undefined)).toBe(false);
    expect(isServiceDescriptor(null)).toBe(false);
  });
});

