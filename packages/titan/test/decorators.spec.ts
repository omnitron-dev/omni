/**
 * Comprehensive tests for Titan decorators
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
  MetricsCollector
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

describe('Titan Decorators', () => {
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
      });

      it('should mark class as service with options', () => {
        @Service('TestService')
        class TestService {}

        const metadata = Reflect.getMetadata('nexus:service:name', TestService);
        expect(metadata).toBe('TestService');
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
          @Headers('authorization') auth: string,
          @Request() req: any,
          @Response() res: any
        ) {}
      }

      it('should mark parameters with metadata', () => {
        const params = Reflect.getMetadata('params', TestController.prototype, 'testMethod') || [];

        expect(params[0]).toEqual({
          type: 'query',
          name: 'filter',
          index: 0
        });

        expect(params[1]).toEqual({
          type: 'param',
          name: 'id',
          index: 1
        });

        expect(params[2]).toEqual({
          type: 'body',
          index: 2
        });

        expect(params[3]).toEqual({
          type: 'headers',
          name: 'authorization',
          index: 3
        });

        expect(params[4]).toEqual({
          type: 'request',
          index: 4
        });

        expect(params[5]).toEqual({
          type: 'response',
          index: 5
        });
      });
    });
  });

  describe('Module Decorator', () => {
    it('should create module with metadata', () => {
      @Module({
        name: 'TestModule',
        version: '1.0.0',
        providers: [],
        imports: [],
        exports: []
      })
      class TestModule {}

      const metadata = Reflect.getMetadata('module', TestModule);
      expect(metadata).toEqual({
        name: 'TestModule',
        version: '1.0.0',
        providers: [],
        imports: [],
        exports: []
      });
    });
  });

  describe('Event Decorators', () => {
    describe('@Event', () => {
      it('should mark class as event', () => {
        @Event('user.created')
        class UserCreatedEvent {}

        const metadata = Reflect.getMetadata('event', UserCreatedEvent);
        expect(metadata).toBe('user.created');
      });
    });

    describe('@EventHandler', () => {
      it('should mark method as event handler', () => {
        class TestService {
          @EventHandler('user.created')
          handleUserCreated() {}
        }

        const metadata = Reflect.getMetadata('event-handler', TestService.prototype, 'handleUserCreated');
        expect(metadata).toEqual({
          event: 'user.created',
          options: {}
        });
      });

      it('should mark method as event handler with options', () => {
        class TestService {
          @EventHandler('user.created', { async: true, priority: 10 })
          handleUserCreated() {}
        }

        const metadata = Reflect.getMetadata('event-handler', TestService.prototype, 'handleUserCreated');
        expect(metadata).toEqual({
          event: 'user.created',
          options: { async: true, priority: 10 }
        });
      });
    });

    describe('@EventListener', () => {
      it('should mark class as event listener', () => {
        @EventListener(['user.created', 'user.updated'])
        class UserEventListener {}

        const metadata = Reflect.getMetadata('event-listener', UserEventListener);
        expect(metadata).toEqual(['user.created', 'user.updated']);
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
        @UseMiddleware(authMiddleware)
        class TestController {}

        const metadata = Reflect.getMetadata('middleware', TestController);
        expect(metadata).toEqual([authMiddleware]);
      });

      it('should attach middleware to method', () => {
        class TestController {
          @UseMiddleware(authMiddleware)
          testMethod() {}
        }

        const metadata = Reflect.getMetadata('middleware', TestController.prototype, 'testMethod');
        expect(metadata).toEqual([authMiddleware]);
      });
    });

    describe('@UseGuard', () => {
      it('should attach guard to class', () => {
        @UseGuard(loggingGuard)
        class TestController {}

        const metadata = Reflect.getMetadata('guards', TestController);
        expect(metadata).toEqual([loggingGuard]);
      });
    });

    describe('@UseInterceptor', () => {
      it('should attach interceptor to class', () => {
        @UseInterceptor(cacheInterceptor)
        class TestController {}

        const metadata = Reflect.getMetadata('interceptors', TestController);
        expect(metadata).toEqual([cacheInterceptor]);
      });
    });

    describe('@UsePipe', () => {
      it('should attach pipe to class', () => {
        @UsePipe(validationPipe)
        class TestController {}

        const metadata = Reflect.getMetadata('pipes', TestController);
        expect(metadata).toEqual([validationPipe]);
      });
    });
  });

  describe('Caching Decorators', () => {
    describe('@Cache', () => {
      it('should mark method for caching with TTL', () => {
        class TestService {
          @Cache(3600)
          getData() {}
        }

        const metadata = Reflect.getMetadata('cache', TestService.prototype, 'getData');
        expect(metadata).toEqual({
          ttl: 3600,
          key: undefined
        });
      });

      it('should mark method for caching with options', () => {
        class TestService {
          @Cache({ ttl: 3600, key: 'test-data' })
          getData() {}
        }

        const metadata = Reflect.getMetadata('cache', TestService.prototype, 'getData');
        expect(metadata).toEqual({
          ttl: 3600,
          key: 'test-data'
        });
      });
    });

    describe('@Cached', () => {
      it('should mark property as cached', () => {
        class TestService {
          @Cached({ ttl: 3600 })
          data: any;
        }

        const metadata = Reflect.getMetadata('cached', TestService.prototype, 'data');
        expect(metadata).toEqual({ ttl: 3600 });
      });
    });
  });

  describe('Utility Decorators', () => {
    describe('@Logger', () => {
      it('should inject logger into property', () => {
        const mockLogger: TestLogger = {
          info: jest.fn(),
          error: jest.fn()
        };

        container.register(TestLoggerToken, { useValue: mockLogger });

        @Injectable()
        class TestService {
          @LoggerDecorator()
          logger!: TestLogger;
        }

        // Note: In real implementation, this would need framework support
        const metadata = Reflect.getMetadata('logger', TestService.prototype, 'logger');
        expect(metadata).toBe(true);
      });
    });

    describe('@Config', () => {
      it('should inject config value into property', () => {
        @Injectable()
        class TestService {
          @ConfigDecorator('app.name')
          appName!: string;

          @ConfigDecorator('app.port', 3000)
          port!: number;
        }

        const nameMetadata = Reflect.getMetadata('config', TestService.prototype, 'appName');
        expect(nameMetadata).toEqual({
          path: 'app.name',
          defaultValue: undefined
        });

        const portMetadata = Reflect.getMetadata('config', TestService.prototype, 'port');
        expect(portMetadata).toEqual({
          path: 'app.port',
          defaultValue: 3000
        });
      });
    });

    describe('@Health', () => {
      it('should mark method as health check', () => {
        class TestService {
          @Health()
          checkHealth() {}
        }

        const metadata = Reflect.getMetadata('health', TestService.prototype, 'checkHealth');
        expect(metadata).toBe(true);
      });
    });

    describe('@MetricsCollector', () => {
      it('should mark method for metrics collection', () => {
        class TestService {
          @MetricsCollector('request.duration')
          handleRequest() {}
        }

        const metadata = Reflect.getMetadata('metrics', TestService.prototype, 'handleRequest');
        expect(metadata).toEqual({
          name: 'request.duration',
          type: 'histogram'
        });
      });

      it('should mark method for metrics collection with options', () => {
        class TestService {
          @MetricsCollector({ name: 'request.count', type: 'counter' })
          handleRequest() {}
        }

        const metadata = Reflect.getMetadata('metrics', TestService.prototype, 'handleRequest');
        expect(metadata).toEqual({
          name: 'request.count',
          type: 'counter'
        });
      });
    });
  });

  describe('Combined Decorators', () => {
    it('should work with multiple decorators on same class', () => {
      @Injectable()
      @Singleton()
      @Service('TestService')
      @Controller('/test')
      @UseMiddleware(jest.fn())
      @EventListener(['test.event'])
      class TestClass {}

      expect(Reflect.getMetadata('injectable', TestClass)).toBe(true);
      expect(Reflect.getMetadata('scope', TestClass)).toBe('singleton');
      expect(Reflect.getMetadata('service', TestClass)).toEqual({
        name: 'TestService',
        version: undefined
      });
      expect(Reflect.getMetadata('controller', TestClass)).toBeDefined();
      expect(Reflect.getMetadata('middleware', TestClass)).toBeDefined();
      expect(Reflect.getMetadata('event-listener', TestClass)).toEqual(['test.event']);
    });

    it('should work with multiple decorators on same method', () => {
      class TestClass {
        @Get('/test')
        @Cache(3600)
        @UseMiddleware(jest.fn())
        @Health()
        @MetricsCollector('test.metric')
        testMethod() {}
      }

      expect(Reflect.getMetadata('route', TestClass.prototype, 'testMethod')).toBeDefined();
      expect(Reflect.getMetadata('cache', TestClass.prototype, 'testMethod')).toBeDefined();
      expect(Reflect.getMetadata('middleware', TestClass.prototype, 'testMethod')).toBeDefined();
      expect(Reflect.getMetadata('health', TestClass.prototype, 'testMethod')).toBe(true);
      expect(Reflect.getMetadata('metrics', TestClass.prototype, 'testMethod')).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle decorators with no parameters', () => {
      @Injectable()
      @Singleton()
      class TestService {}

      expect(Reflect.getMetadata('injectable', TestService)).toBe(true);
      expect(Reflect.getMetadata('scope', TestService)).toBe('singleton');
    });

    it('should handle decorators with undefined values', () => {
      @Service(undefined as any)
      class TestService {}

      const metadata = Reflect.getMetadata('service', TestService);
      expect(metadata).toEqual({
        name: undefined,
        version: undefined
      });
    });

    it('should handle decorators on static methods', () => {
      class TestService {
        @Cache(3600)
        static getData() {}
      }

      const metadata = Reflect.getMetadata('cache', TestService, 'getData');
      expect(metadata).toEqual({
        ttl: 3600,
        key: undefined
      });
    });

    it('should preserve metadata when class is extended', () => {
      @Injectable()
      @Service('BaseService')
      class BaseService {
        @Get('/base')
        baseMethod() {}
      }

      @Service('ExtendedService')
      class ExtendedService extends BaseService {
        @Get('/extended')
        extendedMethod() {}
      }

      // Child should have its own metadata
      expect(Reflect.getMetadata('service', ExtendedService)).toEqual({
        name: 'ExtendedService',
        version: undefined
      });

      // Parent metadata should be preserved
      expect(Reflect.getMetadata('service', BaseService)).toEqual({
        name: 'BaseService',
        version: undefined
      });
    });
  });
});

// Test service for integration
class TestService {
  data: string = 'test';

  getData(): string {
    return this.data;
  }

  setData(value: string): void {
    this.data = value;
  }
}