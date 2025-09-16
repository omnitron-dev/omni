/**
 * Token System Tests
 * Tests for token creation, validation, and utilities
 */

import {
  createToken,
  createMultiToken,
  createOptionalToken,
  createConfigToken,
  InjectionToken,
  isToken,
  isMultiToken,
  isOptionalToken,
  TokenMetadata,
  Container
} from '../../src/index.js';

describe('Token System', () => {
  describe('createToken', () => {
    it('should create a basic token', () => {
      const token = createToken<string>('TestToken');

      expect(token.name).toBe('TestToken');
      expect(token.toString()).toBe('[Token: TestToken]');
      expect(isToken(token)).toBe(true);
    });

    it('should create token with metadata', () => {
      const metadata: TokenMetadata = {
        scope: 'singleton',
        tags: ['service', 'critical'],
        description: 'Test service token'
      };

      const token = createToken<string>('TestToken', metadata);

      expect(token.metadata).toEqual(metadata);
      expect(token.metadata?.scope).toBe('singleton');
      expect(token.metadata?.tags).toContain('service');
      expect(token.metadata?.description).toBe('Test service token');
    });

    it('should validate token name', () => {
      expect(() => createToken('')).toThrow('Token name cannot be empty');
      expect(() => createToken('  ')).toThrow('Token name cannot be empty');
      expect(() => createToken(null as any)).toThrow();
      expect(() => createToken(undefined as any)).toThrow();
    });

    it('should create token with symbol', () => {
      const token = createToken<number>('NumberToken');
      expect(typeof token.symbol).toBe('symbol');
      expect(token.symbol.toString()).toContain('NumberToken');
    });

    it('should preserve token identity', () => {
      const token1 = createToken<string>('Token');
      const token2 = createToken<string>('Token');

      // Same instances with same name (token registry ensures consistency)
      expect(token1).toBe(token2);
      expect(token1.symbol).toBe(token2.symbol);

      // Different tokens with different names
      const token3 = createToken<string>('DifferentToken');
      expect(token1).not.toBe(token3);
      expect(token1.symbol).not.toBe(token3.symbol);
    });

    it('should support generic types', () => {
      interface User {
        id: string;
        name: string;
      }

      const token = createToken<User>('UserToken');
      const container = new Container();

      container.register(token, {
        useValue: { id: '1', name: 'Test' }
      });

      const user = container.resolve(token);
      expect(user.id).toBe('1');
      expect(user.name).toBe('Test');
    });
  });

  describe('createMultiToken', () => {
    it('should create a multi-token', () => {
      const token = createMultiToken<string>('MultiToken');

      expect(token.name).toBe('MultiToken');
      expect(isMultiToken(token)).toBe(true);
      expect(token.isMulti).toBe(true);
    });

    it('should work with container.resolveMany', () => {
      const container = new Container();
      const token = createMultiToken<string>('Handlers');

      container.register(token, { useValue: 'handler1' }, { multi: true });
      container.register(token, { useValue: 'handler2' }, { multi: true });
      container.register(token, { useValue: 'handler3' }, { multi: true });

      const handlers = container.resolveMany(token);
      expect(handlers).toEqual(['handler1', 'handler2', 'handler3']);
    });

    it('should maintain insertion order', () => {
      const container = new Container();
      const token = createMultiToken<number>('Numbers');

      for (let i = 0; i < 10; i++) {
        container.register(token, { useValue: i }, { multi: true });
      }

      const numbers = container.resolveMany(token);
      expect(numbers).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should support different provider types', () => {
      const container = new Container();
      const token = createMultiToken<{ type: string }>();

      class ServiceA {
        type = 'A';
      }

      container.register(token, { useClass: ServiceA }, { multi: true });
      container.register(token, { useValue: { type: 'B' } }, { multi: true });
      container.register(token, {
        useFactory: () => ({ type: 'C' }),
      }, { multi: true });

      const services = container.resolveMany(token);
      expect(services.map(s => s.type)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('createOptionalToken', () => {
    it('should create an optional token', () => {
      const token = createOptionalToken<string>('OptionalToken');

      expect(token.name).toBe('OptionalToken');
      expect(isOptionalToken(token)).toBe(true);
      expect(token.isOptional).toBe(true);
    });

    it('should resolve to undefined when not registered', () => {
      const container = new Container();
      const token = createOptionalToken<string>('Optional');

      const result = container.resolveOptional(token);
      expect(result).toBeUndefined();
    });

    it('should resolve to value when registered', () => {
      const container = new Container();
      const token = createOptionalToken<string>('Optional');

      container.register(token, { useValue: 'exists' });

      const result = container.resolveOptional(token);
      expect(result).toBe('exists');
    });

    it('should work with dependency injection', () => {
      const container = new Container();
      const optToken = createOptionalToken<string>('OptionalDep');
      const serviceToken = createToken<{ dep?: string }>('Service');

      container.register(serviceToken, {
        useFactory: (dep?: string) => ({ dep }),
        inject: [{ token: optToken, optional: true }]
      });

      const service = container.resolve(serviceToken);
      expect(service.dep).toBeUndefined();

      // Now register the optional dependency
      container.register(optToken, { useValue: 'now-exists' });

      // Re-resolve (transient by default)
      const service2 = container.resolve(serviceToken);
      expect(service2.dep).toBe('now-exists');
    });
  });

  describe('createConfigToken', () => {
    it('should create a config token with schema', () => {
      interface AppConfig {
        port: number;
        host: string;
        debug: boolean;
      }

      const token = createConfigToken<AppConfig>('AppConfig');

      expect(token.name).toBe('AppConfig');
      expect(token.isConfig).toBe(true);
    });

    it('should validate config on registration', () => {
      interface DatabaseConfig {
        host: string;
        port: number;
        username: string;
        password: string;
      }

      const token = createConfigToken<DatabaseConfig>('DatabaseConfig', {
        validate: (config) => {
          if (!config.host) throw new Error('Host is required');
          if (config.port < 1 || config.port > 65535) {
            throw new Error('Invalid port');
          }
          if (!config.username) throw new Error('Username is required');
          if (!config.password) throw new Error('Password is required');
          return true;
        }
      });

      const container = new Container();

      // Invalid config should throw
      expect(() => {
        container.register(token, {
          useValue: {
            host: 'localhost',
            port: 99999, // Invalid port
            username: 'user',
            password: 'pass'
          }
        });
      }).toThrow('Invalid port');

      // Valid config should work
      container.register(token, {
        useValue: {
          host: 'localhost',
          port: 5432,
          username: 'user',
          password: 'pass'
        }
      });

      const config = container.resolve(token);
      expect(config.port).toBe(5432);
    });

    it('should support default values', () => {
      interface ServerConfig {
        port?: number;
        host?: string;
        workers?: number;
      }

      const token = createConfigToken<ServerConfig>('ServerConfig', {
        defaults: {
          port: 3000,
          host: 'localhost',
          workers: 4
        }
      });

      const container = new Container();
      container.register(token, {
        useValue: { port: 8080 } // Partial config
      });

      const config = container.resolve(token);
      expect(config.port).toBe(8080); // Overridden
      expect(config.host).toBe('localhost'); // Default
      expect(config.workers).toBe(4); // Default
    });
  });

  describe('Token Utilities', () => {
    it('should check token types correctly', () => {
      const normalToken = createToken('Normal');
      const multiToken = createMultiToken('Multi');
      const optionalToken = createOptionalToken('Optional');
      const configToken = createConfigToken('Config');

      expect(isToken(normalToken)).toBe(true);
      expect(isToken(multiToken)).toBe(true);
      expect(isToken(optionalToken)).toBe(true);
      expect(isToken(configToken)).toBe(true);
      expect(isToken({})).toBe(false);
      expect(isToken(null)).toBe(false);
      expect(isToken('string')).toBe(false);

      expect(isMultiToken(normalToken)).toBe(false);
      expect(isMultiToken(multiToken)).toBe(true);

      expect(isOptionalToken(normalToken)).toBe(false);
      expect(isOptionalToken(optionalToken)).toBe(true);
    });

    it('should support token equality comparison', () => {
      const token1 = createToken<string>('Test');
      const token2 = createToken<string>('Test'); // Same token due to registry
      const token3 = createToken<string>('Different'); // Different token

      expect(token1.equals(token1)).toBe(true);
      expect(token1.equals(token2)).toBe(true); // Same token due to registry
      expect(token1.equals(token3)).toBe(false); // Different tokens
      expect(token1.equals(null as any)).toBe(false);
    });

    it('should support token cloning with new metadata', () => {
      const original = createToken<string>('Original', {
        scope: 'singleton',
        tags: ['original']
      });

      const cloned = original.withMetadata({
        scope: 'transient',
        tags: ['cloned'],
        description: 'Cloned token'
      });

      expect(cloned.name).toBe(original.name);
      expect(cloned.symbol).toBe(original.symbol); // Same identity
      expect(cloned.metadata?.scope).toBe('transient');
      expect(cloned.metadata?.tags).toEqual(['cloned']);
      expect(original.metadata?.scope).toBe('singleton'); // Original unchanged
    });

    it('should support token serialization for debugging', () => {
      const token = createToken<string>('DebugToken', {
        description: 'Token for debugging',
        tags: ['debug', 'test']
      });

      const json = token.toJSON();
      expect(json).toEqual({
        name: 'DebugToken',
        type: 'Token',
        metadata: {
          description: 'Token for debugging',
          tags: ['debug', 'test']
        }
      });
    });
  });

  describe('Advanced Token Features', () => {
    it('should support hierarchical tokens', () => {
      const parentToken = createToken<{ name: string }>('Parent');
      const childToken = createToken<{ name: string; age: number }>('Child', {
        parent: parentToken
      });

      const container = new Container();

      // Child can fulfill parent requirement
      container.register(childToken, {
        useValue: { name: 'John', age: 30 }
      });

      container.register(parentToken, {
        useToken: childToken // Alias to child
      });

      const parent = container.resolve(parentToken);
      expect(parent.name).toBe('John');
      expect((parent as any).age).toBe(30);
    });

    it('should support conditional tokens', () => {
      const prodToken = createToken<string>('ProdService');
      const devToken = createToken<string>('DevService');
      const serviceToken = createToken<string>('Service');

      const container = new Container({ environment: 'production' });

      container.register(prodToken, { useValue: 'production-service' });
      container.register(devToken, { useValue: 'development-service' });

      container.register(serviceToken, {
        useFactory: (context) => {
          const token = context.environment === 'production' ? prodToken : devToken;
          return container.resolve(token);
        },
        inject: [{ token: 'CONTEXT', type: 'context' }]
      });

      const service = container.resolve(serviceToken);
      expect(service).toBe('production-service');
    });

    it('should support tagged tokens for filtering', () => {
      const container = new Container();

      const tokens = [
        createToken('Service1', { tags: ['http', 'public'] }),
        createToken('Service2', { tags: ['grpc', 'internal'] }),
        createToken('Service3', { tags: ['http', 'internal'] }),
        createToken('Service4', { tags: ['websocket', 'public'] })
      ];

      tokens.forEach((token, i) => {
        container.register(token, { useValue: `service${i + 1}` });
      });

      // Filter tokens by tag
      const httpTokens = tokens.filter(t => t.metadata?.tags?.includes('http'));
      const httpServices = httpTokens.map(t => container.resolve(t));

      expect(httpServices).toEqual(['service1', 'service3']);
    });
  });
});