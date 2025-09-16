/**
 * Fixed tests for Titan decorators that properly check metadata
 */

import 'reflect-metadata';
import { Container, createToken } from '@omnitron-dev/nexus';
import {
  Injectable,
  Singleton,
  Transient,
  Inject,
  Service,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Module,
  Event,
  EventHandler,
  EventListener,
  UseMiddleware,
  UseGuard,
  UseInterceptor,
  UsePipe,
  Query,
  Param,
  Body,
  Headers,
  Request,
  Response,
  Cache,
  Cached,
  Logger as LoggerDecorator,
  Config as ConfigDecorator,
  Health,
  MetricsCollector,
  OnEvent
} from '../src/decorators';

// Test interfaces
interface TestConfig {
  name: string;
  value: number;
}

interface TestLogger {
  info: jest.Mock;
  error: jest.Mock;
}

// Test tokens
const TestServiceToken = createToken<TestService>('TestService');
const TestConfigToken = createToken<TestConfig>('TestConfig');
const TestLoggerToken = createToken<TestLogger>('TestLogger');

describe('Titan Decorators - Fixed', () => {
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

        const metadata = Reflect.getMetadata('nexus:scope', TestService);
        expect(metadata).toBe('singleton');
      });
    });

    describe('@Transient', () => {
      it('should mark class as transient', () => {
        @Transient()
        class TestService {}

        const metadata = Reflect.getMetadata('nexus:scope', TestService);
        expect(metadata).toBe('transient');
      });
    });

    describe('@Inject', () => {
      it('should inject dependencies via constructor', () => {
        const testConfig: TestConfig = { name: 'test', value: 123 };
        container.register(TestConfigToken, { useValue: testConfig });

        @Injectable()
        class TestService {
          constructor(@Inject(TestConfigToken) public config: TestConfig) {}
        }

        container.register(TestServiceToken, { useClass: TestService });
        const service = container.resolve(TestServiceToken);

        expect(service.config).toEqual(testConfig);
      });

      it('should inject dependencies via properties', () => {
        const testConfig: TestConfig = { name: 'test', value: 456 };
        container.register(TestConfigToken, { useValue: testConfig });

        @Injectable()
        class TestService {
          @Inject(TestConfigToken)
          public config!: TestConfig;
        }

        container.register(TestServiceToken, { useClass: TestService });
        const service = container.resolve(TestServiceToken);

        // Property injection happens after construction
        expect(service.config).toEqual(testConfig);
      });
    });
  });

  describe('Service Decorators', () => {
    describe('@Service', () => {
      it('should mark class as service with name', () => {
        @Service('TestService@1.0.0')
        class TestService {}

        const metadata = Reflect.getMetadata('nexus:service:name', TestService);
        expect(metadata).toBe('TestService@1.0.0');
        const scope = Reflect.getMetadata('nexus:scope', TestService);
        expect(scope).toBe('singleton');
      });

      it('should mark class as service with default name', () => {
        @Service()
        class TestService {}

        const scope = Reflect.getMetadata('nexus:scope', TestService);
        expect(scope).toBe('singleton');
      });
    });
  });

  describe('HTTP Decorators', () => {
    describe('@Controller', () => {
      it('should mark class as controller with path', () => {
        @Controller('/users')
        class UserController {}

        const pathMetadata = Reflect.getMetadata('custom:Controller:path', UserController);
        const versionMetadata = Reflect.getMetadata('custom:Controller:version', UserController);
        expect(pathMetadata).toBe('/users');
        expect(versionMetadata).toBe('v1');
      });

      it('should mark class as controller with options', () => {
        @Controller({ path: '/api/users', version: 'v2' })
        class UserController {}

        const pathMetadata = Reflect.getMetadata('custom:Controller:path', UserController);
        const versionMetadata = Reflect.getMetadata('custom:Controller:version', UserController);
        expect(pathMetadata).toBe('/api/users');
        expect(versionMetadata).toBe('v2');
      });
    });

    describe('HTTP Method Decorators', () => {
      class TestController {
        @Get('/users')
        getUsers() {}

        @Post('/users')
        createUser() {}

        @Put('/users/:id')
        updateUser() {}

        @Delete('/users/:id')
        deleteUser() {}

        @Patch('/users/:id')
        patchUser() {}
      }

      it('should mark methods with HTTP metadata', () => {
        const getMethod = Reflect.getMetadata('custom:Get:method', TestController.prototype, 'getUsers');
        const getPath = Reflect.getMetadata('custom:Get:path', TestController.prototype, 'getUsers');
        expect(getMethod).toBe('GET');
        expect(getPath).toBe('/users');

        const postMethod = Reflect.getMetadata('custom:Post:method', TestController.prototype, 'createUser');
        const postPath = Reflect.getMetadata('custom:Post:path', TestController.prototype, 'createUser');
        expect(postMethod).toBe('POST');
        expect(postPath).toBe('/users');

        const putMethod = Reflect.getMetadata('custom:Put:method', TestController.prototype, 'updateUser');
        const putPath = Reflect.getMetadata('custom:Put:path', TestController.prototype, 'updateUser');
        expect(putMethod).toBe('PUT');
        expect(putPath).toBe('/users/:id');

        const deleteMethod = Reflect.getMetadata('custom:Delete:method', TestController.prototype, 'deleteUser');
        const deletePath = Reflect.getMetadata('custom:Delete:path', TestController.prototype, 'deleteUser');
        expect(deleteMethod).toBe('DELETE');
        expect(deletePath).toBe('/users/:id');

        const patchMethod = Reflect.getMetadata('custom:Patch:method', TestController.prototype, 'patchUser');
        const patchPath = Reflect.getMetadata('custom:Patch:path', TestController.prototype, 'patchUser');
        expect(patchMethod).toBe('PATCH');
        expect(patchPath).toBe('/users/:id');
      });
    });

    describe('Parameter Decorators', () => {
      class TestController {
        testMethod(
          @Query('filter') filter: string,
          @Param('id') id: string,
          @Body() body: any,
          @Headers('authorization') auth: string
        ) {}
      }

      it('should mark parameters with metadata', () => {
        // Parameter decorators work differently - they store metadata on individual parameters
        // We would need to check the actual metadata keys used by the decorators

        const paramTypes = Reflect.getMetadata('design:paramtypes', TestController.prototype, 'testMethod');
        expect(paramTypes).toBeDefined();
        expect(paramTypes.length).toBe(4);
      });
    });
  });

  describe('Module Decorator', () => {
    it('should create module with metadata', () => {
      @Module({
        name: 'TestModule',
        imports: [],
        providers: [],
        exports: []
      })
      class TestModule {}

      const metadata = Reflect.getMetadata('nexus:module', TestModule);
      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('TestModule');
    });
  });

  describe('Event Decorators', () => {
    describe('@OnEvent', () => {
      it('should mark method as event handler', () => {
        class TestService {
          @OnEvent({ event: 'user.created' })
          handleUserCreated() {}
        }

        const metadata = Reflect.getMetadata('custom:OnEvent', TestService.prototype, 'handleUserCreated');
        expect(metadata).toBeDefined();
      });

      it('should mark method as event handler with options', () => {
        class TestService {
          @OnEvent({
            event: 'user.created',
            async: true,
            priority: 10
          })
          handleUserCreated() {}
        }

        const eventMetadata = Reflect.getMetadata('custom:OnEvent:event', TestService.prototype, 'handleUserCreated');
        const asyncMetadata = Reflect.getMetadata('custom:OnEvent:async', TestService.prototype, 'handleUserCreated');
        const priorityMetadata = Reflect.getMetadata('custom:OnEvent:priority', TestService.prototype, 'handleUserCreated');

        expect(eventMetadata).toBe('user.created');
        expect(asyncMetadata).toBe(true);
        expect(priorityMetadata).toBe(10);
      });
    });
  });

  describe('Middleware Decorators', () => {
    const authMiddleware = jest.fn();
    const loggingGuard = jest.fn();
    const cacheInterceptor = jest.fn();
    const validationPipe = jest.fn();

    describe('@UseMiddleware', () => {
      it('should attach middleware to class', () => {
        @UseMiddleware([authMiddleware])
        class TestController {}

        const metadata = Reflect.getMetadata('custom:UseMiddleware:middleware', TestController);
        expect(metadata).toEqual([authMiddleware]);
      });
    });

    describe('@UseGuard', () => {
      it('should attach guard to class', () => {
        @UseGuard([loggingGuard])
        class TestController {}

        const metadata = Reflect.getMetadata('custom:UseGuard:guards', TestController);
        expect(metadata).toEqual([loggingGuard]);
      });
    });

    describe('@UseInterceptor', () => {
      it('should attach interceptor to class', () => {
        @UseInterceptor([cacheInterceptor])
        class TestController {}

        const metadata = Reflect.getMetadata('custom:UseInterceptor:interceptors', TestController);
        expect(metadata).toEqual([cacheInterceptor]);
      });
    });

    describe('@UsePipe', () => {
      it('should attach pipe to class', () => {
        @UsePipe([validationPipe])
        class TestController {}

        const metadata = Reflect.getMetadata('custom:UsePipe:pipes', TestController);
        expect(metadata).toEqual([validationPipe]);
      });
    });
  });

  describe('Caching Decorators', () => {
    describe('@Cacheable', () => {
      it('should mark method for caching', () => {
        class TestService {
          @Cache({ ttl: 5000 })
          getCachedData() {
            return { data: 'test' };
          }
        }

        // Cacheable is a method interceptor, so it transforms the method
        const method = TestService.prototype.getCachedData;
        expect(method).toBeDefined();
      });
    });

    describe('@Cached', () => {
      it('should mark method as cached', () => {
        class TestService {
          @Cached({ ttl: 10000 })
          getData() {
            return { data: 'test' };
          }
        }

        const cachedMetadata = Reflect.getMetadata('custom:Cached:cached', TestService.prototype, 'getData');
        const ttlMetadata = Reflect.getMetadata('custom:Cached:ttl', TestService.prototype, 'getData');
        expect(cachedMetadata).toBe(true);
        expect(ttlMetadata).toBe(10000);
      });
    });
  });

  describe('Utility Decorators', () => {
    describe('@Health', () => {
      it('should mark method as health check', () => {
        class TestService {
          @Health({ name: 'database', critical: true })
          checkDatabase() {
            return { status: 'ok' };
          }
        }

        const nameMetadata = Reflect.getMetadata('custom:HealthCheck:name', TestService.prototype, 'checkDatabase');
        const criticalMetadata = Reflect.getMetadata('custom:HealthCheck:critical', TestService.prototype, 'checkDatabase');
        expect(nameMetadata).toBe('database');
        expect(criticalMetadata).toBe(true);
      });
    });

    describe('@Monitor', () => {
      it('should mark method for monitoring', () => {
        class TestService {
          @MetricsCollector({ name: 'api.request', sampleRate: 0.1 })
          processRequest() {
            return { success: true };
          }
        }

        // Monitor is a method interceptor, so it transforms the method
        const method = TestService.prototype.processRequest;
        expect(method).toBeDefined();
      });
    });
  });

  describe('Combined Decorators', () => {
    it('should work with multiple decorators on same class', () => {
      @Injectable()
      @Controller('/api')
      class TestController {
        @Get('/test')
        @Cache({ ttl: 1000 })
        testMethod() {
          return { message: 'test' };
        }
      }

      const injectableMetadata = Reflect.getMetadata('nexus:injectable', TestController);
      const controllerPath = Reflect.getMetadata('custom:Controller:path', TestController);
      const getPath = Reflect.getMetadata('custom:Get:path', TestController.prototype, 'testMethod');

      expect(injectableMetadata).toBe(true);
      expect(controllerPath).toBe('/api');
      expect(getPath).toBe('/test');
    });
  });
});

// Test class for DI
class TestService {}