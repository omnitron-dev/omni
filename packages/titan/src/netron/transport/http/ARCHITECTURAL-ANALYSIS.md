# Architectural Analysis: HttpServer vs TypedHttpServer

> **Deep architectural comparison of current and typed HTTP server implementations**
> **Date**: 2025-10-08
> **Analysis Type**: Ultrathink - Comprehensive Code Review

---

## Executive Summary

Проведен глубокий анализ двух архитектурных подходов к HTTP транспорту в Netron:

1. **HttpServer** (`server.ts`) - текущая production реализация
2. **TypedHttpServer** (`typed-server.ts`, `typed-contract.ts`, `typed-middleware.ts`) - новая type-safe обертка

**Ключевые выводы:**
- TypedHttpServer - это НЕ полная замена, а type-safe **обертка** над HttpServer
- Существует дублирование функциональности между двумя системами
- TypedHttpServer не интегрирован с Netron peer system
- Есть несоответствия в middleware архитектуре
- OpenAPI generation дублируется в обеих реализациях

**Рекомендация:** MERGE - объединить лучшие части в единую систему

---

## Detailed Architectural Comparison

### 1. Core Architecture

#### HttpServer (Production Implementation)

```typescript
/**
 * Архитектура: Полнофункциональный HTTP сервер
 *
 * Компоненты:
 * - Runtime-agnostic server (Node.js, Bun, Deno)
 * - Netron peer integration через LocalPeer
 * - Middleware pipeline с stages (PRE_PROCESS, POST_PROCESS, ERROR)
 * - Contract-based validation
 * - Service registration через setPeer()
 * - Multiple endpoints (/netron/invoke, /batch, /discovery, /health, /metrics, /openapi.json)
 */
export class HttpServer extends EventEmitter implements ITransportServer {
  // Netron integration
  private netronPeer?: LocalPeer;
  private services = new Map<string, ServiceDescriptor>();

  // Middleware
  private globalPipeline: MiddlewarePipeline;
  private middlewareAdapter?: HttpMiddlewareAdapter;

  // Runtime detection
  private detectRuntime(): 'node' | 'bun' | 'deno'

  // Automatic service registration from peer
  setPeer(peer: LocalPeer): void {
    this.netronPeer = peer;
    this.registerPeerServices(); // Auto-registers all stubs
  }

  // REST route mapping from contracts
  private async handleRestRoute(request: Request): Promise<Response | null> {
    // Uses contract.http.path and contract.http.method
    // Extracts path params, query params, body
    // Delegates to handleInvocationRequest
  }
}
```

**Сильные стороны:**
✅ Полностью интегрирован с Netron ecosystem
✅ Runtime-agnostic (3 runtime environments)
✅ Production-ready с метриками и мониторингом
✅ Автоматическая регистрация сервисов через LocalPeer
✅ Contract-based REST routing
✅ Batch requests support
✅ Discovery mechanism

**Слабые стороны:**
❌ Нет compile-time type safety
❌ Type inference только через JSDoc
❌ Middleware не имеет type-safe context
❌ Сложная интеграция с TypeScript generics

---

#### TypedHttpServer (New Type-Safe Wrapper)

```typescript
/**
 * Архитектура: Type-safe обертка с compile-time проверками
 *
 * Компоненты:
 * - TypedContract<T> - Zod-based contract system
 * - TypedHttpClient<TContract, TMiddleware> - type-safe client
 * - TypedHttpServer - wrapper around HttpServer
 * - TypedMiddlewarePipeline<TContext> - typed middleware
 * - ServerBuilder - fluent API
 */
export class TypedHttpServer {
  private server: HttpServer;  // ⚠️ Использует HttpServer внутри
  private services = new Map<string, ServiceRegistration<any>>();
  private globalPipeline = new TypedMiddlewarePipeline<any>();

  // ⚠️ НЕТ интеграции с Netron peer
  // ⚠️ НЕТ автоматической регистрации
  service<T extends ContractDefinition>(
    registration: ServiceRegistration<T>
  ): this {
    this.services.set(registration.name, registration);
    // ⚠️ Только сохраняет, НЕ регистрирует в HttpServer
    this.registerServiceMethods(registration); // ПУСТАЯ РЕАЛИЗАЦИЯ
  }

  // Дублирование OpenAPI generation
  generateOpenAPI(): any {
    // Генерирует из TypedContract, но HttpServer тоже генерирует
  }
}
```

**Сильные стороны:**
✅ Perfect type inference с TypeScript generics
✅ Compile-time validation
✅ Zod schema integration
✅ Type-safe middleware context
✅ Fluent API через ServerBuilder
✅ ServiceImplementation<T> с автокомплитом

**Слабые стороны:**
❌ НЕ интегрирован с Netron peer system
❌ Дублирует HttpServer внутри
❌ `registerServiceMethods()` - пустая реализация
❌ Нет batch requests support
❌ Нет discovery endpoint
❌ OpenAPI generation дублируется
❌ TypedMiddlewarePipeline НЕ совместим с MiddlewarePipeline

---

### 2. Service Registration Comparison

#### HttpServer: Automatic Peer Integration

```typescript
// HttpServer - Автоматическая регистрация из Netron peer
setPeer(peer: LocalPeer): void {
  this.netronPeer = peer;
  this.middlewareAdapter = new HttpMiddlewareAdapter();
  this.registerPeerServices(); // ✅ Автоматически
}

private registerPeerServices(): void {
  if (!this.netronPeer) return;

  // ✅ Проходит по всем stubs в peer
  for (const [id, stub] of this.netronPeer.stubs) {
    const serviceName = stub.definition.meta.name;
    const version = stub.definition.meta.version;

    const descriptor: ServiceDescriptor = {
      name: serviceName,
      version,
      methods: new Map()
    };

    // ✅ Автоматически регистрирует методы
    for (const methodName of Object.keys(stub.definition.meta.methods || {})) {
      descriptor.methods.set(methodName, {
        name: methodName,
        handler: async (input, context) => {
          // ✅ Вызывает через stub.call()
          return stub.call(methodName, input, this.netronPeer!);
        },
        contract: getMethodContract(stub, methodName) // ✅ Берет из meta
      });
    }

    this.services.set(serviceName, descriptor);
  }
}
```

**Преимущества:**
- ✅ Zero configuration - работает сразу
- ✅ Automatic sync с Netron service changes
- ✅ Поддерживает все Netron features (middleware, tracing, etc.)
- ✅ Contract берется из существующего definition

---

#### TypedHttpServer: Manual Registration with Types

```typescript
// TypedHttpServer - Ручная регистрация с type safety
service<T extends ContractDefinition>(
  registration: ServiceRegistration<T>
): this {
  this.services.set(registration.name, registration);
  this.registerServiceMethods(registration); // ⚠️ ПУСТАЯ РЕАЛИЗАЦИЯ
  return this;
}

// ⚠️ КРИТИЧЕСКАЯ ПРОБЛЕМА: Метод НЕ РЕАЛИЗОВАН
private registerServiceMethods<T extends ContractDefinition>(
  registration: ServiceRegistration<T>
): void {
  // This would integrate with HttpNativeServer's service registration
  // The server's setPeer method would be called to register the service
  // For now, we store the registration for OpenAPI generation

  // ⚠️ НИЧЕГО НЕ ДЕЛАЕТ!
}

// Использование:
const server = new TypedHttpServer({ port: 3000 });

server.service({
  name: 'users',
  contract: userContract,  // TypedContract<UserContractDef>
  implementation: {
    getUser: async (input: { id: string }, ctx: ServiceContext) => {
      return { id: input.id, name: 'John' };
    }
  }
});

// ⚠️ Но сервис НЕ ЗАРЕГИСТРИРОВАН в HttpServer!
```

**Проблемы:**
- ❌ `registerServiceMethods()` - пустая заглушка
- ❌ НЕТ связи с HttpServer.services
- ❌ НЕТ интеграции с Netron peer
- ❌ Ручное дублирование implementation + contract
- ❌ Type safety на этапе компиляции, но runtime не работает

---

### 3. Middleware Systems Comparison

#### HttpServer: Netron Middleware Pipeline

```typescript
// Production middleware с Netron integration
class HttpServer {
  private globalPipeline: MiddlewarePipeline; // Netron's pipeline

  setupDefaultMiddleware(): void {
    // ✅ Использует MiddlewareStage enum
    this.globalPipeline.use(
      NetronBuiltinMiddleware.requestId(),
      { name: 'request-id', priority: 1 },
      MiddlewareStage.PRE_PROCESS
    );

    this.globalPipeline.use(
      HttpBuiltinMiddleware.cors(this.options.cors),
      { name: 'cors', priority: 5 },
      MiddlewareStage.PRE_PROCESS
    );
  }

  // ✅ Execution с context
  async handleInvocationRequest(request: Request): Promise<Response> {
    const context: NetronMiddlewareContext = {
      peer: this.netronPeer,
      serviceName: message.service,
      methodName: message.method,
      input: message.input,
      metadata: new Map(),
      timing: { start: performance.now(), middlewareTimes: new Map() }
    };

    // ✅ Pre-process stage
    await this.globalPipeline.execute(context, MiddlewareStage.PRE_PROCESS);

    // Execute handler
    context.output = await method.handler(input, context);

    // ✅ Post-process stage
    await this.globalPipeline.execute(context, MiddlewareStage.POST_PROCESS);

    // ✅ Error handling
    if (error) {
      await this.globalPipeline.execute(context, MiddlewareStage.ERROR);
    }
  }
}

// Middleware signature
type NetronMiddleware = (
  ctx: NetronMiddlewareContext,
  next: () => Promise<void>
) => Promise<void> | void;
```

**Характеристики:**
- ✅ Интегрирован с Netron ecosystem
- ✅ Stage-based execution (PRE, POST, ERROR)
- ✅ Priority-based sorting
- ✅ Timing measurements встроены
- ✅ Совместим с NetronBuiltinMiddleware
- ❌ Нет type-safe context (Map<string, any>)

---

#### TypedHttpServer: TypedMiddleware System

```typescript
// Type-safe middleware с context accumulation
class TypedMiddlewarePipeline<TContext extends NetronMiddlewareContext> {
  private middlewares: Array<{
    fn: TypedMiddleware<TContext>;
    config: MiddlewareConfig;
  }> = [];

  // ✅ Type-safe registration
  use<M extends TypedMiddleware<TContext>>(
    middleware: M,
    config?: MiddlewareConfig
  ): this {
    this.middlewares.push({ fn: middleware, config: config || {} });
    this.middlewares.sort((a, b) =>
      (a.config.priority || 100) - (b.config.priority || 100)
    );
    return this;
  }

  // ✅ Compose с type accumulation
  compose<M1, M2, M3>(
    m1: TypedMiddleware<TContext & M1>,
    m2: TypedMiddleware<TContext & M1 & M2>,
    m3: TypedMiddleware<TContext & M1 & M2 & M3>
  ): TypedMiddleware<TContext & M1 & M2 & M3> {
    return async (ctx, next) => {
      await m1(ctx as any, async () => {
        await m2(ctx as any, async () => {
          await m3(ctx as any, next);
        });
      });
    };
  }

  // ⚠️ Execution БЕЗ stages
  async execute(context: TContext, handler: () => Promise<void>): Promise<void> {
    const chain = this.buildChain(handler);
    await chain(context);
  }

  // ⚠️ Stage checking в shouldRun, но нет enum
  private shouldRun(config: MiddlewareConfig, ctx: TContext): boolean {
    if (config.stage) {
      const hasError = !!ctx.error;
      if (config.stage === 'error' && !hasError) return false;
      if (config.stage === 'pre' && hasError) return false;
      if (config.stage === 'post' && hasError) return false;
    }
    return true;
  }
}

// ✅ Typed context with getters/setters
class TypedMetadata extends Map<string, any> {
  get requestId(): string { return this.get('requestId') || ''; }
  set requestId(value: string) { this.set('requestId', value); }

  get userId(): string | undefined { return this.get('userId'); }
  set userId(value: string | undefined) {
    value !== undefined ? this.set('userId', value) : this.delete('userId');
  }
}

interface TypedHttpMiddlewareContext<TService, TMethod, TInput, TOutput> {
  service: string;
  method: TMethod;  // ✅ Typed method name
  input: TInput;    // ✅ Typed input
  output?: TOutput; // ✅ Typed output
  metadata: TypedMetadata; // ✅ Type-safe metadata
  error?: TitanError;
}
```

**Характеристики:**
- ✅ Perfect type inference для context
- ✅ Type accumulation через compose
- ✅ TypedMetadata с property getters
- ✅ Type-safe input/output
- ⚠️ Stages через строки, не enum
- ❌ НЕ совместим с MiddlewarePipeline
- ❌ НЕ интегрирован с Netron built-in middleware
- ❌ Нет automatic timing measurements

---

### 4. Contract System Comparison

#### HttpServer: MethodContract Integration

```typescript
// Contract из Netron definition
interface MethodDescriptor {
  name: string;
  handler: (input: any, context: any) => Promise<any>;
  contract?: MethodContract;  // ✅ Optional, из meta.contract
}

interface MethodContract {
  input?: z.ZodSchema<any>;    // ✅ Zod validation
  output?: z.ZodSchema<any>;   // ✅ Zod validation
  errors?: Record<string, z.ZodSchema<any>>;
  http?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path?: string;           // ✅ REST routing: /users/{id}
    status?: number;
    contentType?: string;
    responseHeaders?: Record<string, string>;
    streaming?: boolean;
    params?: Record<string, z.ZodSchema<any>>;  // Path params
    query?: Record<string, z.ZodSchema<any>>;   // Query params
    openapi?: {
      summary?: string;
      description?: string;
      tags?: string[];
      deprecated?: boolean;
    };
  };
  stream?: boolean;
}

// Использование в обработчике
async handleInvocationRequest(request: Request): Promise<Response> {
  const method = service.methods.get(message.method);

  // ✅ Input validation
  if (method.contract?.input) {
    const validation = method.contract.input.safeParse(message.input);
    if (!validation.success) {
      throw new TitanError({
        code: ErrorCode.INVALID_ARGUMENT,
        message: 'Input validation failed',
        details: validation.error
      });
    }
  }

  // Execute
  const output = await method.handler(validated.data, context);

  // ✅ Output validation (optional, не реализовано)

  // ✅ Apply HTTP config
  const headers = {
    'Content-Type': method.contract?.http?.contentType || 'application/json'
  };

  return new Response(JSON.stringify(response), {
    status: method.contract?.http?.status || 200,
    headers
  });
}
```

**Преимущества:**
- ✅ Unified contract system с Netron
- ✅ HTTP configuration в contract
- ✅ REST routing из contracts
- ✅ OpenAPI metadata в contract
- ✅ Runtime validation с Zod
- ❌ Нет type inference на уровне TypeScript

---

#### TypedHttpServer: TypedContract System

```typescript
// Type-safe contract с perfect inference
type ContractDefinition = Record<string, MethodContract>;

class TypedContract<T extends ContractDefinition> {
  constructor(private definition: T) {}

  // ✅ Type inference
  inferService(): ServiceType<T> {
    return this.createProxy();
  }

  // ✅ Generate typed client
  generateClient<M extends MiddlewareConfig>(
    baseUrl: string,
    options?: { middleware?: M }
  ): TypedHttpClient<T, M> {
    return new TypedHttpClient(this, baseUrl, options);
  }
}

// ✅ Perfect type inference
type ServiceType<T extends ContractDefinition> = {
  [K in keyof T]: ServiceMethod<T[K]>;
};

type ServiceMethod<M extends MethodContract> =
  M['stream'] extends true
    ? StreamMethod<M>
    : AsyncMethod<M>;

type AsyncMethod<M extends MethodContract> =
  M['input'] extends z.ZodSchema<infer I>
    ? M['output'] extends z.ZodSchema<infer O>
      ? (input: I) => Promise<O>
      : never
    : never;

// Использование
const userContract = new TypedContract({
  getUser: {
    input: z.object({ id: z.string() }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string()
    })
  },
  updateUser: {
    input: z.object({
      id: z.string(),
      data: z.object({ name: z.string() })
    }),
    output: z.object({ id: z.string(), name: z.string() })
  }
});

type IUserService = ServiceType<typeof userContract>;
// ✅ Автокомплит:
// {
//   getUser: (input: { id: string }) => Promise<{ id: string, name: string, email: string }>;
//   updateUser: (input: { id: string, data: { name: string }}) => Promise<{ id: string, name: string }>;
// }

// ✅ Type-safe implementation
const implementation: ServiceImplementation<typeof userContract> = {
  getUser: async (input, ctx) => {
    // input: { id: string } - autocomplete!
    // return must match output schema - checked at compile time!
    return { id: input.id, name: 'John', email: 'john@example.com' };
  },
  updateUser: async (input, ctx) => {
    // input: { id: string, data: { name: string } } - autocomplete!
    return { id: input.id, name: input.data.name };
  }
};
```

**Преимущества:**
- ✅ Perfect type inference с autocomplete
- ✅ Compile-time type checking
- ✅ ServiceImplementation<T> обеспечивает полноту реализации
- ✅ Type-safe client generation
- ❌ Дублирует MethodContract concept
- ❌ Не совместим с существующими Netron contracts
- ❌ HTTP config не включен в TypedContract

---

### 5. OpenAPI Generation Comparison

#### HttpServer: Contract-Based OpenAPI

```typescript
async handleOpenAPIRequest(request: Request): Promise<Response> {
  const spec: any = {
    openapi: '3.0.3',
    info: {
      title: this.options.openapi?.title || 'Netron API',
      version: this.options.openapi?.version || '1.0.0'
    },
    paths: {},
    components: { schemas: {} }
  };

  // ✅ Generate from registered services
  for (const [serviceName, service] of this.services) {
    for (const [methodName, method] of service.methods) {
      const contract = method.contract;
      if (!contract) continue;

      const httpConfig = contract.http;
      const path = httpConfig?.path || `/rpc/${serviceName}/${methodName}`;
      const httpMethod = (httpConfig?.method || 'POST').toLowerCase();

      spec.paths[path] = {
        [httpMethod]: {
          operationId: `${serviceName}_${methodName}`,
          summary: httpConfig?.openapi?.summary,
          description: httpConfig?.openapi?.description,
          tags: httpConfig?.openapi?.tags || [serviceName],
          deprecated: httpConfig?.openapi?.deprecated,
          // ✅ Generate from Zod schemas
          requestBody: this.generateRequestBody(contract),
          responses: this.generateResponses(contract),
          parameters: this.generateParameters(httpConfig)
        }
      };
    }
  }

  return new Response(JSON.stringify(spec, null, 2));
}
```

**Характеристики:**
- ✅ Автоматически генерируется из существующих contracts
- ✅ Использует contract.http.openapi metadata
- ✅ REST paths из contract.http.path
- ✅ Zod schemas → JSON Schema (нужна библиотека)
- ⚠️ Упрощенная генерация схем (need zod-to-json-schema)

---

#### TypedHttpServer: Duplicated OpenAPI

```typescript
class TypedHttpServer {
  generateOpenAPI(): any {
    const spec: any = {
      openapi: '3.0.3',
      info: {
        title: this.config.openapi?.title || 'API Documentation',
        version: this.config.openapi?.version || '1.0.0'
      },
      paths: {},
      components: { schemas: {} }
    };

    // ⚠️ ДУБЛИРУЕТ логику HttpServer
    for (const [serviceName, service] of this.services) {
      this.generateServicePaths(spec, serviceName, service);
    }

    return spec;
  }

  private generateServicePaths(spec: any, serviceName: string, service: ServiceRegistration<any>): void {
    // ⚠️ ТА ЖЕ ЛОГИКА что и в HttpServer.handleOpenAPIRequest
    for (const [methodName, methodContract] of Object.entries(service.contract)) {
      const httpConfig = methodContract.http;
      const path = httpConfig?.path || `/rpc/${serviceName}/${methodName}`;

      // ... same logic
    }
  }
}
```

**Проблемы:**
- ❌ Полное дублирование кода HttpServer
- ❌ Два источника OpenAPI спецификаций
- ❌ Нет синхронизации между ними
- ❌ TypedHttpServer.generateOpenAPI() не вызывается автоматически

---

### 6. Client-Side Comparison

#### Current: HttpTransportClient

```typescript
// Текущий клиент (без type safety)
const client = new HttpTransportClient('http://localhost:3000');

const result = await client.invoke(
  'UserService',
  'getUser',
  [{ id: '123' }], // ❌ Нет type checking
  { context: {}, hints: {} }
);

// ❌ result - any type
```

---

#### New: TypedHttpClient

```typescript
// ✅ Type-safe клиент
const client = new TypedHttpClient(userContract, 'http://localhost:3000');

// ✅ Autocomplete для методов
const user = await client
  .call('getUser', { id: '123' }) // ✅ Type-checked input
  .cache(60000)
  .retry(3)
  .execute();

// ✅ user имеет тип: { id: string, name: string, email: string }

// ✅ Или через proxy
const user = await client.service.getUser({ id: '123' });
// ✅ Тот же type inference

// ⚠️ НО: client не подключен к HttpTransportClient
// ⚠️ Использует новый QueryBuilder, который ТОЖЕ вызывает HttpTransportClient
```

---

## Critical Issues Found

### 🔴 Issue 1: TypedHttpServer.registerServiceMethods() Not Implemented

```typescript
// typed-server.ts:322
private registerServiceMethods<T extends ContractDefinition>(
  registration: ServiceRegistration<T>
): void {
  // This would integrate with HttpNativeServer's service registration
  // The server's setPeer method would be called to register the service
  // For now, we store the registration for OpenAPI generation

  // ⚠️ КРИТИЧЕСКАЯ ПРОБЛЕМА: НИЧЕГО НЕ ДЕЛАЕТ!
}
```

**Impact:**
- ❌ TypedHttpServer.service() НЕ регистрирует сервисы в HttpServer
- ❌ Запросы к зарегистрированным сервисам вернут 404
- ❌ Type safety только на compile time, runtime НЕ РАБОТАЕТ

**Fix Required:**
```typescript
private registerServiceMethods<T extends ContractDefinition>(
  registration: ServiceRegistration<T>
): void {
  // Create ServiceDescriptor for HttpServer
  const descriptor: ServiceDescriptor = {
    name: registration.name,
    version: registration.version || '1.0.0',
    methods: new Map()
  };

  // Register each method
  for (const [methodName, methodContract] of Object.entries(registration.contract)) {
    descriptor.methods.set(methodName, {
      name: methodName,
      handler: async (input: any, context: any) => {
        // ✅ Call typed implementation
        const impl = registration.implementation[methodName];
        return impl(input, {
          requestId: context.metadata?.get('requestId') || '',
          timestamp: Date.now(),
          userId: context.metadata?.get('userId'),
          metadata: Object.fromEntries(context.metadata || [])
        });
      },
      contract: methodContract
    });
  }

  // ✅ Register in HttpServer
  this.server['services'].set(registration.name, descriptor);
}
```

---

### 🔴 Issue 2: Middleware System Incompatibility

```typescript
// HttpServer uses MiddlewarePipeline
class HttpServer {
  private globalPipeline: MiddlewarePipeline;  // Netron middleware
}

// TypedHttpServer uses TypedMiddlewarePipeline
class TypedHttpServer {
  private globalPipeline = new TypedMiddlewarePipeline<any>();  // Incompatible!
}
```

**Problems:**
- ❌ Две несовместимые системы middleware
- ❌ TypedMiddleware НЕ совместим с NetronMiddleware
- ❌ TypedMiddlewarePipeline.execute() НЕ вызывается HttpServer
- ❌ Built-in middleware (requestId, cors, compression) НЕ доступны в TypedHttpServer

**Example:**
```typescript
// ❌ Не работает
const server = new TypedHttpServer({ port: 3000 });
server.globalMiddleware([
  TypedMiddlewareFactory.auth(async (ctx) => true)
]);
// TypedMiddlewarePipeline.execute() НИКОГДА не вызывается!
```

---

### 🔴 Issue 3: Duplicated OpenAPI Generation

```typescript
// HttpServer endpoint /openapi.json
async handleOpenAPIRequest(request: Request) {
  // Generates from this.services
}

// TypedHttpServer method
generateOpenAPI(): any {
  // Generates from this.services (different services!)
}
```

**Problems:**
- ❌ Два source of truth для OpenAPI
- ❌ HttpServer.services ≠ TypedHttpServer.services
- ❌ Нет синхронизации
- ❌ TypedHttpServer.generateOpenAPI() надо вызывать вручную

---

### 🟡 Issue 4: No Netron Peer Integration

```typescript
// HttpServer - ✅ Full integration
setPeer(peer: LocalPeer): void {
  this.netronPeer = peer;
  this.registerPeerServices(); // Automatic
}

// TypedHttpServer - ❌ No peer concept
service<T extends ContractDefinition>(registration: ServiceRegistration<T>): this {
  // Manual registration, no peer awareness
}
```

**Consequences:**
- ❌ TypedHttpServer НЕ может использовать существующие Netron services
- ❌ Нет интеграции с Netron middleware
- ❌ Нет трейсинга, логирования, authentication из Netron
- ❌ Нужно дублировать все service implementations

---

### 🟡 Issue 5: Client-Side Duplication

```typescript
// typed-contract.ts
class TypedHttpClient {
  private transport: HttpTransportClient;  // Uses existing client

  call<K extends keyof TContract>(method: K, input: InferInput<TContract[K]>): QueryBuilder<TContract, K> {
    return new QueryBuilder(
      this.transport,
      this.serviceName,
      method as string,
      input,
      this.contract.getDefinition()[method]
    );
  }
}

// ⚠️ Новый QueryBuilder в typed-contract.ts
class QueryBuilder<TContract extends ContractDefinition, TMethod extends keyof TContract> {
  async execute(): Promise<InferOutput<TContract[TMethod]>> {
    // ⚠️ ДУБЛИРУЕТ interface.ts QueryBuilder
    const result = await this.transport.invoke(
      this.serviceName,
      this.method,
      [this.input]
    );

    // Validation
    if (this.methodContract.output) {
      const validation = this.methodContract.output.safeParse(result);
      if (!validation.success) {
        throw new Error('Output validation failed');
      }
      return validation.data;
    }

    return result;
  }
}
```

**Problems:**
- ❌ Два QueryBuilder класса:
  - `packages/titan/src/netron/transport/http/interface.ts` - Production с Phase 1 features
  - `packages/titan/src/netron/transport/http/typed-contract.ts` - Type-safe дубликат
- ❌ Phase 1 features (deduplication, cancellation, optimistic updates) НЕТ в typed QueryBuilder
- ❌ Нужно поддерживать обе версии

---

## Architectural Decision Matrix

| Feature | HttpServer | TypedHttpServer | Winner | Notes |
|---------|-----------|----------------|--------|-------|
| **Type Safety** | ❌ Runtime only | ✅ Compile + Runtime | TypedHttpServer | TypedContract обеспечивает perfect inference |
| **Netron Integration** | ✅ Full | ❌ None | HttpServer | setPeer автоматически регистрирует все сервисы |
| **Middleware** | ✅ Production-ready | ❌ Incompatible | HttpServer | MiddlewarePipeline интегрирован, TypedMiddlewarePipeline - изолирован |
| **Runtime Support** | ✅ Node/Bun/Deno | ✅ Via HttpServer | Tie | TypedHttpServer wraps HttpServer |
| **OpenAPI Gen** | ✅ Auto endpoint | ⚠️ Manual method | HttpServer | /openapi.json endpoint vs. вызов метода |
| **REST Routing** | ✅ From contracts | ❌ Not implemented | HttpServer | handleRestRoute полностью реализован |
| **Batch Requests** | ✅ /netron/batch | ❌ None | HttpServer | Нет в TypedHttpServer |
| **Discovery** | ✅ /netron/discovery | ❌ None | HttpServer | Нет в TypedHttpServer |
| **Service Registration** | ✅ Automatic | ❌ Broken | HttpServer | registerServiceMethods() пустой |
| **Client Features** | ⚠️ Basic | ✅ Type-safe | TypedHttpServer | TypedHttpClient с perfect inference |
| **Validation** | ✅ Input only | ✅ Input + Output | TypedHttpServer | Output validation в TypedContract |
| **Developer Experience** | ⚠️ Manual types | ✅ Autocomplete | TypedHttpServer | ServiceImplementation<T> |
| **Production Ready** | ✅ Yes | ❌ No | HttpServer | TypedHttpServer НЕ работает без fixes |

**Overall Winner**: Neither - нужен MERGE

---

## Recommended Architecture: Unified Type-Safe System

### Option A: Enhance HttpServer with Type Safety (Recommended)

```typescript
/**
 * Добавить type safety в существующий HttpServer
 * БЕЗ создания новой параллельной системы
 */

// 1. Enhanced HttpServer с generic support
export class HttpServer<TContracts extends Record<string, ContractDefinition> = any>
  extends EventEmitter
  implements ITransportServer {

  // ✅ Keep existing peer integration
  setPeer(peer: LocalPeer): void {
    this.netronPeer = peer;
    this.registerPeerServices();
  }

  // ✅ ADD: Type-safe service registration
  registerTypedService<T extends ContractDefinition>(
    name: string,
    contract: TypedContract<T>,
    implementation: ServiceImplementation<T>
  ): this {
    const descriptor: ServiceDescriptor = {
      name,
      version: '1.0.0',
      methods: new Map()
    };

    for (const [methodName, methodContract] of Object.entries(contract.getDefinition())) {
      descriptor.methods.set(methodName, {
        name: methodName,
        handler: async (input, context) => {
          const impl = implementation[methodName];
          return impl(input, this.createServiceContext(context));
        },
        contract: methodContract
      });
    }

    this.services.set(name, descriptor);
    return this;
  }

  // ✅ Type-safe client generation
  createClient<T extends ContractDefinition>(
    serviceName: string,
    contract: TypedContract<T>
  ): TypedHttpClient<T> {
    return new TypedHttpClient(
      contract,
      `http://${this.address}:${this.port}`,
      { serviceName }
    );
  }
}

// Usage
const server = new HttpServer({ port: 3000 });

// ✅ Traditional Netron integration (keep)
server.setPeer(localPeer);

// ✅ ADD: Type-safe registration
server.registerTypedService('users', userContract, {
  getUser: async (input, ctx) => {
    // ✅ Type-checked input and output
    return { id: input.id, name: 'John', email: 'john@example.com' };
  }
});

// ✅ Type-safe client
const client = server.createClient('users', userContract);
const user = await client.service.getUser({ id: '123' });
// user: { id: string, name: string, email: string }
```

**Advantages:**
- ✅ Keep ALL existing functionality
- ✅ Backward compatible
- ✅ Add type safety as opt-in
- ✅ Single middleware system
- ✅ Single OpenAPI generation
- ✅ No code duplication

---

### Option B: Make TypedHttpServer Fully Functional

```typescript
/**
 * Fix TypedHttpServer чтобы он реально работал
 * Требует больше работы
 */

export class TypedHttpServer {
  private server: HttpServer;

  constructor(config: ServerConfig = {}) {
    this.server = new HttpServer(config);
  }

  // ✅ FIX: Proper service registration
  service<T extends ContractDefinition>(
    registration: ServiceRegistration<T>
  ): this {
    this.services.set(registration.name, registration);

    // ✅ Actually register in HttpServer
    const descriptor: ServiceDescriptor = {
      name: registration.name,
      version: registration.version || '1.0.0',
      methods: new Map()
    };

    for (const [methodName, methodContract] of Object.entries(registration.contract)) {
      const impl = registration.implementation[methodName];
      descriptor.methods.set(methodName, {
        name: methodName,
        handler: async (input, context) => {
          return impl(input, this.createServiceContext(context));
        },
        contract: methodContract
      });
    }

    // ✅ Register in wrapped HttpServer
    this.server['services'].set(registration.name, descriptor);

    return this;
  }

  // ✅ FIX: Bridge TypedMiddleware → NetronMiddleware
  globalMiddleware(middlewares: TypedMiddleware<any>[]): this {
    for (const typed of middlewares) {
      // Convert to Netron middleware
      const netronMiddleware = this.convertMiddleware(typed);
      this.server['globalPipeline'].use(netronMiddleware);
    }
    return this;
  }

  private convertMiddleware(typed: TypedMiddleware<any>): NetronMiddleware {
    return async (ctx: NetronMiddlewareContext, next: () => Promise<void>) => {
      // Convert NetronMiddlewareContext → TypedHttpMiddlewareContext
      const typedCtx: TypedHttpMiddlewareContext = {
        ...ctx,
        metadata: this.convertMetadata(ctx.metadata)
      };

      await typed(typedCtx as any, next);

      // Sync back changes
      ctx.output = typedCtx.output;
      ctx.error = typedCtx.error;
    };
  }
}
```

**Disadvantages:**
- ⚠️ Много conversion logic
- ⚠️ Performance overhead
- ⚠️ Wrapper pattern сложнее поддерживать
- ⚠️ Все еще нужен HttpServer внутри

---

### Option C: Complete Rewrite (Not Recommended)

```typescript
/**
 * Полностью переписать HttpServer с type safety с нуля
 * ❌ Слишком рискованно
 */
```

**Why NOT:**
- ❌ Огромный объем работы
- ❌ Риск потерять features
- ❌ Breaking changes для всех пользователей
- ❌ Нужно переписать все тесты
- ❌ Нужно мигрировать существующий код

---

## Detailed Recommendations

### 🎯 PRIMARY RECOMMENDATION: Option A - Enhance HttpServer

**Implementation Plan:**

#### Phase 1: Add Type-Safe Service Registration (Week 1)

```typescript
// 1. Add TypedContract support to HttpServer
export class HttpServer {
  registerTypedService<T extends ContractDefinition>(
    name: string,
    contract: TypedContract<T>,
    implementation: ServiceImplementation<T>,
    options?: { middleware?: TypedMiddleware<any>[] }
  ): this {
    // Implementation shown above
  }
}

// 2. Keep TypedHttpClient as-is (уже работает)
// 3. Deprecate TypedHttpServer (не нужен)
```

#### Phase 2: Unify QueryBuilder (Week 2)

```typescript
// Merge typed-contract.ts QueryBuilder → interface.ts QueryBuilder
export class QueryBuilder<TContract extends ContractDefinition, TMethod extends keyof TContract> {
  // ✅ Keep Phase 1 features (deduplication, cancellation, optimistic)
  // ✅ Add type inference from TypedContract
  // ✅ Single source of truth

  async execute(): Promise<InferOutput<TContract[TMethod]>> {
    // Use existing executeInternal with Phase 1 features
    // Add output validation from TypedContract
  }
}
```

#### Phase 3: Enhance Middleware (Week 3)

```typescript
// Add type-safe wrapper to existing MiddlewarePipeline
export class MiddlewarePipeline {
  // ✅ Keep existing implementation

  // ✅ ADD: Type-safe registration
  useTyped<T extends TypedHttpMiddlewareContext>(
    middleware: TypedMiddleware<T>,
    config?: MiddlewareConfig
  ): this {
    // Convert TypedMiddleware → NetronMiddleware
    const converted = this.convertTypedMiddleware(middleware);
    this.use(converted, config);
    return this;
  }

  private convertTypedMiddleware<T>(typed: TypedMiddleware<T>): NetronMiddleware {
    return async (ctx, next) => {
      const typedCtx = {
        ...ctx,
        metadata: new TypedMetadata(ctx.metadata)
      } as T;

      await typed(typedCtx, next);

      // Sync changes
      ctx.output = typedCtx.output;
      ctx.error = typedCtx.error;
    };
  }
}
```

#### Phase 4: Documentation & Migration (Week 4)

```typescript
// Create migration guide
// Update examples
// Deprecate TypedHttpServer
```

---

### 📋 Migration Path for Existing Code

```typescript
// BEFORE (if using TypedHttpServer - broken anyway)
const server = new TypedHttpServer({ port: 3000 });
server.service({
  name: 'users',
  contract: userContract,
  implementation: userImpl
});

// AFTER (Option A - enhanced HttpServer)
const server = new HttpServer({ port: 3000 });
server.registerTypedService('users', userContract, userImpl);
// ✅ Same API, но реально работает

// BEFORE (if using HttpServer with LocalPeer)
const server = new HttpServer({ port: 3000 });
server.setPeer(localPeer);

// AFTER (Option A - no changes needed)
const server = new HttpServer({ port: 3000 });
server.setPeer(localPeer); // ✅ Still works
// ✅ Can add type-safe services too
server.registerTypedService('typed-service', contract, impl);
```

---

## Conclusion

**Current State:**
- ❌ TypedHttpServer НЕ РАБОТАЕТ (registerServiceMethods пустой)
- ❌ Две несовместимые middleware системы
- ❌ Дублирование QueryBuilder
- ❌ Дублирование OpenAPI generation
- ❌ Нет интеграции с Netron peer system

**Recommended Action:** **MERGE via Option A**

1. **Keep HttpServer** - production-ready, fully functional
2. **Add type-safe methods** - registerTypedService(), createClient()
3. **Merge QueryBuilder** - single implementation с type inference + Phase 1 features
4. **Bridge middleware** - TypedMiddleware → NetronMiddleware conversion
5. **Deprecate TypedHttpServer** - не нужен, HttpServer делает все

**Benefits:**
- ✅ Zero breaking changes
- ✅ Type safety as opt-in enhancement
- ✅ Keep all existing features
- ✅ Single source of truth
- ✅ Minimal code changes
- ✅ Backward compatible

**Timeline:** 4 weeks for full implementation

**Risk Level:** LOW (additive changes, no breaking changes)

---

## Files for Review/Action

### To Enhance:
- ✅ `packages/titan/src/netron/transport/http/server.ts` - Add type-safe methods
- ✅ `packages/titan/src/netron/transport/http/interface.ts` - Add type inference to QueryBuilder

### To Keep As-Is:
- ✅ `packages/titan/src/netron/transport/http/typed-contract.ts` - TypedContract class
- ✅ `packages/titan/src/netron/transport/http/typed-middleware.ts` - TypedMiddleware factories

### To Deprecate:
- ❌ `packages/titan/src/netron/transport/http/typed-server.ts` - Replace with enhanced HttpServer

### To Merge:
- 🔄 `typed-contract.ts` QueryBuilder → `interface.ts` QueryBuilder

---

**End of Analysis** - Prepared for architectural decision and implementation planning.
