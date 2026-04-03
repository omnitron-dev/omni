/**
 * Tests for Service decorator with contract field
 */

import 'reflect-metadata';
import { Service, METADATA_KEYS } from '../../src/decorators/core.js';
import type { ExtendedServiceMetadata } from '../../src/decorators/core.js';

describe('@Service decorator with contract', () => {
  it('should store contract in service metadata', () => {
    const mockContract = {
      getUser: {
        input: { type: 'object' },
        output: { type: 'object' },
      },
    };

    @Service({
      name: 'UserService@1.0.0',
      contract: mockContract,
    })
    class UserService {}

    const metadata = Reflect.getMetadata(METADATA_KEYS.SERVICE_ANNOTATION, UserService) as ExtendedServiceMetadata;

    expect(metadata).toBeDefined();
    expect(metadata.name).toBe('UserService');
    expect(metadata.version).toBe('1.0.0');
    expect(metadata.contract).toBe(mockContract);
  });

  it('should work without contract field', () => {
    @Service('BasicService@1.0.0')
    class BasicService {}

    const metadata = Reflect.getMetadata(METADATA_KEYS.SERVICE_ANNOTATION, BasicService) as ExtendedServiceMetadata;

    expect(metadata).toBeDefined();
    expect(metadata.name).toBe('BasicService');
    expect(metadata.version).toBe('1.0.0');
    expect(metadata.contract).toBeUndefined();
  });

  it('should handle options object without contract', () => {
    @Service({
      name: 'TestService@1.0.0',
      transportConfig: {
        timeout: 5000,
      },
    })
    class TestService {}

    const metadata = Reflect.getMetadata(METADATA_KEYS.SERVICE_ANNOTATION, TestService) as ExtendedServiceMetadata;

    expect(metadata).toBeDefined();
    expect(metadata.name).toBe('TestService');
    expect(metadata.version).toBe('1.0.0');
    expect(metadata.contract).toBeUndefined();
    expect(metadata.transportConfig?.timeout).toBe(5000);
  });
});
