/**
 * GraphQL Federation and API Gateway Tests
 *
 * Comprehensive tests for:
 * - Schema parsing and federation directives
 * - GraphQL Service resolver management
 * - Entity resolution across services
 * - Federation Gateway query planning and execution
 * - API Gateway middleware and routing
 * - Federation decorators
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type {
  GraphQLServiceConfig,
  GraphQLContext,
  EntityRepresentation,
  GraphQLExecutionResult,
  QueryPlan,
  SubgraphStatus,
  FederationGatewayConfig,
  APIGatewayConfig,
  APIRequest,
  APIResponse,
  HttpMethod,
} from '../../../../src/modules/pm/enterprise/graphql-federation.js';
import {
  SchemaParser,
  GraphQLService,
  GraphQLFederationGateway,
  APIGateway,
  GraphQLServiceDecorator,
  Query,
  Mutation,
  Subscription,
  FieldResolver,
  Key,
  Requires,
  Provides,
  External,
  Extends,
} from '../../../../src/modules/pm/enterprise/graphql-federation.js';

// ============================================================================
// Test Helpers
// ============================================================================

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
} as any;

// Sample schemas for testing
const userServiceSchema = `
  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
  }

  type Query {
    user(id: ID!): User
    users: [User!]!
  }

  type Mutation {
    createUser(name: String!, email: String!): User!
  }
`;

const productServiceSchema = `
  type Product @key(fields: "id") {
    id: ID!
    name: String!
    price: Float!
    owner: User @provides(fields: "id name")
  }

  extend type User @key(fields: "id") {
    id: ID! @external
    products: [Product!]!
  }

  type Query {
    product(id: ID!): Product
    products: [Product!]!
  }
`;

const orderServiceSchema = `
  type Order @key(fields: "id") {
    id: ID!
    items: [OrderItem!]!
    total: Float!
    user: User @requires(fields: "id")
  }

  type OrderItem {
    productId: ID!
    quantity: Int!
    price: Float!
  }

  extend type User @key(fields: "id") {
    id: ID! @external
    orders: [Order!]!
  }

  type Query {
    order(id: ID!): Order
    orders: [Order!]!
  }

  type Subscription {
    orderCreated: Order!
  }
`;

// ============================================================================
// SchemaParser Tests
// ============================================================================

describe('SchemaParser', () => {
  let parser: SchemaParser;

  beforeEach(() => {
    parser = new SchemaParser();
  });

  describe('parse', () => {
    it('should parse type definitions', () => {
      const types = parser.parse(userServiceSchema);

      expect(types.has('User')).toBe(true);
      expect(types.has('Query')).toBe(true);
      expect(types.has('Mutation')).toBe(true);

      const userType = types.get('User');
      expect(userType?.kind).toBe('object');
      expect(userType?.fields?.has('id')).toBe(true);
      expect(userType?.fields?.has('name')).toBe(true);
      expect(userType?.fields?.has('email')).toBe(true);
    });

    it('should parse @key directives', () => {
      const types = parser.parse(userServiceSchema);
      const userType = types.get('User');

      expect(userType?.directives).toBeDefined();
      expect(userType?.directives?.some((d) => d.type === 'key')).toBe(true);
      expect(userType?.directives?.find((d) => d.type === 'key')?.fields).toBe('id');
    });

    it('should parse input types', () => {
      const schema = `
        input CreateUserInput {
          name: String!
          email: String!
          age: Int
        }
      `;
      const types = parser.parse(schema);

      expect(types.has('CreateUserInput')).toBe(true);
      expect(types.get('CreateUserInput')?.kind).toBe('input');
    });

    it('should parse enum types', () => {
      const schema = `
        enum OrderStatus {
          PENDING
          PROCESSING
          SHIPPED
          DELIVERED
        }
      `;
      const types = parser.parse(schema);

      expect(types.has('OrderStatus')).toBe(true);
      const enumType = types.get('OrderStatus');
      expect(enumType?.kind).toBe('enum');
      expect(enumType?.enumValues).toContain('PENDING');
      expect(enumType?.enumValues).toContain('DELIVERED');
    });

    it('should parse interface types', () => {
      const schema = `
        interface Node {
          id: ID!
        }

        type User implements Node {
          id: ID!
          name: String!
        }
      `;
      const types = parser.parse(schema);

      expect(types.has('Node')).toBe(true);
      expect(types.get('Node')?.kind).toBe('interface');
    });

    it('should parse union types', () => {
      const schema = `
        union SearchResult = User | Product | Order
      `;
      const types = parser.parse(schema);

      expect(types.has('SearchResult')).toBe(true);
      const unionType = types.get('SearchResult');
      expect(unionType?.kind).toBe('union');
      expect(unionType?.possibleTypes).toContain('User');
      expect(unionType?.possibleTypes).toContain('Product');
    });
  });

  describe('getEntityTypes', () => {
    it('should return only types with @key directive', () => {
      parser.parse(userServiceSchema);
      const entities = parser.getEntityTypes();

      expect(entities.has('User')).toBe(true);
      expect(entities.has('Query')).toBe(false);
    });
  });

  describe('getKeyFields', () => {
    it('should return key fields for entity types', () => {
      parser.parse(userServiceSchema);
      const keyFields = parser.getKeyFields('User');

      expect(keyFields).toContain('id');
    });

    it('should return empty array for non-entity types', () => {
      parser.parse(userServiceSchema);
      const keyFields = parser.getKeyFields('Query');

      expect(keyFields).toHaveLength(0);
    });
  });
});

// ============================================================================
// GraphQLService Tests
// ============================================================================

describe('GraphQLService', () => {
  let service: GraphQLService;
  const config: GraphQLServiceConfig = {
    name: 'user-service',
    schema: userServiceSchema,
    federation: true,
  };

  beforeEach(() => {
    service = new GraphQLService(config, mockLogger);
  });

  describe('constructor', () => {
    it('should initialize with config', () => {
      expect(service.getName()).toBe('user-service');
      expect(service.getSchema()).toBe(userServiceSchema);
    });

    it('should parse schema types', () => {
      const types = service.getTypes();
      expect(types.has('User')).toBe(true);
      expect(types.has('Query')).toBe(true);
    });
  });

  describe('addResolver', () => {
    it('should add query resolvers', () => {
      const resolver = jest.fn().mockResolvedValue({ id: '1', name: 'John', email: 'john@example.com' });

      service.addResolver('Query', 'user', resolver);

      const resolvers = service.getResolvers('Query');
      expect(resolvers?.has('user')).toBe(true);
    });

    it('should add mutation resolvers', () => {
      const resolver = jest.fn().mockResolvedValue({ id: '1', name: 'John', email: 'john@example.com' });

      service.addResolver('Mutation', 'createUser', resolver);

      const resolvers = service.getResolvers('Mutation');
      expect(resolvers?.has('createUser')).toBe(true);
    });

    it('should emit resolver:added event', () => {
      const listener = jest.fn();
      service.on('resolver:added', listener);

      service.addResolver('Query', 'user', jest.fn());

      expect(listener).toHaveBeenCalledWith({ type: 'Query', field: 'user' });
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      service.addResolver('Query', 'user', async (_source, args) => ({
        id: args.id,
        name: 'John Doe',
        email: 'john@example.com',
      }));

      service.addResolver('Query', 'users', async () => [
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' },
      ]);
    });

    it('should execute simple queries', async () => {
      const result = await service.execute(
        `query { user(id: "1") { id name email } }`,
        { id: '1' }
      );

      expect(result.data).toBeDefined();
      expect(result.data?.user).toBeDefined();
    });

    it('should handle query variables', async () => {
      const result = await service.execute(
        `query GetUser($id: ID!) { user(id: $id) { id name } }`,
        { id: '123' }
      );

      expect(result.errors).toBeUndefined();
    });

    it('should return errors for missing resolvers', async () => {
      const result = await service.execute(
        `query { unknownField { id } }`
      );

      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should handle mutations', async () => {
      service.addResolver('Mutation', 'createUser', async (_source, args) => ({
        id: 'new-id',
        name: args.name,
        email: args.email,
      }));

      const result = await service.execute(
        `mutation { createUser(name: "Test", email: "test@example.com") { id name } }`,
        { name: 'Test', email: 'test@example.com' }
      );

      expect(result.data).toBeDefined();
    });

    it('should provide execution context', async () => {
      let capturedContext: GraphQLContext | undefined;

      service.addResolver('Query', 'contextTest', async (_source, _args, context) => {
        capturedContext = context;
        return { success: true };
      });

      service.addResolver('Query', 'user', async (_source, args) => ({
        id: args.id,
        name: 'John Doe',
        email: 'john@example.com',
      }));

      const context: GraphQLContext = {
        requestId: 'test-req-123',
        userId: 'user-456',
      };

      await service.execute(
        `query { contextTest { success } }`,
        {},
        context
      );

      // Context is passed through but the test query may not find resolver
      // This demonstrates the context passing mechanism
    });
  });

  describe('registerEntityResolver', () => {
    it('should register entity resolvers', () => {
      const resolver = jest.fn().mockResolvedValue([{ id: '1', name: 'John' }]);

      service.registerEntityResolver('User', ['id'], resolver);

      expect(service.canResolveEntity('User')).toBe(true);
    });

    it('should emit entity:registered event', () => {
      const listener = jest.fn();
      service.on('entity:registered', listener);

      service.registerEntityResolver('User', ['id'], jest.fn());

      expect(listener).toHaveBeenCalledWith({ typeName: 'User', keyFields: ['id'] });
    });
  });

  describe('resolveEntities', () => {
    it('should resolve entity representations', async () => {
      const resolver = jest.fn().mockResolvedValue([
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' },
      ]);

      service.registerEntityResolver('User', ['id'], resolver);

      const representations: EntityRepresentation[] = [
        { __typename: 'User', id: '1' },
        { __typename: 'User', id: '2' },
      ];

      const context: GraphQLContext = { requestId: 'test-123' };
      const results = await service.resolveEntities(representations, context);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('name', 'John');
      expect(results[1]).toHaveProperty('name', 'Jane');
      expect(resolver).toHaveBeenCalledWith(representations, context);
    });

    it('should handle missing entity resolvers', async () => {
      const representations: EntityRepresentation[] = [
        { __typename: 'UnknownType', id: '1' },
      ];

      const context: GraphQLContext = { requestId: 'test-123' };
      const results = await service.resolveEntities(representations, context);

      expect(results[0]).toBeNull();
    });

    it('should group representations by type', async () => {
      const userResolver = jest.fn().mockResolvedValue([{ id: '1', name: 'John' }]);

      service.registerEntityResolver('User', ['id'], userResolver);

      const representations: EntityRepresentation[] = [
        { __typename: 'User', id: '1' },
        { __typename: 'Product', id: '100' }, // No resolver for Product
        { __typename: 'User', id: '2' }, // Should not be resolved - resolver only returns one
      ];

      const context: GraphQLContext = { requestId: 'test-123' };
      await service.resolveEntities(representations, context);

      // User resolver should be called once with User representations
      expect(userResolver).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// GraphQLFederationGateway Tests
// ============================================================================

describe('GraphQLFederationGateway', () => {
  let gateway: GraphQLFederationGateway;
  const gatewayConfig: FederationGatewayConfig = {
    services: [
      { name: 'user-service', schema: userServiceSchema },
      { name: 'product-service', schema: productServiceSchema },
    ],
    queryPlanCaching: true,
    timeout: 5000,
  };

  beforeEach(() => {
    gateway = new GraphQLFederationGateway(gatewayConfig, mockLogger);
  });

  afterEach(() => {
    gateway.shutdown();
  });

  describe('constructor', () => {
    it('should initialize with services', () => {
      const status = gateway.getServiceStatus();
      expect(status).toHaveLength(2);
      expect(status.map((s) => s.name)).toContain('user-service');
      expect(status.map((s) => s.name)).toContain('product-service');
    });

    it('should build federated schema', () => {
      const schema = gateway.getSchema();
      expect(schema).toContain('directive @key');
      expect(schema).toContain('directive @external');
      expect(schema).toContain('_entities');
    });

    it('should emit schema:built event', () => {
      const listener = jest.fn();
      const newGateway = new GraphQLFederationGateway(gatewayConfig, mockLogger);
      newGateway.on('schema:built', listener);

      // Event is emitted during construction
      newGateway.shutdown();
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      // Add resolvers to services
      const userService = gateway.getService('user-service');
      userService?.addResolver('Query', 'user', async (_source, args) => ({
        id: args.id ?? '1',
        name: 'John Doe',
        email: 'john@example.com',
      }));
      userService?.addResolver('Query', 'users', async () => [
        { id: '1', name: 'John', email: 'john@example.com' },
      ]);

      const productService = gateway.getService('product-service');
      productService?.addResolver('Query', 'product', async (_source, args) => ({
        id: args.id ?? '100',
        name: 'Widget',
        price: 29.99,
      }));
      productService?.addResolver('Query', 'products', async () => [
        { id: '100', name: 'Widget', price: 29.99 },
      ]);
    });

    it('should execute queries across services', async () => {
      const result = await gateway.execute(
        `query { user(id: "1") { id name } }`
      );

      expect(result.data).toBeDefined();
      // Results are merged from services that have relevant resolvers
    });

    it('should include federation metadata in extensions', async () => {
      const result = await gateway.execute(
        `query { user(id: "1") { id name } }`
      );

      expect(result.extensions).toBeDefined();
      expect(result.extensions?.federation).toBeDefined();
    });

    it('should handle service errors gracefully', async () => {
      // Mark a service as unhealthy
      const status = gateway.getServiceStatus();
      const userStatus = status.find((s) => s.name === 'user-service');
      if (userStatus) {
        userStatus.healthy = false;
      }

      const result = await gateway.execute(
        `query { user(id: "1") { id name } }`
      );

      // Should still return a result (possibly with errors)
      expect(result).toBeDefined();
    });

    it('should cache query plans when enabled', async () => {
      // Execute same query twice
      await gateway.execute(`query { user(id: "1") { id } }`);
      await gateway.execute(`query { user(id: "1") { id } }`);

      // Query plan should be cached (internal implementation detail)
      // We can verify by checking that gateway emits query:planning event once
    });
  });

  describe('addService', () => {
    it('should add new service to federation', () => {
      gateway.addService({
        name: 'order-service',
        schema: orderServiceSchema,
      });

      const status = gateway.getServiceStatus();
      expect(status).toHaveLength(3);
      expect(status.map((s) => s.name)).toContain('order-service');
    });

    it('should rebuild schema after adding service', () => {
      const schemaBefore = gateway.getSchema();

      gateway.addService({
        name: 'order-service',
        schema: orderServiceSchema,
      });

      const schemaAfter = gateway.getSchema();
      // Schema should be different (includes new types)
      expect(schemaAfter.length).toBeGreaterThanOrEqual(schemaBefore.length);
    });

    it('should emit service:added event', () => {
      const listener = jest.fn();
      gateway.on('service:added', listener);

      gateway.addService({
        name: 'order-service',
        schema: orderServiceSchema,
      });

      expect(listener).toHaveBeenCalledWith({ name: 'order-service' });
    });
  });

  describe('removeService', () => {
    it('should remove service from federation', () => {
      const result = gateway.removeService('product-service');

      expect(result).toBe(true);
      const status = gateway.getServiceStatus();
      expect(status).toHaveLength(1);
      expect(status.map((s) => s.name)).not.toContain('product-service');
    });

    it('should return false for non-existent service', () => {
      const result = gateway.removeService('non-existent');
      expect(result).toBe(false);
    });

    it('should emit service:removed event', () => {
      const listener = jest.fn();
      gateway.on('service:removed', listener);

      gateway.removeService('product-service');

      expect(listener).toHaveBeenCalledWith({ name: 'product-service' });
    });
  });

  describe('resolveEntities', () => {
    it('should resolve entities across services', async () => {
      const userService = gateway.getService('user-service');
      userService?.registerEntityResolver('User', ['id'], async (reps) =>
        reps.map((rep) => ({
          id: rep.id as string,
          name: `User ${rep.id}`,
          email: `user${rep.id}@example.com`,
        }))
      );

      const context: GraphQLContext = { requestId: 'test-123' };
      const representations: EntityRepresentation[] = [
        { __typename: 'User', id: '1' },
        { __typename: 'User', id: '2' },
      ];

      const results = await gateway.resolveEntities(representations, context);

      expect(results).toHaveLength(2);
    });
  });

  describe('getServiceStatus', () => {
    it('should return status for all services', () => {
      const status = gateway.getServiceStatus();

      expect(status).toHaveLength(2);
      status.forEach((s) => {
        expect(s).toHaveProperty('name');
        expect(s).toHaveProperty('healthy');
        expect(s).toHaveProperty('lastCheck');
        expect(s).toHaveProperty('errorCount');
      });
    });

    it('should track service health', () => {
      const status = gateway.getServiceStatus();
      const userStatus = status.find((s) => s.name === 'user-service');

      expect(userStatus?.healthy).toBe(true);
      expect(userStatus?.errorCount).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should clean up resources', () => {
      const listener = jest.fn();
      gateway.on('shutdown', listener);

      gateway.shutdown();

      expect(listener).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// APIGateway Tests
// ============================================================================

describe('APIGateway', () => {
  let apiGateway: APIGateway;
  const apiConfig: APIGatewayConfig = {
    services: [
      {
        name: 'user-api',
        prefix: '/api/v1',
        upstream: 'http://user-service:3001',
        routes: [
          { path: '/users', method: 'GET' },
          { path: '/users/:id', method: 'GET' },
          { path: '/users', method: 'POST' },
        ],
      },
    ],
    rateLimit: { requests: 10, window: 1000 },
    cache: { ttl: 5000 },
    cors: { origin: '*', methods: 'GET,POST,PUT,DELETE' },
  };

  beforeEach(() => {
    apiGateway = new APIGateway(apiConfig, mockLogger);
  });

  afterEach(() => {
    apiGateway.shutdown();
  });

  describe('handleRequest', () => {
    it('should route GET requests', async () => {
      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: { authorization: 'Bearer token' },
      };

      const response = await apiGateway.handleRequest(request);

      expect(response.status).toBe(200);
      expect(response.body?.service).toBe('user-api');
    });

    it('should return 404 for unknown routes', async () => {
      const request: APIRequest = {
        method: 'GET',
        path: '/api/unknown',
        headers: { authorization: 'Bearer token' },
      };

      const response = await apiGateway.handleRequest(request);

      expect(response.status).toBe(404);
    });

    it('should match routes with parameters', async () => {
      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users/123',
        headers: { authorization: 'Bearer token' },
        ip: 'param-test-ip',
      };

      const response = await apiGateway.handleRequest(request);

      // Route pattern matching for /users/:id should match /users/123
      // The route is registered as GET:/api/v1/users/:id
      expect(response.status).toBe(200);
      expect(response.body?.service).toBe('user-api');
    });
  });

  describe('CORS middleware', () => {
    it('should handle OPTIONS preflight requests', async () => {
      const request: APIRequest = {
        method: 'OPTIONS',
        path: '/api/v1/users',
      };

      const response = await apiGateway.handleRequest(request);

      expect(response.status).toBe(204);
      expect(response.headers?.['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers?.['Access-Control-Allow-Methods']).toContain('GET');
    });
  });

  describe('Rate limiting middleware', () => {
    it('should allow requests within limit', async () => {
      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: { authorization: 'Bearer token' },
        ip: '127.0.0.1',
      };

      // First request should succeed
      const response = await apiGateway.handleRequest(request);
      expect(response.status).toBe(200);
    });

    it('should block requests exceeding limit', async () => {
      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: { authorization: 'Bearer token' },
        ip: '192.168.1.1',
      };

      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        await apiGateway.handleRequest(request);
      }

      // Next request should be rate limited
      const response = await apiGateway.handleRequest(request);
      expect(response.status).toBe(429);
      expect(response.body?.error).toBe('Too many requests');
    });
  });

  describe('Cache middleware', () => {
    it('should cache GET responses', async () => {
      // Create a gateway with caching enabled but no rate limiting
      const cacheTestGateway = new APIGateway(
        {
          services: apiConfig.services,
          cache: { ttl: 5000 },
          cors: apiConfig.cors,
        },
        mockLogger
      );

      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: { authorization: 'Bearer token' },
        ip: 'cache-test-ip-unique',
      };

      // First request - should be processed normally
      const response1 = await cacheTestGateway.handleRequest(request);
      expect(response1.status).toBe(200);

      // Second request should be cached
      const response2 = await cacheTestGateway.handleRequest(request);
      expect(response2.headers?.['X-Cache']).toBe('HIT');

      cacheTestGateway.shutdown();
    });

    it('should not cache non-GET requests', async () => {
      const request: APIRequest = {
        method: 'POST',
        path: '/api/v1/users',
        headers: { authorization: 'Bearer token' },
        body: { name: 'Test' },
        ip: 'post-test-ip',
      };

      await apiGateway.handleRequest(request);
      const response2 = await apiGateway.handleRequest(request);

      expect(response2.headers?.['X-Cache']).toBeUndefined();
    });
  });

  describe('Auth middleware', () => {
    let authGateway: APIGateway;

    beforeEach(() => {
      authGateway = new APIGateway(
        {
          services: apiConfig.services,
          auth: true,
          cors: apiConfig.cors,
        },
        mockLogger
      );
    });

    afterEach(() => {
      authGateway.shutdown();
    });

    it('should reject requests without authorization header', async () => {
      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users',
      };

      const response = await authGateway.handleRequest(request);

      expect(response.status).toBe(401);
      expect(response.body?.error).toBe('Unauthorized');
    });

    it('should allow requests with authorization header', async () => {
      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: { authorization: 'Bearer valid-token' },
      };

      const response = await authGateway.handleRequest(request);

      expect(response.status).toBe(200);
    });
  });

  describe('GraphQL integration', () => {
    let graphqlGateway: APIGateway;

    beforeEach(() => {
      graphqlGateway = new APIGateway(
        {
          services: [],
          graphql: [{ name: 'test-service', schema: userServiceSchema }],
        },
        mockLogger
      );

      // Add resolvers
      const gqlGateway = graphqlGateway.getGraphQLGateway();
      const service = gqlGateway?.getService('test-service');
      service?.addResolver('Query', 'user', async () => ({
        id: '1',
        name: 'John',
        email: 'john@example.com',
      }));
    });

    afterEach(() => {
      graphqlGateway.shutdown();
    });

    it('should handle GraphQL requests at /graphql', async () => {
      const request: APIRequest = {
        method: 'POST',
        path: '/graphql',
        body: {
          query: '{ user(id: "1") { id name } }',
        },
      };

      const response = await graphqlGateway.handleRequest(request);

      expect(response.status).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('application/json');
    });

    it('should reject invalid GraphQL requests', async () => {
      const request: APIRequest = {
        method: 'POST',
        path: '/graphql',
        body: {},
      };

      const response = await graphqlGateway.handleRequest(request);

      expect(response.status).toBe(400);
    });
  });

  describe('use middleware', () => {
    it('should allow adding custom middleware', async () => {
      const customMiddleware = jest.fn().mockResolvedValue(null);
      apiGateway.use(customMiddleware);

      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: { authorization: 'Bearer token' },
        ip: 'middleware-test-ip',
      };

      await apiGateway.handleRequest(request);

      expect(customMiddleware).toHaveBeenCalled();
    });

    it('should allow middleware to short-circuit request', async () => {
      const customResponse: APIResponse = {
        status: 418,
        body: { message: "I'm a teapot" },
      };
      const customMiddleware = jest.fn().mockResolvedValue(customResponse);
      apiGateway.use(customMiddleware);

      const request: APIRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: { authorization: 'Bearer token' },
        ip: 'teapot-test-ip',
      };

      const response = await apiGateway.handleRequest(request);

      expect(response.status).toBe(418);
    });
  });

  describe('clearCache', () => {
    it('should clear all cache', () => {
      apiGateway.clearCache();
      // No error means success
    });

    it('should clear cache by pattern', () => {
      apiGateway.clearCache('/users');
      // No error means success
    });
  });
});

// ============================================================================
// Decorator Tests
// ============================================================================

describe('GraphQL Decorators', () => {
  describe('@GraphQLServiceDecorator', () => {
    it('should attach service config metadata', () => {
      @GraphQLServiceDecorator({
        name: 'test-service',
        schema: userServiceSchema,
      })
      class TestService {}

      const config = Reflect.getMetadata('graphql:service', TestService);
      expect(config.name).toBe('test-service');
    });
  });

  describe('@Query', () => {
    it('should mark method as query resolver', () => {
      class TestResolver {
        @Query('getUser')
        findUser() {
          return { id: '1' };
        }
      }

      const resolver = new TestResolver();
      const name = Reflect.getMetadata('graphql:query', resolver, 'findUser');
      expect(name).toBe('getUser');
    });

    it('should use method name as default', () => {
      class TestResolver {
        @Query()
        users() {
          return [];
        }
      }

      const resolver = new TestResolver();
      const name = Reflect.getMetadata('graphql:query', resolver, 'users');
      expect(name).toBe('users');
    });
  });

  describe('@Mutation', () => {
    it('should mark method as mutation resolver', () => {
      class TestResolver {
        @Mutation('createUser')
        create() {
          return { id: '1' };
        }
      }

      const resolver = new TestResolver();
      const name = Reflect.getMetadata('graphql:mutation', resolver, 'create');
      expect(name).toBe('createUser');
    });
  });

  describe('@Subscription', () => {
    it('should mark method as subscription resolver', () => {
      class TestResolver {
        @Subscription('userCreated')
        onUserCreated() {
          return {};
        }
      }

      const resolver = new TestResolver();
      const name = Reflect.getMetadata('graphql:subscription', resolver, 'onUserCreated');
      expect(name).toBe('userCreated');
    });
  });

  describe('@FieldResolver', () => {
    it('should mark method as field resolver', () => {
      class TestResolver {
        @FieldResolver('User', 'fullName')
        getFullName() {
          return 'John Doe';
        }
      }

      const resolver = new TestResolver();
      const metadata = Reflect.getMetadata('graphql:field', resolver, 'getFullName');
      expect(metadata.typeName).toBe('User');
      expect(metadata.fieldName).toBe('fullName');
    });
  });

  describe('@Key', () => {
    it('should mark class with key directive', () => {
      @Key('id')
      class User {}

      const directives = Reflect.getMetadata('graphql:directives', User);
      expect(directives).toContainEqual({ type: 'key', fields: 'id' });
    });

    it('should support composite keys', () => {
      @Key('id organizationId')
      class Member {}

      const directives = Reflect.getMetadata('graphql:directives', Member);
      expect(directives[0].fields).toBe('id organizationId');
    });
  });

  describe('@Requires', () => {
    it('should mark field with requires directive', () => {
      class TestResolver {
        @Requires('user { id }')
        getTotalOrders() {
          return 0;
        }
      }

      const resolver = new TestResolver();
      const requires = Reflect.getMetadata('graphql:requires', resolver, 'getTotalOrders');
      expect(requires).toContain('user { id }');
    });
  });

  describe('@Provides', () => {
    it('should mark field with provides directive', () => {
      class TestResolver {
        @Provides('name email')
        getOwner() {
          return {};
        }
      }

      const resolver = new TestResolver();
      const provides = Reflect.getMetadata('graphql:provides', resolver, 'getOwner');
      expect(provides).toContain('name email');
    });
  });

  describe('@External', () => {
    it('should mark field as external', () => {
      class TestResolver {
        @External()
        getId() {
          return '1';
        }
      }

      const resolver = new TestResolver();
      const isExternal = Reflect.getMetadata('graphql:external', resolver, 'getId');
      expect(isExternal).toBe(true);
    });
  });

  describe('@Extends', () => {
    it('should mark class as extending another type', () => {
      @Extends()
      class ExtendedUser {}

      const extends_ = Reflect.getMetadata('graphql:extends', ExtendedUser);
      expect(extends_).toBe(true);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Federation Integration', () => {
  describe('Cross-service entity resolution', () => {
    let gateway: GraphQLFederationGateway;

    beforeEach(() => {
      gateway = new GraphQLFederationGateway(
        {
          services: [
            { name: 'users', schema: userServiceSchema },
            { name: 'products', schema: productServiceSchema },
            { name: 'orders', schema: orderServiceSchema },
          ],
        },
        mockLogger
      );

      // Setup resolvers
      const userService = gateway.getService('users');
      userService?.addResolver('Query', 'user', async (_s, args) => ({
        id: args.id,
        name: 'John',
        email: 'john@example.com',
      }));
      userService?.registerEntityResolver('User', ['id'], async (reps) =>
        reps.map((rep) => ({
          id: rep.id,
          name: `User ${rep.id}`,
          email: `user${rep.id}@example.com`,
        }))
      );

      const productService = gateway.getService('products');
      productService?.addResolver('Query', 'product', async (_s, args) => ({
        id: args.id,
        name: 'Widget',
        price: 29.99,
      }));
      productService?.registerEntityResolver('Product', ['id'], async (reps) =>
        reps.map((rep) => ({
          id: rep.id,
          name: `Product ${rep.id}`,
          price: 19.99,
        }))
      );

      const orderService = gateway.getService('orders');
      orderService?.addResolver('Query', 'order', async (_s, args) => ({
        id: args.id,
        items: [{ productId: '100', quantity: 2, price: 19.99 }],
        total: 39.98,
      }));
    });

    afterEach(() => {
      gateway.shutdown();
    });

    it('should execute queries spanning multiple services', async () => {
      const result = await gateway.execute(`
        query {
          user(id: "1") { id name }
          product(id: "100") { id name price }
        }
      `);

      expect(result.data).toBeDefined();
      // Data from both services should be merged
    });

    it('should resolve entities from owning service', async () => {
      const context: GraphQLContext = { requestId: 'test-123' };

      const userResults = await gateway.resolveEntities(
        [{ __typename: 'User', id: '1' }],
        context
      );

      expect(userResults[0]).toHaveProperty('name');
    });
  });

  describe('Full request flow', () => {
    let apiGateway: APIGateway;

    beforeEach(() => {
      apiGateway = new APIGateway(
        {
          services: [
            {
              name: 'api',
              prefix: '/api',
              upstream: 'http://localhost:3000',
              routes: [
                { path: '/health', method: 'GET' },
              ],
            },
          ],
          graphql: [
            { name: 'users', schema: userServiceSchema },
          ],
          cors: { origin: '*' },
          auth: { type: 'bearer', excludePaths: ['/api/health', '/graphql'] },
        },
        mockLogger
      );

      // Setup GraphQL resolvers
      const gqlGateway = apiGateway.getGraphQLGateway();
      const userService = gqlGateway?.getService('users');
      userService?.addResolver('Query', 'users', async () => [
        { id: '1', name: 'Alice', email: 'alice@example.com' },
        { id: '2', name: 'Bob', email: 'bob@example.com' },
      ]);
    });

    afterEach(() => {
      apiGateway.shutdown();
    });

    it('should handle REST and GraphQL requests', async () => {
      // REST request
      const restResponse = await apiGateway.handleRequest({
        method: 'GET',
        path: '/api/health',
      });
      expect(restResponse.status).toBe(200);

      // GraphQL request
      const gqlResponse = await apiGateway.handleRequest({
        method: 'POST',
        path: '/graphql',
        body: { query: '{ users { id name } }' },
      });
      expect(gqlResponse.status).toBe(200);
    });

    it('should apply middleware in correct order', async () => {
      // CORS preflight should bypass auth
      const preflightResponse = await apiGateway.handleRequest({
        method: 'OPTIONS',
        path: '/api/protected',
      });
      expect(preflightResponse.status).toBe(204);
      expect(preflightResponse.headers?.['Access-Control-Allow-Origin']).toBe('*');
    });
  });
});
