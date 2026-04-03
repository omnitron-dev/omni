import 'reflect-metadata';
import { Service, Public, SERVICE_ANNOTATION, PUBLIC_ANNOTATION } from '../../src/decorators/core.js';

describe('Public Decorator', () => {
  describe('Service decorator', () => {
    it('should validate service name', () => {
      expect(() => {
        @Service('123-invalid')
        class _InvalidService {}
      }).toThrow('Invalid service name');
    });

    it('should validate service version', () => {
      expect(() => {
        @Service('test@invalid-version')
        class _InvalidVersionService {}
      }).toThrow('Invalid version');
    });

    it('should accept valid service name without version', () => {
      @Service('test.service')
      class TestService {}

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('test.service');
      expect(metadata.version).toBe('');
    });

    it('should accept valid service name with version', () => {
      @Service('test.service@1.0.0')
      class TestService {}

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('test.service');
      expect(metadata.version).toBe('1.0.0');
    });
  });

  describe('Public decorator', () => {
    it('should mark methods as public', () => {
      @Service('test')
      class TestService {
        @Public()
        public testMethod(): string {
          return 'test';
        }

        private privateMethod(): string {
          return 'private';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata.methods).toHaveProperty('testMethod');
      expect(metadata.methods).not.toHaveProperty('privateMethod');
    });

    it('should mark properties as public', () => {
      @Service('test')
      class TestService {
        @Public()
        public value: string = 'test';

        @Public({ readonly: true })
        public readonly readonlyValue: string = 'readonly';

        private privateValue: string = 'private';
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata.properties).toHaveProperty('value');
      expect(metadata.properties.value.readonly).toBe(false);
      expect(metadata.properties).toHaveProperty('readonlyValue');
      expect(metadata.properties.readonlyValue.readonly).toBe(true);
      expect(metadata.properties).not.toHaveProperty('privateValue');
    });

    it('should extract method argument types', () => {
      @Service('test')
      class TestService {
        @Public()
        public add(a: number, b: number): number {
          return a + b;
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata.methods.add).toBeDefined();
      expect(metadata.methods.add.arguments).toEqual([
        { index: 0, type: 'Number' },
        { index: 1, type: 'Number' },
      ]);
      expect(metadata.methods.add.type).toBe('Number');
    });

    it('should extract async method return types', () => {
      @Service('test')
      class TestService {
        @Public()
        public async fetchData(): Promise<string> {
          return 'data';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata.methods.fetchData).toBeDefined();
      expect(metadata.methods.fetchData.type).toBe('Promise');
    });
  });

  describe('Public decorator metadata keys', () => {
    it('should support readonly properties', () => {
      @Service('test')
      class TestService {
        @Public()
        public someMethod(): string {
          return 'result';
        }

        @Public({ readonly: true })
        public readonly readonlyProperty: string = 'readonly';
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata.methods).toHaveProperty('someMethod');
      expect(metadata.properties).toHaveProperty('readonlyProperty');
      expect(metadata.properties.readonlyProperty.readonly).toBe(true);
    });

    it('should set the correct metadata keys', () => {
      class TestClass {
        @Public()
        methodTest(): void {}

        @Public()
        anotherMethod(): void {}
      }

      expect(Reflect.getMetadata('public', TestClass.prototype, 'methodTest')).toBe(true);
      expect(Reflect.getMetadata(PUBLIC_ANNOTATION, TestClass.prototype, 'methodTest')).toBe(true);
      expect(Reflect.getMetadata('public', TestClass.prototype, 'anotherMethod')).toBe(true);
      expect(Reflect.getMetadata(PUBLIC_ANNOTATION, TestClass.prototype, 'anotherMethod')).toBe(true);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle services with multiple decorated members', () => {
      @Service('complex@2.0.0')
      class ComplexService {
        @Public()
        public name: string = 'Complex';

        @Public({ readonly: true })
        public readonly version: string = '2.0.0';

        private internal: number = 0;

        @Public()
        public getData(): string {
          return this.name;
        }

        @Public()
        public async process(input: string): Promise<void> {
          // Process
        }

        private helper(): void {
          // Not exposed
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, ComplexService);

      // Check service metadata
      expect(metadata.name).toBe('complex');
      expect(metadata.version).toBe('2.0.0');

      // Check properties
      expect(Object.keys(metadata.properties)).toHaveLength(2);
      expect(metadata.properties.name.readonly).toBe(false);
      expect(metadata.properties.version.readonly).toBe(true);

      // Check methods
      expect(Object.keys(metadata.methods)).toHaveLength(2);
      expect(metadata.methods.getData).toBeDefined();
      expect(metadata.methods.process).toBeDefined();
      expect(metadata.methods).not.toHaveProperty('helper');
    });

    it('should handle inheritance correctly', () => {
      @Service('base')
      class BaseService {
        @Public()
        public baseMethod(): string {
          return 'base';
        }
      }

      @Service('derived')
      class DerivedService extends BaseService {
        @Public()
        public override baseMethod(): string {
          return 'overridden';
        }

        @Public()
        public derivedMethod(): string {
          return 'derived';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, DerivedService);

      // Current behavior: Only methods with @Public decorator on the actual class are included
      // Inherited methods need to be re-decorated or overridden
      expect(metadata.methods).toHaveProperty('baseMethod'); // Because it's overridden
      expect(metadata.methods).toHaveProperty('derivedMethod');
      expect(Object.keys(metadata.methods)).toHaveLength(2);
    });
  });
});
