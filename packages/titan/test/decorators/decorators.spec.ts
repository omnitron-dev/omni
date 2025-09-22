/**
 * Tests for minimal Titan decorators
 */

import 'reflect-metadata';
import { Container, createToken } from '@nexus';
import {
  Injectable,
  Singleton,
  Transient,
  Service,
  Module
} from '../../src/decorators/core.js';
import {
  Inject,
  Optional
} from '../../src/decorators/injection.js';
import {
  PostConstruct,
  PreDestroy
} from '../../src/decorators/lifecycle.js';
import {
  Retryable,
  Timeout,
  TimeoutError
} from '../../src/decorators/utility.js';

describe('Minimal Titan Decorators', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('Core DI Decorators', () => {
    describe('@Injectable', () => {
      it('should mark class as injectable', () => {
        @Injectable()
        class TestService {}

        const metadata = Reflect.getMetadata('nexus:injectable', TestService);
        expect(metadata).toBe(true);
      });
    });

    describe('@Singleton', () => {
      it('should mark class as singleton', () => {
        @Singleton()
        class TestService {}

        const scopeMetadata = Reflect.getMetadata('nexus:scope', TestService);
        expect(scopeMetadata).toBe('singleton');
        const injectableMetadata = Reflect.getMetadata('injectable', TestService);
        expect(injectableMetadata).toBe(true);
      });
    });

    describe('@Transient', () => {
      it('should mark class as transient', () => {
        @Transient()
        class TestService {}

        const scopeMetadata = Reflect.getMetadata('nexus:scope', TestService);
        expect(scopeMetadata).toBe('transient');
        const injectableMetadata = Reflect.getMetadata('injectable', TestService);
        expect(injectableMetadata).toBe(true);
      });
    });

    describe('@Service', () => {
      it('should mark class as a service with name', () => {
        @Service('UserService')
        class UserService {}

        const serviceMetadata = Reflect.getMetadata('service', UserService);
        expect(serviceMetadata).toEqual({
          name: 'UserService',
          version: undefined
        });

        const nexusServiceName = Reflect.getMetadata('nexus:service:name', UserService);
        expect(nexusServiceName).toBe('UserService');
      });

      it('should support version option', () => {
        @Service({ name: 'ApiService', version: '1.0.0' })
        class ApiService {}

        const serviceMetadata = Reflect.getMetadata('service', ApiService);
        expect(serviceMetadata).toEqual({
          name: 'ApiService',
          version: '1.0.0'
        });
      });

      it('should apply Injectable by default', () => {
        @Service('TestService')
        class TestService {}

        const metadata = Reflect.getMetadata('nexus:injectable', TestService);
        expect(metadata).toBe(true);
      });
    });
  });

  describe('Module Decorator', () => {
    describe('@Module', () => {
      it('should mark class as a module', () => {
        @Module({
          name: 'TestModule',
          version: '1.0.0'
        })
        class TestModule {}

        const metadata = Reflect.getMetadata('module', TestModule);
        expect(metadata).toEqual({
          name: 'TestModule',
          version: '1.0.0'
        });
      });

      it('should set auto-discovery properties', () => {
        @Module({
          name: 'AutoModule'
        })
        class AutoModule {}

        expect((AutoModule as any).__titanModule).toBe(true);
        expect((AutoModule as any).__titanModuleMetadata).toEqual({
          name: 'AutoModule'
        });
      });

      it('should apply Nexus module decorator when providers are specified', () => {
        @Injectable()
        class TestProvider {}

        @Module({
          providers: [TestProvider]
        })
        class TestModule {}

        const nexusMetadata = Reflect.getMetadata('nexus:module', TestModule);
        expect(nexusMetadata).toEqual({
          providers: [TestProvider]
        });
      });
    });
  });

  describe('Method Interceptors', () => {
    describe('@Retryable', () => {
      it('should retry failed methods', async () => {
        let attempts = 0;

        class TestService {
          @Retryable({ attempts: 3, delay: 10 })
          async flaky() {
            attempts++;
            if (attempts < 3) {
              throw new Error('Failed');
            }
            return 'Success';
          }
        }

        const service = new TestService();
        const result = await service.flaky();

        expect(result).toBe('Success');
        expect(attempts).toBe(3);
      });

      it('should respect retry condition', async () => {
        class TestService {
          @Retryable({
            attempts: 3,
            delay: 10,
            retryOn: (error) => error.message !== 'Do not retry'
          })
          async conditional(shouldRetry: boolean) {
            throw new Error(shouldRetry ? 'Retry me' : 'Do not retry');
          }
        }

        const service = new TestService();

        // Should not retry
        await expect(service.conditional(false)).rejects.toThrow('Do not retry');

        // Should retry
        await expect(service.conditional(true)).rejects.toThrow('Retry me');
      });
    });

    describe('@Timeout', () => {
      it('should timeout long-running methods', async () => {
        class TestService {
          @Timeout({ ms: 100 })
          async slowMethod() {
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'Done';
          }
        }

        const service = new TestService();
        await expect(service.slowMethod()).rejects.toThrow(TimeoutError);
      });

      it('should allow fast methods to complete', async () => {
        class TestService {
          @Timeout({ ms: 100 })
          async fastMethod() {
            await new Promise(resolve => setTimeout(resolve, 50));
            return 'Done';
          }
        }

        const service = new TestService();
        const result = await service.fastMethod();
        expect(result).toBe('Done');
      });
    });
  });

  describe('Lifecycle Decorators', () => {
    it('should have PostConstruct available', () => {
      expect(PostConstruct).toBeDefined();
    });

    it('should have PreDestroy available', () => {
      expect(PreDestroy).toBeDefined();
    });
  });

  describe('Parameter Decorators', () => {
    it('should have Inject available', () => {
      expect(Inject).toBeDefined();
    });

    it('should have Optional available', () => {
      expect(Optional).toBeDefined();
    });
  });
});