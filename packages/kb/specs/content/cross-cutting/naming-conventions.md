---
module: cross-cutting
title: "Naming Conventions"
tags: [naming, conventions, files, tokens, services, decorators]
summary: "Canonical naming conventions for files, classes, tokens, services, DTOs, and database entities"
---

# Naming Conventions

## File Names

| Type | Pattern | Example |
|------|---------|---------|
| Module | `{feature}.module.ts` | `auth.module.ts` |
| Domain service | `{feature}.service.ts` | `auth.service.ts` |
| RPC service | `{feature}.rpc-service.ts` | `auth.rpc-service.ts` |
| Repository | `{feature}.repository.ts` | `user.repository.ts` |
| Types/interfaces | `{feature}.types.ts` | `auth.types.ts` |
| Errors | `{feature}.errors.ts` | `auth.errors.ts` |
| DTOs | `{feature}.dto.ts` | `auth.dto.ts` |
| Constants | `{feature}.constants.ts` | `auth.constants.ts` |
| Decorators | `{feature}.decorators.ts` | `cache.decorators.ts` |
| Tokens | `tokens.ts` (shared) | `shared/tokens.ts` |
| Health indicator | `{target}.health.ts` | `redis.health.ts` |

## Class Names

| Type | Pattern | Example |
|------|---------|---------|
| Domain service | `{Feature}Service` | `AuthService`, `OrderService` |
| RPC service | `{Feature}RpcService` | `AuthRpcService` |
| Repository | `{Feature}Repository` | `UserRepository` |
| Module | `{Feature}Module` | `AuthModule` |
| Error | `{Specific}Error` | `UserNotFoundError` |
| Health indicator | `{Target}HealthIndicator` | `RedisHealthIndicator` |
| DI Token | `{FEATURE}_{TYPE}_TOKEN` | `AUTH_SERVICE_TOKEN` |

## DI Token Names

```typescript
// Pattern: Symbol.for('titan:{domain}:{purpose}')
export const AUTH_SERVICE_TOKEN = Symbol.for('titan:auth:service');
export const USER_REPOSITORY_TOKEN = Symbol.for('titan:user:repository');
export const REDIS_CLIENT_TOKEN = Symbol.for('titan:redis:client');
export const CONFIG_SCHEMA_TOKEN = Symbol.for('titan:config:schema');
```

## @Service Names

```typescript
// Simple, no version, PascalCase
@Service({ name: 'Auth' })
@Service({ name: 'Storage' })
@Service({ name: 'Order' })
@Service({ name: 'OmnitronProject' })  // Multi-word: concatenated PascalCase
```

## Database

| Entity | Pattern | Example |
|--------|---------|---------|
| Table | `snake_case`, plural | `users`, `auth_logs`, `order_items` |
| Column | `snake_case` | `created_at`, `user_id`, `password_hash` |
| Index | `idx_{table}_{columns}` | `idx_users_username`, `idx_orders_user_id` |
| Migration | `{NNN}_{description}.ts` | `001_initial_schema.ts` |

## DTOs

| Direction | Suffix | Example |
|-----------|--------|---------|
| Input | `Dto` or `Create{X}Dto` | `CreateOrderDto`, `UpdateProfileDto` |
| Response | `Dto` or `{X}ResponseDto` | `AuthResponseDto`, `UserDto` |
| Query | `QueryDto` or `FilterDto` | `OrderFilterDto`, `PaginationDto` |

## Events

```typescript
// Pattern: {domain}:{action} in lowercase
'user:created', 'order:confirmed', 'payment:failed'

// Module events
'app:started', 'daemon:ready', 'infra:provisioned'
```

## Config Keys

```typescript
// Dot-notation paths
config.get('database.host')
config.get('redis.url')
config.get('auth.jwtExpiry')
config.get('server.port')
```
