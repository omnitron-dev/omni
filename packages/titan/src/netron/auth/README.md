# Netron Authentication & Authorization

## Overview

The Netron Auth module provides a comprehensive, production-ready security system for distributed applications. It includes authentication, authorization, policy evaluation, session management, audit logging, and rate limiting.

### Key Components

| Component | Purpose |
|-----------|---------|
| **AuthenticationManager** | User authentication with credential and token validation |
| **AuthorizationManager** | Service and method-level ACL enforcement |
| **PolicyEngine** | Universal policy evaluation with RBAC/ABAC/PBAC/ReBAC support |
| **SessionManager** | Multi-device session management with auto-expiration |
| **AuditLogger** | Comprehensive audit trails with pluggable storage |
| **RateLimiter** | Tiered rate limiting with multiple strategies |
| **BuiltInPolicies** | 21 pre-built authorization policies |

---

## Table of Contents

- [Quick Start](#quick-start)
- [Authentication](#authentication)
  - [AuthenticationManager](#authenticationmanager)
  - [Token Validation](#token-validation)
  - [Cache Configuration](#cache-configuration)
- [Authorization](#authorization)
  - [AuthorizationManager](#authorizationmanager)
  - [ACL Registration](#acl-registration)
  - [Wildcard Patterns](#wildcard-patterns)
- [Policy Engine](#policy-engine)
  - [PolicyEngine Class](#policyengine-class)
  - [Policy Registration](#policy-registration)
  - [Policy Evaluation](#policy-evaluation)
  - [Policy Expressions](#policy-expressions)
- [Built-in Policies](#built-in-policies)
  - [RBAC Policies](#rbac-policies)
  - [ABAC Policies](#abac-policies)
  - [Network Policies](#network-policies)
  - [Time-Based Policies](#time-based-policies)
- [Session Management](#session-management)
  - [SessionManager Class](#sessionmanager-class)
  - [Multi-Device Support](#multi-device-support)
- [Audit Logging](#audit-logging)
  - [AuditLogger Class](#auditlogger-class)
  - [Storage Adapters](#storage-adapters)
- [Rate Limiting](#rate-limiting)
  - [Strategies](#strategies)
  - [Tiered Limits](#tiered-limits)
- [API Reference](#api-reference)

---

## Quick Start

### Basic Authentication Setup

```typescript
import {
  AuthenticationManager,
  AuthorizationManager,
  PolicyEngine,
  BuiltInPolicies,
  SessionManager,
  AuditLogger
} from '@omnitron-dev/titan/netron/auth';
import { logger } from '@omnitron-dev/titan/module/logger';

// 1. Setup authentication
const authManager = new AuthenticationManager(logger);
authManager.configure({
  authenticate: async (credentials) => {
    const user = await db.users.findByCredentials(credentials);
    if (!user) throw new Error('Invalid credentials');
    return { userId: user.id, roles: user.roles, permissions: [] };
  },
  validateToken: async (token) => {
    const decoded = await jwt.verify(token, SECRET);
    return { userId: decoded.sub, roles: decoded.roles, permissions: [] };
  },
  tokenCache: {
    enabled: true,
    ttl: 60000,      // 1 minute
    maxSize: 10000   // Max cached tokens
  },
  asyncAudit: true   // Non-blocking audit logging
});

// 2. Setup authorization
const authzManager = new AuthorizationManager(logger);
authzManager.registerACLs([
  {
    service: 'admin@1.0.0',
    allowedRoles: ['admin']
  },
  {
    service: 'user@1.0.0',
    allowedRoles: ['user', 'admin'],
    methods: {
      deleteAccount: {
        allowedRoles: ['admin'],
        __override: true  // Override service-level ACL
      }
    }
  }
]);

// 3. Setup policy engine
const policyEngine = new PolicyEngine(logger);
policyEngine.registerPolicies([
  BuiltInPolicies.requireAuth(),
  BuiltInPolicies.requireRole('user')
]);
```

---

## Authentication

### AuthenticationManager

The `AuthenticationManager` handles user authentication with support for both credential-based and token-based authentication.

#### Constructor

```typescript
const authManager = new AuthenticationManager(logger: ILogger);
```

#### Configuration

```typescript
interface NetronAuthConfig {
  // Credential authenticator (required)
  authenticate: (credentials: AuthCredentials) => Promise<AuthContext> | AuthContext;

  // Token validator (optional)
  validateToken?: (token: string) => Promise<AuthContext> | AuthContext;

  // Token cache configuration (optional)
  tokenCache?: {
    enabled?: boolean;    // Default: true
    ttl?: number;         // Default: 60000 (1 minute)
    maxSize?: number;     // Default: 10000
  };

  // Async audit mode (optional)
  asyncAudit?: boolean;   // Default: true (non-blocking)
}

authManager.configure({
  authenticate: async (credentials) => ({
    userId: 'user-123',
    roles: ['user'],
    permissions: ['read', 'write']
  }),
  validateToken: async (token) => ({
    userId: 'user-123',
    roles: ['user'],
    permissions: ['read']
  }),
  tokenCache: {
    enabled: true,
    ttl: 60000,
    maxSize: 10000
  },
  asyncAudit: true
});
```

**Token Security**: Tokens are hashed using SHA256 before caching to prevent cache key enumeration attacks.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `authenticate` | `(credentials: AuthCredentials) => Promise<AuthResult>` | Authenticate with credentials |
| `validateToken` | `(token: string) => Promise<AuthResult>` | Validate a token |
| `isConfigured` | `() => boolean` | Check if authenticator is configured |
| `isTokenValidationConfigured` | `() => boolean` | Check if token validation is configured |
| `getCacheStats` | `() => { hits, misses, hitRate, size }` | Get cache statistics |
| `clearCache` | `() => void` | Clear token cache |
| `setTimeout` | `(timeout: number) => void` | Set authentication timeout |

#### Token Caching

Token validation results are cached using SHA256 hashing for security:

```typescript
// Cache is automatically used when configured
const result = await authManager.validateToken(token);

// Check cache performance
const stats = authManager.getCacheStats();
console.log(`Cache hit rate: ${stats.hitRate}%`);
console.log(`Cache size: ${stats.size}`);

// Clear cache when needed
authManager.clearCache();
```

### Usage Example

```typescript
// Credential authentication
const result = await authManager.authenticate({
  username: 'user@example.com',
  password: 'secret123'
});

if (result.success) {
  console.log('User ID:', result.context.userId);
  console.log('Roles:', result.context.roles);
} else {
  console.error('Auth failed:', result.error);
}

// Token authentication
const tokenResult = await authManager.validateToken('eyJhbGc...');

if (tokenResult.success) {
  // Set auth context on peer
  peer.setAuthContext(tokenResult.context);
}
```

---

## Authorization

### AuthorizationManager

The `AuthorizationManager` provides ACL-based service and method-level access control.

#### Constructor

```typescript
const authzManager = new AuthorizationManager(logger: ILogger);
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerACL` | `(acl: ServiceACL) => void` | Register single ACL |
| `registerACLs` | `(acls: ServiceACL[]) => void` | Register multiple ACLs |
| `removeACL` | `(serviceName: string) => boolean` | Remove ACL |
| `canAccessService` | `(serviceName: string, auth?: AuthContext) => boolean` | Check service access |
| `canAccessMethod` | `(serviceName: string, methodName: string, auth?: AuthContext) => boolean` | Check method access |
| `filterDefinition` | `(serviceName: string, definition: any, auth?: AuthContext) => any` | Filter definition by permissions |
| `getACLs` | `() => ServiceACL[]` | Get all registered ACLs |
| `clearACLs` | `() => void` | Clear all ACLs |
| `setSuperAdminRole` | `(role: string) => void` | Set super admin role |
| `getSuperAdminRole` | `() => string` | Get super admin role |

### ACL Registration

```typescript
interface ServiceACL {
  service: string;                          // Service name pattern (supports wildcards)
  allowedRoles?: string[];                  // Roles that can access
  requiredPermissions?: string[];           // Required permissions
  policies?: string[];                      // Policy names to evaluate
  methods?: {                               // Per-method overrides
    [methodName: string]: {
      allowedRoles?: string[];
      requiredPermissions?: string[];
      policies?: string[];
      __override?: boolean;                 // Override service-level ACL completely
    }
  }
}

// Register ACLs
authzManager.registerACLs([
  {
    service: 'public-api@1.0.0',
    allowedRoles: []  // Empty roles = public access
  },
  {
    service: 'user-api@1.0.0',
    allowedRoles: ['user', 'admin'],
    methods: {
      // Admin-only method (overrides service-level)
      deleteUser: { allowedRoles: ['admin'], __override: true },
      // Requires specific permission
      updateProfile: { requiredPermissions: ['profile:write'] }
    }
  }
]);
```

### Wildcard Patterns

ACLs support wildcard patterns with optimized regex caching (~80% faster with cached patterns):

```typescript
authzManager.registerACL({
  service: 'api-*@1.0.0',  // Matches api-users, api-orders, etc.
  allowedRoles: ['user']
});

// Check access
authzManager.canAccessService('api-users@1.0.0', authContext); // true
authzManager.canAccessService('api-orders@1.0.0', authContext); // true

// Configure pattern matching options
authzManager.setPatternMatchOptions({
  caseInsensitive: true  // Match patterns case-insensitively
});

// Clear pattern cache when needed
authzManager.clearPatternCache();
```

### Super Admin Role

```typescript
// Set super admin role (bypasses all ACLs)
authzManager.setSuperAdminRole('superadmin');

// Super admins can access everything
const superAdminContext = { userId: '1', roles: ['superadmin'] };
authzManager.canAccessService('any-service@1.0.0', superAdminContext); // true
```

---

## Policy Engine

### PolicyEngine Class

The `PolicyEngine` provides sophisticated policy evaluation with caching, circuit breakers, and expression support.

#### Constructor

```typescript
const engine = new PolicyEngine(logger: ILogger, config?: PolicyEngineConfig);
```

#### Configuration

```typescript
interface PolicyEngineConfig {
  debug?: boolean;            // Enable debug mode with tracing (default: false)
  defaultTimeout?: number;    // Default policy timeout in ms (default: 5000)
  defaultCacheTTL?: number;   // Default cache TTL in ms (default: 60000)
}
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerPolicy` | `(policy: PolicyDefinition, options?) => void` | Register policy |
| `registerPolicies` | `(policies: PolicyDefinition[]) => void` | Register multiple policies |
| `unregisterPolicy` | `(name: string) => boolean` | Remove policy |
| `evaluate` | `(name: string, ctx: ExecutionContext, options?) => Promise<EnhancedPolicyDecision>` | Evaluate single policy |
| `evaluateAll` | `(names: string[], ctx, options?) => Promise<EnhancedPolicyDecision>` | All policies must pass |
| `evaluateAny` | `(names: string[], ctx, options?) => Promise<EnhancedPolicyDecision>` | Any policy must pass |
| `evaluateExpression` | `(expr: PolicyExpression, ctx, options?) => Promise<EnhancedPolicyDecision>` | Evaluate expression |
| `evaluateBatch` | `(contexts: ExecutionContext[], name, options?) => Promise<EnhancedPolicyDecision[]>` | Batch evaluation |
| `getPolicies` | `() => PolicyDefinition[]` | Get all policies |
| `getPoliciesByTag` | `(tag: string) => PolicyDefinition[]` | Get policies by tag |
| `getCacheStats` | `() => { size, hitRate, hits, misses }` | Get cache stats |
| `clearCache` | `(pattern?: string) => void` | Clear cache |
| `setDebugMode` | `(enabled: boolean) => void` | Enable debug mode |
| `getCircuitBreakerState` | `(name: string) => string \| undefined` | Get circuit state |
| `destroy` | `() => void` | Cleanup all resources |

### Policy Registration

```typescript
// Register policy with circuit breaker
engine.registerPolicy(
  {
    name: 'require-premium',
    description: 'User must have premium subscription',
    evaluate: async (ctx) => {
      const user = await db.users.findById(ctx.auth?.userId);
      return {
        allowed: user?.subscription === 'premium',
        reason: user?.subscription === 'premium' ? undefined : 'Premium required'
      };
    },
    tags: ['subscription', 'access']
  },
  {
    circuitBreaker: {
      threshold: 5,        // Open after 5 consecutive failures
      timeout: 5000,       // Policy evaluation timeout (ms)
      resetTimeout: 30000  // Try again after 30s when open
    }
  }
);
```

### Policy Evaluation

```typescript
// Single policy
const result = await engine.evaluate('require-auth', executionContext);

if (result.allowed) {
  // Access granted
} else {
  console.log('Denied:', result.reason);
  console.log('Metadata:', result.metadata);
}

// All policies must pass (AND)
const allResult = await engine.evaluateAll(
  ['require-auth', 'require-role-user', 'require-2fa'],
  executionContext
);

// Any policy must pass (OR)
const anyResult = await engine.evaluateAny(
  ['is-admin', 'is-owner', 'is-moderator'],
  executionContext
);
```

### Policy Expressions

Combine policies using logical expressions:

```typescript
// PolicyExpression type definition
type PolicyExpression =
  | string                              // Simple policy name
  | { and: PolicyExpression[] }         // All must pass
  | { or: PolicyExpression[] }          // Any must pass
  | { not: PolicyExpression }           // Must NOT pass

// Complex expression: (auth AND (admin OR owner)) AND NOT banned
const result = await engine.evaluateExpression(
  {
    and: [
      'require-auth',
      {
        or: ['is-admin', 'is-owner']
      },
      {
        not: 'is-banned'
      }
    ]
  },
  executionContext
);

// Short-circuit optimization: OR expressions stop on first passing policy
// This improves performance for common authorization patterns
```

### Batch Evaluation

Evaluate the same policy for multiple contexts in parallel:

```typescript
const contexts = users.map(user => ({
  auth: { userId: user.id, roles: user.roles, permissions: user.permissions },
  service: { name: 'myService', version: '1.0.0' },
  method: { name: 'getData', args: [] }
}));

const decisions = await policyEngine.evaluateBatch(contexts, 'canAccessData');
// Returns: EnhancedPolicyDecision[] in same order as contexts
```

### Unregister Policy

Remove a policy and cleanup its resources:

```typescript
const removed = policyEngine.unregisterPolicy('policy-name');
// Returns: true if removed, false if not found

// Cleanup actions:
// - Removes policy from registry
// - Calls policy's onDestroy() if defined
// - Deletes associated circuit breaker
// - Clears related cache entries
```

### Debug Mode and Tracing

Enable debug mode to trace policy evaluation:

```typescript
// Enable debug mode
policyEngine.setDebugMode(true);

const result = await engine.evaluate('my-policy', context);

// Result includes trace information when debug mode is enabled
if (result.trace) {
  result.trace.forEach(step => {
    console.log(`[${step.timestamp}] ${step.step}`, step.data);
  });
}

// Trace steps: 'start', 'cache_hit', 'cache_miss', 'evaluate_start',
// 'evaluate_complete', 'cached', 'error', 'circuit_breaker_open'

// Check circuit breaker state
const state = policyEngine.getCircuitBreakerState('my-policy');
console.log(`Circuit state: ${state}`);  // 'closed', 'open', or 'half-open'
```

---

## Built-in Policies

The `BuiltInPolicies` class provides 21 pre-built policies:

### RBAC Policies

```typescript
// Require authentication
BuiltInPolicies.requireAuth()

// Require specific role
BuiltInPolicies.requireRole('admin')

// Require any of the roles
BuiltInPolicies.requireAnyRole(['admin', 'moderator'])

// Require all roles
BuiltInPolicies.requireAllRoles(['user', 'verified'])

// Require permission
BuiltInPolicies.requirePermission('posts:write')

// Require any permission
BuiltInPolicies.requireAnyPermission(['read', 'write'])

// Permission pattern matching
BuiltInPolicies.requirePermissionPattern('posts:*')
```

### ABAC Policies

```typescript
// Require specific attribute value
BuiltInPolicies.requireAttribute('department', 'engineering')

// Resource owner check
BuiltInPolicies.requireResourceOwner()

// Tenant isolation
BuiltInPolicies.requireTenantIsolation()

// Environment check
BuiltInPolicies.requireEnvironment('production')

// Feature flag
BuiltInPolicies.requireFeatureFlag('new-dashboard', true)
```

### Network Policies

```typescript
// IP whitelist
BuiltInPolicies.requireIP(['192.168.1.1', '10.0.0.1'])

// IP blacklist
BuiltInPolicies.blockIP(['1.2.3.4', '5.6.7.8'])

// CIDR range
BuiltInPolicies.requireIPRange('192.168.0.0/16')
```

### Time-Based Policies

```typescript
// Time window (24h format)
BuiltInPolicies.requireTimeWindow('09:00', '17:00', 'America/New_York')

// Business hours with weekday restriction
BuiltInPolicies.requireBusinessHours({
  timezone: 'Europe/London',
  start: '09:00',
  end: '18:00',
  weekdays: [1, 2, 3, 4, 5]  // Monday-Friday
})
```

### OAuth2 Policies

```typescript
// Require OAuth2 scope
BuiltInPolicies.requireScope('read:users')

// Require any scope
BuiltInPolicies.requireAnyScope(['read:users', 'admin'])
```

### Rate Limiting Policies

```typescript
// Simple rate limit
BuiltInPolicies.rateLimit(100, 60000)  // 100 req/min

// Advanced rate limit with tiers
BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: { name: 'premium', limit: 1000, burst: 50 }
  }
})
```

---

## Session Management

### SessionManager Class

Manages user sessions with multi-device support and automatic expiration.

#### Constructor

```typescript
const sessionManager = new SessionManager(config?: SessionConfig);
```

#### Configuration

```typescript
interface SessionConfig {
  defaultTTL?: number;          // Default: 86400000 (24 hours)
  maxSessionsPerUser?: number;  // Default: 0 (unlimited)
  autoCleanup?: boolean;        // Default: true
  cleanupInterval?: number;     // Default: 300000 (5 minutes)
  trackActivity?: boolean;      // Default: true
}
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `createSession` | `(userId: string, context: AuthContext, options?) => Promise<Session>` | Create session |
| `getSession` | `(sessionId: string) => Promise<Session \| null>` | Get session |
| `getUserSessions` | `(userId: string) => Promise<Session[]>` | Get user's sessions |
| `updateSession` | `(sessionId: string, updates) => Promise<Session \| null>` | Update session |
| `refreshSession` | `(sessionId: string, ttl?) => Promise<Session \| null>` | Refresh expiration |
| `revokeSession` | `(sessionId: string) => Promise<boolean>` | Revoke single session |
| `revokeUserSessions` | `(userId: string) => Promise<number>` | Revoke all user sessions |
| `revokeOtherSessions` | `(userId: string, keepSessionId: string) => Promise<number>` | Revoke other sessions |
| `getStats` | `() => SessionStats` | Get statistics |
| `cleanup` | `() => Promise<number>` | Manual cleanup |
| `destroy` | `() => Promise<void>` | Shutdown manager |

### Multi-Device Support

```typescript
// Create session with device info
const session = await sessionManager.createSession(userId, authContext, {
  device: {
    id: 'device-123',
    name: 'iPhone 15',
    type: 'mobile',
    userAgent: 'Mozilla/5.0...'
  },
  metadata: { pushToken: 'abc123' }
});

// Get all user sessions
const sessions = await sessionManager.getUserSessions(userId);
sessions.forEach(s => {
  console.log(`${s.device?.name}: last active ${s.lastActivityAt}`);
});

// Logout from other devices
await sessionManager.revokeOtherSessions(userId, currentSession.sessionId);
```

---

## Audit Logging

### AuditLogger Class

Provides comprehensive audit trails with pluggable storage.

#### Constructor

```typescript
const auditLogger = new AuditLogger(logger: ILogger, config?: AuditLoggerConfig);
```

#### Configuration

```typescript
interface AuditLoggerConfig {
  storage?: AuditStorageAdapter;  // Storage backend (default: MemoryAuditAdapter)
  logger?: (event: AuditEvent) => void;  // Custom logger callback
  includeArgs?: boolean;          // Include method arguments (default: false)
  includeResult?: boolean;        // Include method result (default: false)
  includeUser?: boolean;          // Include user context (default: true)
  maxEventSize?: number;          // Max event size in bytes (default: 10KB)
  async?: boolean;                // Non-blocking mode (default: true)
}
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `logAuth` | `(event: AuditEvent) => Promise<void>` | Log authentication event |
| `query` | `(filter?: AuditFilter) => Promise<AuditEvent[]>` | Query events |
| `clearLogs` | `() => Promise<void>` | Clear all logs |
| `configure` | `(config: Partial<AuditLoggerConfig>) => void` | Update configuration |
| `getConfig` | `() => Readonly<Required<AuditLoggerConfig>>` | Get configuration |

### Storage Adapters

```typescript
// In-memory adapter (default, 10K capacity)
const memoryAdapter = new MemoryAuditAdapter(10000);  // maxSize

// File adapter (JSON Lines format)
const fileAdapter = new FileAuditAdapter('/var/log/audit.jsonl', {
  flushInterval: 5000  // Auto-flush every 5s
});

// Use adapter
const auditLogger = new AuditLogger(logger, { storage: fileAdapter });
```

### Usage Example

```typescript
// Log authentication attempt
await auditLogger.logAuth({
  timestamp: new Date(),
  userId: 'user-123',
  service: 'auth@1.0.0',
  method: 'authenticate',
  success: true,
  metadata: { mfaUsed: true, ipAddress: '192.168.1.1' }
});

// Query audit logs
const logs = await auditLogger.query({
  userId: 'user-123',
  success: false,
  startTime: new Date(Date.now() - 86400000),  // Last 24h
  endTime: new Date(),
  limit: 100
});
```

---

## Rate Limiting

### Choosing the Right Approach

Netron provides multiple rate limiting implementations for different use cases:

| Scenario | Solution | Auth Required | Tiered Limits |
|----------|----------|---------------|---------------|
| **Different user tiers** (SaaS pricing) | `BuiltInPolicies.requireRateLimit()` | ✅ Yes | ✅ Yes |
| **User-aware limiting** | `BuiltInPolicies.requireRateLimit()` | ✅ Yes | Optional |
| **Simple DDoS protection** | Middleware `rateLimit()` | ❌ No | ❌ No |
| **Public API endpoints** | Middleware `rateLimit()` | ❌ No | ❌ No |

**Decision Flow:**
1. Need different limits per user tier? → Use `requireRateLimit()` policy with tiers
2. Need user/auth context for rate limiting? → Use `requireRateLimit()` policy
3. Just need simple global protection? → Use middleware `rateLimit()`

### RateLimiter Class

Production-ready rate limiting with multiple strategies and tiered limits.

#### Constructor

```typescript
const limiter = new RateLimiter(logger: ILogger, config?: RateLimitConfig);
```

#### Configuration

```typescript
interface RateLimitConfig {
  defaultTier?: RateLimitTier;              // Default tier
  tiers?: Record<string, RateLimitTier>;    // Named tiers
  window?: number;                          // Time window (default: 60000ms)
  strategy?: 'sliding' | 'fixed' | 'token-bucket';  // Strategy
  queue?: boolean;                          // Enable queuing
  maxQueueSize?: number;                    // Max queue size (default: 1000)
  getTier?: (ctx: ExecutionContext) => string;  // Tier selector (sync)
}

interface RateLimitTier {
  name: string;
  limit: number;
  burst?: number;      // Token bucket burst allowance
  priority?: number;   // Queue priority (higher = first)
}
```

### Strategies

#### Sliding Window (Most Accurate)

```typescript
const limiter = new RateLimiter(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});
```

#### Fixed Window (Fastest)

```typescript
const limiter = new RateLimiter(logger, {
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});
```

#### Token Bucket (Burst Support)

```typescript
const limiter = new RateLimiter(logger, {
  strategy: 'token-bucket',
  window: 60000,
  defaultTier: {
    name: 'default',
    limit: 100,
    burst: 20  // Allow 120 tokens max
  }
});
```

### Tiered Limits

```typescript
const limiter = new RateLimiter(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'free', limit: 60 },
  tiers: {
    basic: { name: 'basic', limit: 300 },
    pro: { name: 'pro', limit: 1200 },
    enterprise: {
      name: 'enterprise',
      limit: 6000,
      burst: 1000,
      priority: 10
    }
  },
  getTier: (ctx) => ctx.auth?.subscription || 'free',
  queue: true,            // Enable request queuing
  maxQueueSize: 1000      // Maximum queued requests
});
```

**Queue Protection**: When queueing is enabled, requests timeout after 30 seconds to prevent indefinite blocking. Queue is processed every 100ms with priority ordering.

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `check` | `(key: string, tier?: string) => Promise<RateLimitResult>` | Check limit (non-consuming) |
| `consume` | `(key: string, tier?: string) => Promise<void>` | Consume a request |
| `reset` | `(key: string) => void` | Reset counter |
| `getStats` | `(key?: string) => RateLimitStats` | Get statistics |
| `destroy` | `() => void` | Cleanup resources |

---

## API Reference

### Types

```typescript
// Authentication
interface AuthCredentials {
  username?: string;
  password?: string;
  token?: string;
}

interface AuthResult {
  success: boolean;
  context?: AuthContext;
  error?: string;
}

interface AuthContext {
  userId: string;
  roles: string[];
  permissions: string[];
  scopes?: string[];
  token?: { type: 'bearer' | 'mac' | 'custom'; expiresAt?: Date; issuer?: string; audience?: string[] };
  metadata?: Record<string, any>;
}

// Execution Context
interface ExecutionContext {
  auth?: AuthContext;
  service: { name: string; version: string };
  method?: { name: string; args: any[] };
  resource?: { id?: string; type?: string; owner?: string; attributes?: Record<string, any> };
  environment?: { ip?: string; timestamp?: Date; transport?: string; [key: string]: any };
  request?: { headers?: Record<string, string>; metadata?: Record<string, any> };
}

// Policy
interface PolicyDefinition {
  name: string;
  description?: string;
  evaluate: (ctx: ExecutionContext) => Promise<PolicyDecision> | PolicyDecision;
  tags?: string[];
  onDestroy?: () => void;  // Optional cleanup when policy is unregistered
}

interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  metadata?: Record<string, any>;
}

interface EnhancedPolicyDecision extends PolicyDecision {
  policyName?: string;
  evaluationTime?: number;
  trace?: Array<{ step: string; timestamp: number; data?: any }>;  // Only in debug mode
}

// Session
interface Session {
  sessionId: string;
  userId: string;
  context: AuthContext;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  device?: {
    id: string;
    name?: string;
    type?: string;
    userAgent?: string;
  };
  metadata?: Record<string, any>;
}

// Audit
interface AuditEvent {
  userId?: string;
  action: string;
  service?: string;
  method?: string;
  success?: boolean;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  timestamp?: number;
}

interface AuditFilter {
  userId?: string;
  service?: string;
  method?: string;
  success?: boolean;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}
```

### Utility Functions

```typescript
// Extract Bearer token from Authorization header
extractBearerToken(header: string | undefined): string | null

// Parse Authorization header
parseAuthorizationHeader(header: string | undefined): { scheme: string; credentials: string } | null
```

---

## Best Practices

### 1. Layer Your Security

```typescript
// Layer 1: Rate limiting (PRE_PROCESS)
pipeline.use(NetronBuiltinMiddleware.rateLimit({ maxRequests: 1000 }), {}, MiddlewareStage.PRE_PROCESS);

// Layer 2: Authentication (PRE_INVOKE)
pipeline.use(authMiddleware, {}, MiddlewareStage.PRE_INVOKE);

// Layer 3: Authorization (policies on services)
@Service('api@1.0.0')
@UsePolicy(BuiltInPolicies.requireAuth(), BuiltInPolicies.requireRole('user'))
class ApiService { ... }
```

### 2. Use Token Caching

```typescript
authManager.configure({
  cache: {
    enabled: true,
    ttl: 60000,     // Cache valid tokens for 1 minute
    maxSize: 10000  // Prevent memory issues
  }
});

// Monitor cache performance
setInterval(() => {
  const stats = authManager.getCacheStats();
  if (stats.hitRate < 0.5) {
    logger.warn('Low auth cache hit rate:', stats);
  }
}, 60000);
```

### 3. Enable Audit Logging

```typescript
const auditLogger = new AuditLogger({
  adapter: new FileAuditAdapter({ filePath: '/var/log/audit.jsonl' }),
  redactFields: ['password', 'token', 'secret', 'apiKey'],
  async: true  // Non-blocking
});

authManager.configure({
  audit: { enabled: true, logger: auditLogger }
});
```

### 4. Implement Session Management

```typescript
// Limit concurrent sessions
const sessionManager = new SessionManager({
  maxSessionsPerUser: 3,  // Max 3 devices
  sessionTTL: 7 * 24 * 60 * 60 * 1000  // 7 days
});

// Auto-cleanup
setInterval(() => sessionManager.cleanup(), 5 * 60 * 1000);
```

---

## Troubleshooting

### Authentication Failures

```typescript
// Enable debug logging
authManager.configure({
  audit: {
    enabled: true,
    logger: auditLogger
  }
});

// Check if configured
if (!authManager.isConfigured()) {
  throw new Error('Authenticator not configured');
}
```

### Policy Evaluation Issues

```typescript
// Enable debug mode
policyEngine.setDebugMode(true);

// Check circuit breaker state
const state = policyEngine.getCircuitBreakerState('my-policy');
if (state === 'open') {
  logger.warn('Policy circuit breaker is open');
}
```

### Rate Limit Issues

```typescript
// Get detailed stats for a specific key
const stats = limiter.getStats('user-123');
console.log({
  totalChecks: stats.totalChecks,
  totalAllowed: stats.totalAllowed,
  totalDenied: stats.totalDenied,
  currentQueueSize: stats.currentQueueSize
});

// Check current limit status
const result = await limiter.check('user-123', 'premium');
console.log({
  allowed: result.allowed,
  remaining: result.remaining,
  resetAt: result.resetAt
});
```

---

## Performance Characteristics

| Component | Metric | Value |
|-----------|--------|-------|
| **Token Caching** | Hit rate (typical) | ~80% after warm-up |
| **ACL Pattern Matching** | Cached regex | ~80% faster than uncached |
| **Policy Caching** | Default TTL | 60 seconds |
| **Policy Caching** | Max cache size | 10,000 entries |
| **MemoryAuditAdapter** | Insertion complexity | O(1) via circular buffer |
| **MemoryAuditAdapter** | Default capacity | 10,000 events |
| **Rate Limiter** | Cleanup interval | Every 5 minutes |
| **Rate Limiter** | Queue processing | Every 100ms |
| **Session Cleanup** | Interval | Every 5 minutes |

### Memory Management

- **Token Cache**: LRU eviction with configurable max size
- **ACL Pattern Cache**: Automatic invalidation on pattern changes
- **Policy Cache**: TTL-based expiration with pattern-based clearing
- **Audit Buffer**: Circular buffer with O(1) insertion
- **Rate Limiter**: Automatic stale entry cleanup

---

## See Also

- [Middleware Documentation](../middleware/README.md)
- [Core Tasks Documentation](../core-tasks/README.md)
- [Transport Documentation](../transport/README.md)

---

**Last Updated:** 2025-12-26
**Version:** 3.2.0
