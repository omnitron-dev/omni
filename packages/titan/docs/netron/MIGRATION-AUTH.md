# Migration Guide: Abilities Exchange to Auth-Aware Service Discovery

This guide explains how to migrate from the deprecated abilities exchange protocol to the new auth-aware service discovery system in Netron.

## Overview

The abilities exchange protocol has been replaced with a more secure and flexible auth-aware service discovery system. This new system provides:

- **Better Security**: Services are discovered with authorization checks
- **Per-User Filtering**: Service definitions filtered based on user permissions
- **On-Demand Loading**: Services loaded only when needed, reducing overhead
- **Better Performance**: Caching layer reduces repeated network calls
- **Flexible Authorization**: Support for RBAC, ABAC, PBAC, and custom policies

## What Changed

### Old Behavior (Deprecated)

```typescript
// Old: Abilities exchange during connection
const netron = new Netron(logger, {
  id: 'my-netron',
  allowServiceEvents: true  // Enabled service events
});

await netron.start();
const peer = await netron.connect('ws://localhost:3000');

// All services automatically discovered and cached
// No authorization checks
// All users see the same service definitions
```

### New Behavior (Recommended)

```typescript
// New: On-demand discovery with auth
const netron = new Netron(logger, {
  id: 'my-netron'
  // No legacyAbilitiesExchange needed
});

await netron.start();
const peer = await netron.connect('ws://localhost:3000');

// 1. Authenticate user
const authResult = await peer.runTask('authenticate', {
  username: 'user@example.com',
  password: 'password123'
});

if (!authResult.success) {
  throw new Error('Authentication failed');
}

// 2. Query services on-demand (with auth checks)
const userService = await peer.queryInterface<IUserService>('userService@1.0.0');

// Service definition is:
// - Filtered based on user's roles/permissions
// - Cached for subsequent queries
// - Only accessible methods are exposed
```

## Migration Steps

### Step 1: Remove Legacy Flag

If you're using the legacy flag, remove it:

```typescript
// BEFORE (deprecated)
const netron = new Netron(logger, {
  id: 'my-netron',
  legacyAbilitiesExchange: true  // ❌ Remove this
});

// AFTER
const netron = new Netron(logger, {
  id: 'my-netron'
  // ✅ No legacy flag needed
});
```

### Step 2: Implement Authentication

Add authentication to your connection flow:

```typescript
// Configure authentication manager (server side)
import { AuthenticationManager } from '@omnitron-dev/titan/netron/auth';

const authManager = new AuthenticationManager({
  async authenticate(credentials) {
    // Validate credentials against your user database
    const user = await db.users.findOne({ email: credentials.username });

    if (!user || !await bcrypt.compare(credentials.password, user.passwordHash)) {
      return { success: false, error: 'Invalid credentials' };
    }

    return {
      success: true,
      context: {
        userId: user.id,
        roles: user.roles,
        permissions: user.permissions
      }
    };
  },

  async validateToken(token) {
    // Validate JWT token
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      return {
        success: true,
        context: {
          userId: payload.sub,
          roles: payload.roles,
          permissions: payload.permissions
        }
      };
    } catch (error) {
      return { success: false, error: 'Invalid token' };
    }
  }
});

// Register with Netron
netron.authenticationManager = authManager;
```

### Step 3: Implement Authorization

Configure authorization for your services:

```typescript
import { AuthorizationManager } from '@omnitron-dev/titan/netron/auth';

const authzManager = new AuthorizationManager();

// Define service-level ACLs
authzManager.setServiceACL('userService@1.0.0', {
  roles: ['user', 'admin'],
  allowAnonymous: false
});

authzManager.setServiceACL('adminService@1.0.0', {
  roles: ['admin'],
  allowAnonymous: false
});

// Define method-level ACLs
authzManager.setMethodACL('userService@1.0.0', 'updateUser', {
  roles: ['admin', 'user'],
  permissions: ['write:users']
});

authzManager.setMethodACL('userService@1.0.0', 'deleteUser', {
  roles: ['admin'],
  permissions: ['delete:users']
});

// Register with Netron
netron.authorizationManager = authzManager;
```

### Step 4: Use Method-Level Authorization Decorators

Add authorization to your service methods:

```typescript
import { Service, Method } from '@omnitron-dev/titan/decorators';

@Service('userService@1.0.0')
export class UserService {
  @Method({
    auth: {
      roles: ['user', 'admin'],
      permissions: ['read:users']
    }
  })
  async getUser(userId: string) {
    return await db.users.findById(userId);
  }

  @Method({
    auth: {
      roles: ['admin'],
      permissions: ['write:users']
    }
  })
  async updateUser(userId: string, data: any) {
    return await db.users.update(userId, data);
  }

  @Method({
    auth: {
      roles: ['admin'],
      permissions: ['delete:users']
    }
  })
  async deleteUser(userId: string) {
    return await db.users.delete(userId);
  }

  @Method({
    auth: true  // Require authentication, any role
  })
  async getCurrentUser() {
    // Access auth context from execution context
    return this.currentUser;
  }
}
```

### Step 5: Update Client Code

Update your client to authenticate before querying services:

```typescript
// Client connection
const peer = await netron.connect('ws://localhost:3000');

try {
  // Authenticate
  const authResult = await peer.runTask('authenticate', {
    username: 'user@example.com',
    password: 'password123'
  });

  if (!authResult.success) {
    throw new Error(`Authentication failed: ${authResult.error}`);
  }

  console.log('Authenticated as:', authResult.context.userId);

  // Query services (auth context is automatically used)
  const userService = await peer.queryInterface<IUserService>('userService@1.0.0');

  // Use service methods (auth checks applied automatically)
  const user = await userService.getUser('123');

  // This will fail if user lacks permissions
  try {
    await userService.deleteUser('123');
  } catch (error) {
    console.error('Permission denied:', error.message);
  }

} finally {
  await peer.disconnect();
}
```

### Step 6: HTTP Transport Migration

For HTTP transport, use the new endpoints:

```typescript
// Authenticate via HTTP
const authResponse = await fetch('http://localhost:3000/netron/authenticate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    credentials: {
      username: 'user@example.com',
      password: 'password123'
    }
  })
});

const { result: authResult } = await authResponse.json();

if (!authResult.success) {
  throw new Error('Authentication failed');
}

// Store token for subsequent requests
const token = authResult.context.token;

// Query interface with auth
const queryResponse = await fetch('http://localhost:3000/netron/query-interface', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    serviceName: 'userService@1.0.0'
  })
});

const { result: definition } = await queryResponse.json();
console.log('Accessible methods:', Object.keys(definition.meta.methods));
```

## Policy-Based Authorization

The new system supports advanced policy-based authorization:

```typescript
import { PolicyEngine } from '@omnitron-dev/titan/netron/auth';

const policyEngine = new PolicyEngine({ logger });

// Use built-in policies
@Method({
  auth: {
    policies: ['requireRole:admin']  // Require admin role
  }
})
async deleteAllUsers() {
  // Only admins can call this
}

@Method({
  auth: {
    policies: {
      all: ['requireAuth', 'requireRole:user']  // AND logic
    }
  }
})
async updateProfile(data: any) {
  // Must be authenticated AND have user role
}

@Method({
  auth: {
    policies: {
      any: ['requireRole:admin', 'requirePermission:write:own-profile']  // OR logic
    }
  }
})
async updateUser(userId: string, data: any) {
  // Admin OR has write:own-profile permission
}

// Custom policies
policyEngine.registerPolicy({
  name: 'requireResourceOwner',
  description: 'Require user to own the resource',
  evaluate: async (context, options) => {
    const resourceOwnerId = options?.resourceOwnerId;
    const userId = context.auth?.userId;

    if (userId === resourceOwnerId) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: 'User does not own this resource'
    };
  }
});
```

## Testing Migration

Test your migration with both modes:

```typescript
describe('Migration', () => {
  it('should work in legacy mode', async () => {
    const netron = new Netron(logger, {
      legacyAbilitiesExchange: true  // Legacy mode for testing
    });

    // Test old behavior
    const peer = await netron.connect('ws://localhost:3000');
    const service = await peer.queryInterface('userService@1.0.0');

    // All methods visible (no filtering)
    expect(service).toBeDefined();
  });

  it('should work in modern mode with auth', async () => {
    const netron = new Netron(logger);

    const peer = await netron.connect('ws://localhost:3000');

    // Authenticate first
    const authResult = await peer.runTask('authenticate', {
      username: 'user@example.com',
      password: 'password'
    });

    expect(authResult.success).toBe(true);

    // Query with auth
    const service = await peer.queryInterface('userService@1.0.0');

    // Only authorized methods visible
    expect(service).toBeDefined();
  });
});
```

## Backward Compatibility

The `legacyAbilitiesExchange` flag provides backward compatibility during migration:

- **Set to `true`**: Uses old abilities exchange (deprecated, logs warning)
- **Set to `false` or omitted**: Uses new auth-aware discovery (recommended)

## Performance Considerations

The new system is more efficient:

1. **Lazy Loading**: Services loaded only when needed
2. **Caching**: Definitions cached in AbstractPeer (Phase 6)
3. **Reduced Overhead**: No upfront service exchange, O(1) connection time
4. **Policy Caching**: Policy results cached for 60s (configurable)

## Troubleshooting

### Services not visible after connection

**Problem**: `queryInterface()` fails with "Service not found"

**Solution**: Services are no longer automatically discovered. Query them explicitly:

```typescript
// Instead of relying on pre-discovery
const service = await peer.queryInterface('myService@1.0.0');
```

### Permission denied errors

**Problem**: `FORBIDDEN` error when calling methods

**Solution**: Ensure proper authentication and authorization:

```typescript
// 1. Authenticate first
const authResult = await peer.runTask('authenticate', credentials);

// 2. Check auth was successful
if (!authResult.success) {
  throw new Error('Auth failed');
}

// 3. Ensure user has required roles/permissions
// Check server-side ACLs and method decorators
```

### Missing AuthenticationManager error

**Problem**: "Authentication not configured" error

**Solution**: Register AuthenticationManager with Netron:

```typescript
const authManager = new AuthenticationManager({ ... });
netron.authenticationManager = authManager;
```

## Additional Resources

- [Auth Architecture Specification](../../specs/netron-improvements.md)
- [Policy Engine Documentation](./POLICY-ENGINE.md)
- [Built-in Policies Reference](./BUILT-IN-POLICIES.md)
- [HTTP Transport Auth](./HTTP-AUTH.md)

## Support

For questions or issues:
- GitHub Issues: https://github.com/omnitron-dev/omni/issues
- Documentation: https://docs.omnitron.dev/netron
