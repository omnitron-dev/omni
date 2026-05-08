/**
 * ServiceDescriptor unit tests.
 *
 * Covers:
 *   - of() factory produces frozen descriptors with name/version/qualifiedName
 *   - qualifiedName combines name and version with @ separator
 *   - empty version is valid (unversioned service)
 *   - empty name throws
 *   - isServiceDescriptor type-guard works
 *   - @Service decorator accepts a descriptor (verified by reading
 *     the SERVICE_KEY off the class)
 *   - phantom interface field is type-only — no runtime payload
 */

import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { Service } from '../../src/decorators/core.js';
import {
  ServiceDescriptor,
  isServiceDescriptor,
} from '../../src/netron/service-descriptor.js';
// Read metadata via the well-known 'service' key the decorator
// already writes for backwards compat (line 634 in core.ts).
const SERVICE_KEY = 'service';

interface IDemoService {
  echo(s: string): Promise<string>;
}

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

describe('@Service decorator with ServiceDescriptor', () => {
  it('reads name + version from the descriptor', () => {
    const Demo = ServiceDescriptor.of<IDemoService>('Demo', '2.3.4');

    @Service(Demo)
    class DemoImpl {
      async echo(s: string): Promise<string> {
        return s;
      }
    }

    const meta = Reflect.getMetadata(SERVICE_KEY, DemoImpl) as { name: string; version: string };
    expect(meta.name).toBe('Demo');
    expect(meta.version).toBe('2.3.4');
  });

  it('descriptor without version uses bare name', () => {
    const Demo = ServiceDescriptor.of<IDemoService>('Demo');

    @Service(Demo)
    class DemoImpl {
      async echo(s: string): Promise<string> {
        return s;
      }
    }

    const meta = Reflect.getMetadata(SERVICE_KEY, DemoImpl) as { name: string; version?: string };
    expect(meta.name).toBe('Demo');
    // Decorator stores `version: undefined` for unversioned services
    // (truthy-collapsed in core.ts line 634); both empty-string and
    // undefined are valid representations of "no version".
    expect(meta.version ?? '').toBe('');
  });

  it('still accepts the legacy string form for backwards compatibility', () => {
    @Service('Legacy')
    class LegacyImpl {}

    const meta = Reflect.getMetadata(SERVICE_KEY, LegacyImpl) as { name: string };
    expect(meta.name).toBe('Legacy');
  });

  it('still accepts the legacy ServiceOptions form', () => {
    @Service({ name: 'LegacyOpts', version: '1.0.0' })
    class LegacyOptsImpl {}

    const meta = Reflect.getMetadata(SERVICE_KEY, LegacyOptsImpl) as {
      name: string;
      version: string;
    };
    expect(meta.name).toBe('LegacyOpts');
    expect(meta.version).toBe('1.0.0');
  });
});
