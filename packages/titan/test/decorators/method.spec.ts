import 'reflect-metadata';
import { Service, Method, Public, SERVICE_ANNOTATION, PUBLIC_ANNOTATION } from '../../src/decorators/core.js';

describe('Method Decorator', () => {
  describe('Service decorator', () => {
    it('should validate service name', () => {
      expect(() => {
        @Service('123-invalid')
        class InvalidService {}
      }).toThrow('Invalid service name');
    });

    it('should validate service version', () => {
      expect(() => {
        @Service('test@invalid-version')
        class InvalidVersionService {}
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

  describe('Method decorator', () => {
    it('should mark methods as public', () => {
      @Service('test')
      class TestService {
        @Method()
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
        @Method()
        public value: string = 'test';

        @Method({ readonly: true })
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
        @Method()
        public add(a: number, b: number): number {
          return a + b;
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata.methods.add).toBeDefined();
      expect(metadata.methods.add.arguments).toEqual(['Number', 'Number']);
      expect(metadata.methods.add.type).toBe('Number');
    });

    it('should extract async method return types', () => {
      @Service('test')
      class TestService {
        @Method()
        public async fetchData(): Promise<string> {
          return 'data';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata.methods.fetchData).toBeDefined();
      expect(metadata.methods.fetchData.type).toBe('Promise');
    });
  });

  describe('Public decorator (backward compatibility)', () => {
    it('should work as an alias for Method', () => {
      @Service('test')
      class TestService {
        @Public()
        public legacyMethod(): string {
          return 'legacy';
        }

        @Public({ readonly: true })
        public readonly legacyProperty: string = 'legacy';
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, TestService);
      expect(metadata.methods).toHaveProperty('legacyMethod');
      expect(metadata.properties).toHaveProperty('legacyProperty');
      expect(metadata.properties.legacyProperty.readonly).toBe(true);
    });

    it('should set the correct metadata keys', () => {
      class TestClass {
        @Method()
        methodTest(): void {}

        @Public()
        publicTest(): void {}
      }

      expect(Reflect.getMetadata('public', TestClass.prototype, 'methodTest')).toBe(true);
      expect(Reflect.getMetadata(PUBLIC_ANNOTATION, TestClass.prototype, 'methodTest')).toBe(true);
      expect(Reflect.getMetadata('public', TestClass.prototype, 'publicTest')).toBe(true);
      expect(Reflect.getMetadata(PUBLIC_ANNOTATION, TestClass.prototype, 'publicTest')).toBe(true);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle services with multiple decorated members', () => {
      @Service('complex@2.0.0')
      class ComplexService {
        @Method()
        public name: string = 'Complex';

        @Method({ readonly: true })
        public readonly version: string = '2.0.0';

        private internal: number = 0;

        @Method()
        public getData(): string {
          return this.name;
        }

        @Method()
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
        @Method()
        public baseMethod(): string {
          return 'base';
        }
      }

      @Service('derived')
      class DerivedService extends BaseService {
        @Method()
        public override baseMethod(): string {
          return 'overridden';
        }

        @Method()
        public derivedMethod(): string {
          return 'derived';
        }
      }

      const metadata = Reflect.getMetadata(SERVICE_ANNOTATION, DerivedService);

      // Current behavior: Only methods with @Method decorator on the actual class are included
      // Inherited methods need to be re-decorated or overridden
      expect(metadata.methods).toHaveProperty('baseMethod'); // Because it's overridden
      expect(metadata.methods).toHaveProperty('derivedMethod');
      expect(Object.keys(metadata.methods)).toHaveLength(2);
    });
  });
});