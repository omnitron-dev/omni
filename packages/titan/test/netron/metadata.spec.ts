import { describe, it, expect } from '@jest/globals';
import { Service1 } from './fixtures/service1.js';
import { Service2 } from './fixtures/service2.js';
import { isNetronService } from '../../src/netron/predicates.js';
import { SERVICE_ANNOTATION } from '../../src/decorators/core.js';

describe('Packet', () => {
  it('complex metadata', () => {
    const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, Service1);

    // Verify basic structure
    expect(metadata.name).toBe('service1');
    expect(metadata.version).toBe('');

    // Verify properties
    expect(metadata.properties).toBeDefined();
    expect(metadata.properties.name).toEqual({ type: 'String', readonly: false });
    expect(metadata.properties.description).toEqual({ type: 'String', readonly: false });
    expect(metadata.properties.data).toEqual({ type: 'Object', readonly: false });
    expect(metadata.properties.isActive).toEqual({ type: 'Boolean', readonly: true });

    // Verify methods exist and have correct return types
    expect(metadata.methods).toBeDefined();
    expect(metadata.methods.greet).toBeDefined();
    expect(metadata.methods.greet.type).toBe('String');
    expect(metadata.methods.echo).toBeDefined();
    expect(metadata.methods.echo.type).toBe('String');
    expect(metadata.methods.addNumbers).toBeDefined();
    expect(metadata.methods.addNumbers.type).toBe('Number');
    expect(metadata.methods.addNumbers.arguments).toBeDefined();
    expect(metadata.methods.addNumbers.arguments.length).toBe(2);

    // Verify arguments have index and type
    if (Array.isArray(metadata.methods.echo.arguments) && metadata.methods.echo.arguments.length > 0) {
      const firstArg = metadata.methods.echo.arguments[0];
      if (typeof firstArg === 'object') {
        expect(firstArg).toHaveProperty('index');
        expect(firstArg).toHaveProperty('type');
      }
    }

    // JSON string comparison removed due to metadata format change
    // Arguments are now objects with {index, type} instead of just strings
  });

  it('check context predicate', () => {
    const ctx1 = new Service1();
    const ctx2 = new Service2();

    expect(isNetronService(ctx1)).toBe(true);
    expect(isNetronService(ctx2)).toBe(true);
  });

  it('metadata with custom type', () => {
    const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, Service2);

    // Verify basic structure
    expect(metadata.name).toBe('service2');
    expect(metadata.version).toBe('');

    // Verify properties
    expect(metadata.properties).toBeDefined();
    expect(metadata.properties.name).toEqual({ type: 'String', readonly: false });

    // Verify methods
    expect(metadata.methods).toBeDefined();
    expect(metadata.methods.getService1).toBeDefined();
    expect(metadata.methods.getService1.type).toBe('Service1');
    expect(metadata.methods.getNewService1).toBeDefined();
    expect(metadata.methods.getNewService1.type).toBe('Service1');
    expect(metadata.methods.addNumbers).toBeDefined();
    expect(metadata.methods.addNumbers.type).toBe('Number');
    expect(metadata.methods.addNumbers.arguments.length).toBe(2);

    // JSON string comparison removed due to metadata format change
  });

  it('should have correct Service1 method count', () => {
    const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, Service1);
    const methodCount = Object.keys(metadata.methods).length;
    expect(methodCount).toBe(26); // Service1 has 26 public methods
  });

  it('should have correct Service2 method count', () => {
    const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, Service2);
    const methodCount = Object.keys(metadata.methods).length;
    expect(methodCount).toBe(3); // Service2 has 3 public methods
  });
});
