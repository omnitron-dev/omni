import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { ServiceDescriptor } from '@omnitron-dev/netron-protocol';
import { Service } from '../../src/decorators/core.js';

const SERVICE_KEY = 'service';
interface IDemoService { echo(s: string): Promise<string> }

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

  it('accepts a dynamic wire name', () => {
    @Service('Dynamic')
    class DynamicImpl {}

    const meta = Reflect.getMetadata(SERVICE_KEY, DynamicImpl) as { name: string };
    expect(meta.name).toBe('Dynamic');
  });

  it('accepts explicit service options', () => {
    @Service({ name: 'Configured', version: '1.0.0' })
    class ConfiguredImpl {}

    const meta = Reflect.getMetadata(SERVICE_KEY, ConfiguredImpl) as {
      name: string;
      version: string;
    };
    expect(meta.name).toBe('Configured');
    expect(meta.version).toBe('1.0.0');
  });
});
