/**
 * Comprehensive tests for Titan core decorators
 */

import 'reflect-metadata';
import { Container } from '@nexus';
import {
  Injectable,
  Module,
  Singleton,
  Transient,
  Scoped,
  Request,
  Service,
  Controller,
  Repository,
  Factory,
  Global,
  METADATA_KEYS,
  type InjectableOptions,
  type ModuleDecoratorOptions,
  type Scope
} from '../../src/decorators/core.js';

describe('Core Decorators', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('@Injectable', () => {
    it('should mark class as injectable', () => {
      @Injectable()
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestService)).toBe(true);
      expect(Reflect.getMetadata('injectable', TestService)).toBe(true);
    });

    it('should set scope when provided', () => {
      @Injectable({ scope: 'transient' })
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestService)).toBe('transient');
      expect(Reflect.getMetadata('scope', TestService)).toBe('transient');
    });

    it('should set custom token when provided', () => {
      const CustomToken = Symbol('CustomToken');

      @Injectable({ token: CustomToken })
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.TOKEN, TestService)).toBe(CustomToken);
    });

    it('should store options metadata', () => {
      const options: InjectableOptions = {
        scope: 'singleton',
        providedIn: 'root'
      };

      @Injectable(options)
      class TestService {}

      expect(Reflect.getMetadata('injectable:options', TestService)).toEqual(options);
    });
  });

  describe('@Module', () => {
    it('should mark class as a module', () => {
      @Module()
      class TestModule {}

      // Module decorator sets 'nexus:module' to the options object
      expect(Reflect.getMetadata('nexus:module', TestModule)).toEqual({});
      expect(Reflect.getMetadata('module', TestModule)).toEqual({});
      // Check that it's marked as a module by checking if metadata exists
      expect(Reflect.hasMetadata('nexus:module', TestModule)).toBe(true);
    });

    it('should store module options', () => {
      const options: ModuleDecoratorOptions = {
        name: 'TestModule',
        version: '1.0.0',
        imports: [],
        providers: [],
        exports: []
      };

      @Module(options)
      class TestModule {}

      expect(Reflect.getMetadata('nexus:module', TestModule)).toEqual(options);
      expect(Reflect.getMetadata('module', TestModule)).toEqual(options);
    });

    it('should mark module as global when specified', () => {
      @Module({ global: true })
      class GlobalModule {}

      expect(Reflect.getMetadata(METADATA_KEYS.GLOBAL, GlobalModule)).toBe(true);
    });

    it('should set auto-discovery properties', () => {
      const options: ModuleDecoratorOptions = {
        name: 'AutoModule',
        providers: [class ServiceA {}]
      };

      @Module(options)
      class AutoModule {}

      expect((AutoModule as any).__titanModule).toBe(true);
      expect((AutoModule as any).__titanModuleMetadata).toEqual(options);
    });

    it('should apply Injectable decorator automatically', () => {
      @Module()
      class TestModule {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestModule)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestModule)).toBe('singleton');
    });

    it('should handle complex module configurations', () => {
      @Injectable()
      class ServiceA {}

      @Injectable()
      class ServiceB {}

      @Module()
      class SubModule {}

      const options: ModuleDecoratorOptions = {
        name: 'MainModule',
        version: '2.0.0',
        imports: [SubModule],
        providers: [ServiceA, ServiceB],
        exports: [ServiceA],
        global: true
      };

      @Module(options)
      class MainModule {}

      const metadata = Reflect.getMetadata('nexus:module', MainModule);
      expect(metadata).toEqual(options);
      expect(Reflect.getMetadata(METADATA_KEYS.GLOBAL, MainModule)).toBe(true);
    });
  });

  describe('@Singleton', () => {
    it('should mark class as singleton scoped', () => {
      @Singleton()
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestService)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestService)).toBe('singleton');
      expect(Reflect.getMetadata('scope', TestService)).toBe('singleton');
      expect(Reflect.getMetadata('singleton', TestService)).toBe(true);
    });
  });

  describe('@Transient', () => {
    it('should mark class as transient scoped', () => {
      @Transient()
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestService)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestService)).toBe('transient');
      expect(Reflect.getMetadata('scope', TestService)).toBe('transient');
    });
  });

  describe('@Scoped', () => {
    it('should mark class as scoped', () => {
      @Scoped()
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestService)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestService)).toBe('scoped');
      expect(Reflect.getMetadata('scope', TestService)).toBe('scoped');
    });
  });

  describe('@Request', () => {
    it('should mark class as request scoped', () => {
      @Request()
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestService)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestService)).toBe('request');
      expect(Reflect.getMetadata('scope', TestService)).toBe('request');
    });
  });

  describe('@Service', () => {
    it('should mark class as a service with string name', () => {
      @Service('UserService')
      class UserService {}

      const metadata = Reflect.getMetadata('service', UserService);
      expect(metadata).toEqual({
        name: 'UserService',
        version: undefined
      });

      expect(Reflect.getMetadata(METADATA_KEYS.SERVICE_NAME, UserService)).toBe('UserService');
    });

    it('should mark class as a service with options', () => {
      @Service({ name: 'ApiService', version: '1.0.0' })
      class ApiService {}

      const metadata = Reflect.getMetadata('service', ApiService);
      expect(metadata.name).toBe('ApiService');
      expect(metadata.version).toBe('1.0.0');

      expect(Reflect.getMetadata(METADATA_KEYS.SERVICE_NAME, ApiService)).toBe('ApiService');
    });

    it('should apply Injectable with singleton scope', () => {
      @Service('TestService')
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestService)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestService)).toBe('singleton');
    });

    it('should handle service without name', () => {
      @Service({})
      class AnonymousService {}

      const metadata = Reflect.getMetadata('service', AnonymousService);
      expect(metadata.name).toBe('AnonymousService');
      expect(metadata.version).toBe(undefined);
    });
  });

  describe('@Global', () => {
    it('should mark class as global', () => {
      @Global()
      class GlobalService {}

      expect(Reflect.getMetadata(METADATA_KEYS.GLOBAL, GlobalService)).toBe(true);
      expect(Reflect.getMetadata('global', GlobalService)).toBe(true);
    });

    it('should work with @Module decorator', () => {
      @Global()
      @Module({ name: 'GlobalModule' })
      class GlobalModule {}

      expect(Reflect.getMetadata(METADATA_KEYS.GLOBAL, GlobalModule)).toBe(true);
      // Module metadata is set to options, not true
      expect(Reflect.getMetadata('nexus:module', GlobalModule)).toEqual({ name: 'GlobalModule' });
      expect(Reflect.hasMetadata('nexus:module', GlobalModule)).toBe(true);
    });
  });

  describe('@Controller', () => {
    it('should mark class as a controller with default path', () => {
      @Controller()
      class TestController {}

      expect(Reflect.getMetadata(METADATA_KEYS.CONTROLLER_PATH, TestController)).toBe('');
      expect(Reflect.getMetadata('controller:path', TestController)).toBe('');
      expect(Reflect.getMetadata('controller', TestController)).toEqual({ path: '' });
    });

    it('should mark class as a controller with custom path', () => {
      @Controller('/api/users')
      class UserController {}

      expect(Reflect.getMetadata(METADATA_KEYS.CONTROLLER_PATH, UserController)).toBe('/api/users');
      expect(Reflect.getMetadata('controller:path', UserController)).toBe('/api/users');
      expect(Reflect.getMetadata('controller', UserController)).toEqual({ path: '/api/users' });
    });

    it('should apply Injectable with singleton scope', () => {
      @Controller('/test')
      class TestController {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestController)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestController)).toBe('singleton');
    });
  });

  describe('@Repository', () => {
    it('should mark class as a repository without entity', () => {
      @Repository()
      class TestRepository {}

      expect(Reflect.getMetadata('repository', TestRepository)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestRepository)).toBe(true);
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestRepository)).toBe('singleton');
    });

    it('should mark class as a repository with entity', () => {
      class User {
        id: number = 0;
        name: string = '';
      }

      @Repository(User)
      class UserRepository {}

      expect(Reflect.getMetadata(METADATA_KEYS.REPOSITORY_ENTITY, UserRepository)).toBe(User);
      expect(Reflect.getMetadata('repository', UserRepository)).toBe(true);
    });
  });

  describe('@Factory', () => {
    it('should mark method as a factory', () => {
      class ServiceFactory {
        @Factory('DatabaseConnection')
        createConnection() {
          return { connected: true };
        }
      }

      const instance = new ServiceFactory();
      const metadata = Reflect.getMetadata(METADATA_KEYS.FACTORY_NAME, instance, 'createConnection');
      expect(metadata).toBe('DatabaseConnection');

      const factoryMeta = Reflect.getMetadata('factory', instance, 'createConnection');
      expect(factoryMeta).toBe('DatabaseConnection');
    });

    it('should preserve method functionality', () => {
      class ServiceFactory {
        @Factory('TestService')
        createService() {
          return { name: 'TestService' };
        }
      }

      const factory = new ServiceFactory();
      const service = factory.createService();
      expect(service).toEqual({ name: 'TestService' });
    });
  });

  describe('Decorator Combinations', () => {
    it('should combine multiple scope decorators correctly', () => {
      // Last decorator wins
      @Singleton()
      @Transient()
      class ConflictingService {}

      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, ConflictingService)).toBe('singleton');
    });

    it('should combine @Global with @Module', () => {
      @Global()
      @Module({
        name: 'SharedModule',
        providers: []
      })
      class SharedModule {}

      expect(Reflect.getMetadata(METADATA_KEYS.GLOBAL, SharedModule)).toBe(true);
      // Module metadata is set to options
      expect(Reflect.hasMetadata('nexus:module', SharedModule)).toBe(true);
      expect(Reflect.getMetadata('nexus:module', SharedModule)).toEqual({
        name: 'SharedModule',
        providers: []
      });
    });

    it('should combine @Service with @Injectable', () => {
      @Injectable({ scope: 'transient' })
      @Service('CustomService')
      class CustomService {}

      // Injectable decorator is applied last (top decorator), so transient scope wins
      expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, CustomService)).toBe('transient');
      expect(Reflect.getMetadata(METADATA_KEYS.SERVICE_NAME, CustomService)).toBe('CustomService');
    });

    it('should support decorator stacking on modules', () => {
      @Injectable()
      class Provider1 {}

      @Controller('/api')
      class ApiController {}

      @Repository()
      class DataRepository {}

      @Global()
      @Module({
        name: 'CompleteModule',
        providers: [Provider1, ApiController, DataRepository],
        exports: [Provider1]
      })
      class CompleteModule {}

      const moduleMetadata = Reflect.getMetadata('nexus:module', CompleteModule);
      expect(moduleMetadata.providers).toHaveLength(3);
      expect(moduleMetadata.exports).toContain(Provider1);
      expect(Reflect.getMetadata(METADATA_KEYS.GLOBAL, CompleteModule)).toBe(true);
    });
  });

  describe('Scope Validation', () => {
    it('should support all valid scope types', () => {
      const scopes: Scope[] = ['singleton', 'transient', 'scoped', 'request'];

      scopes.forEach(scope => {
        @Injectable({ scope })
        class TestService {}

        expect(Reflect.getMetadata(METADATA_KEYS.SCOPE, TestService)).toBe(scope);
      });
    });
  });

  describe('Metadata Keys', () => {
    it('should expose all metadata keys', () => {
      expect(METADATA_KEYS.INJECTABLE).toBe('nexus:injectable');
      expect(METADATA_KEYS.MODULE).toBe('nexus:module');
      expect(METADATA_KEYS.GLOBAL).toBe('nexus:global');
      expect(METADATA_KEYS.SCOPE).toBe('nexus:scope');
      expect(METADATA_KEYS.TOKEN).toBe('nexus:token');
      expect(METADATA_KEYS.SERVICE_NAME).toBe('nexus:service:name');
      expect(METADATA_KEYS.CONTROLLER_PATH).toBe('controller:path');
      expect(METADATA_KEYS.REPOSITORY_ENTITY).toBe('repository:entity');
      expect(METADATA_KEYS.FACTORY_NAME).toBe('factory:name');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined options gracefully', () => {
      @Injectable(undefined as any)
      class TestService {}

      expect(Reflect.getMetadata(METADATA_KEYS.INJECTABLE, TestService)).toBe(true);
    });

    it('should handle empty module options', () => {
      @Module()
      class EmptyModule {}

      expect(Reflect.getMetadata('nexus:module', EmptyModule)).toEqual({});
      expect((EmptyModule as any).__titanModuleMetadata).toEqual({});
    });

    it('should handle circular dependencies in module imports', () => {
      @Module({ name: 'ModuleA' })
      class ModuleA {}

      @Module({ name: 'ModuleB', imports: [ModuleA] })
      class ModuleB {}

      // This shouldn't throw during decoration
      expect(() => {
        @Module({ name: 'ModuleC', imports: [ModuleB, ModuleA] })
        class ModuleC {}
      }).not.toThrow();
    });
  });
});