# Netron Auth Best Practices

This guide provides best practices for implementing authentication and authorization in Netron applications.

## Table of Contents

- [Authentication](#authentication)
- [Authorization](#authorization)
- [Service Design](#service-design)
- [Policy Design](#policy-design)
- [Error Handling](#error-handling)
- [Performance](#performance)
- [Security](#security)
- [Testing](#testing)

## Authentication

### Use Strong Credential Validation

```typescript
// ❌ Bad: Weak password validation
const authManager = new AuthenticationManager({
  authenticate: async (credentials) => {
    if (credentials.password === users[credentials.username]?.password) {
      return { success: true, context: { userId: credentials.username } };
    }
    return { success: false };
  }
});

// ✅ Good: Strong validation with proper hashing
import bcrypt from 'bcrypt';

const authManager = new AuthenticationManager({
  authenticate: async (credentials) => {
    const user = await db.users.findOne({ email: credentials.username });

    if (!user) {
      return { success: false, error: 'Invalid credentials' };
    }

    const isValid = await bcrypt.compare(credentials.password, user.passwordHash);

    if (!isValid) {
      return { success: false, error: 'Invalid credentials' };
    }

    return {
      success: true,
      context: {
        userId: user.id,
        username: user.email,
        roles: user.roles,
        permissions: user.permissions
      }
    };
  }
});
```

### Implement Token Expiration

```typescript
// ✅ Good: Tokens with expiration
const authManager = new AuthenticationManager({
  validateToken: async (token) => {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);

      // Check expiration
      if (Date.now() >= payload.exp * 1000) {
        return { success: false, error: 'Token expired' };
      }

      return {
        success: true,
        context: {
          userId: payload.sub,
          roles: payload.roles,
          permissions: payload.permissions,
          token: {
            type: 'bearer',
            expiresAt: new Date(payload.exp * 1000)
          }
        }
      };
    } catch (error) {
      return { success: false, error: 'Invalid token' };
    }
  }
});
```

### Secure Token Storage

```typescript
// ❌ Bad: Storing tokens in localStorage (XSS vulnerable)
localStorage.setItem('token', authResult.token);

// ✅ Good: Store in httpOnly cookies (server-side)
response.cookie('token', jwt, {
  httpOnly: true,
  secure: true,  // HTTPS only
  sameSite: 'strict',
  maxAge: 3600000  // 1 hour
});

// ✅ Good: For client-side, use memory storage
class TokenManager {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  clearToken() {
    this.token = null;
  }
}
```

## Authorization

### Principle of Least Privilege

```typescript
// ❌ Bad: Overly permissive ACLs
authzManager.setServiceACL('userService@1.0.0', {
  allowAnonymous: true  // Everyone can access
});

// ✅ Good: Restrictive by default
authzManager.setServiceACL('userService@1.0.0', {
  roles: ['user', 'admin'],
  allowAnonymous: false
});

authzManager.setMethodACL('userService@1.0.0', 'deleteUser', {
  roles: ['admin'],  // Only admins can delete
  permissions: ['delete:users']
});
```

### Granular Method-Level Auth

```typescript
// ✅ Good: Fine-grained control
@Service('userService@1.0.0')
export class UserService {
  @Method({
    auth: true  // Any authenticated user
  })
  async getCurrentUser(authContext: AuthContext) {
    return this.findById(authContext.userId);
  }

  @Method({
    auth: {
      roles: ['user', 'admin']
    }
  })
  async getUser(userId: string) {
    return this.findById(userId);
  }

  @Method({
    auth: {
      roles: ['admin'],
      permissions: ['write:users']
    }
  })
  async updateUser(userId: string, data: any) {
    return this.update(userId, data);
  }

  @Method({
    auth: {
      policies: ['requireRole:admin']
    }
  })
  async deleteUser(userId: string) {
    return this.delete(userId);
  }
}
```

### Resource Ownership Checks

```typescript
// ✅ Good: Check resource ownership
@Method({
  auth: {
    policies: {
      any: ['requireRole:admin', 'requireResourceOwner']
    }
  }
})
async updateProfile(userId: string, data: any, authContext: AuthContext) {
  // Admin can update any profile, users can update their own
  if (!authContext.roles?.includes('admin') && authContext.userId !== userId) {
    throw new TitanError({
      code: ErrorCode.FORBIDDEN,
      message: 'Cannot update another user\'s profile'
    });
  }

  return this.update(userId, data);
}
```

## Service Design

### Keep Services Focused

```typescript
// ❌ Bad: God object with too many responsibilities
@Service('appService@1.0.0')
export class AppService {
  async getUser() { }
  async updateUser() { }
  async getProduct() { }
  async updateProduct() { }
  async getOrder() { }
  async updateOrder() { }
}

// ✅ Good: Focused services
@Service('userService@1.0.0')
export class UserService {
  async getUser() { }
  async updateUser() { }
  async deleteUser() { }
}

@Service('productService@1.0.0')
export class ProductService {
  async getProduct() { }
  async updateProduct() { }
  async deleteProduct() { }
}
```

### Use Semantic Versioning

```typescript
// ✅ Good: Version your services properly
@Service('userService@1.0.0')  // Initial version

@Service('userService@1.1.0')  // Backward-compatible changes

@Service('userService@2.0.0')  // Breaking changes
```

### Document Method Contracts

```typescript
// ✅ Good: Well-documented methods
@Service('userService@1.0.0')
export class UserService {
  /**
   * Get user by ID
   *
   * @param userId - The user ID to look up
   * @returns User object or null if not found
   * @throws {TitanError} If user ID is invalid
   *
   * @auth Requires authentication, any role
   * @permission read:users
   */
  @Method({
    auth: {
      roles: ['user', 'admin'],
      permissions: ['read:users']
    }
  })
  async getUser(userId: string): Promise<User | null> {
    if (!isValidUserId(userId)) {
      throw new TitanError({
        code: ErrorCode.INVALID_ARGUMENT,
        message: 'Invalid user ID format'
      });
    }

    return this.repository.findById(userId);
  }
}
```

## Policy Design

### Create Reusable Policies

```typescript
// ✅ Good: Reusable policies
policyEngine.registerPolicy({
  name: 'requireTenantAccess',
  description: 'Require user to have access to specified tenant',
  evaluate: async (context, options) => {
    const tenantId = options?.tenantId;
    const userTenants = context.auth?.tenants || [];

    if (userTenants.includes(tenantId)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `User does not have access to tenant ${tenantId}`
    };
  }
});

// Use across multiple methods
@Method({
  auth: {
    policies: [{
      name: 'requireTenantAccess',
      options: { tenantId: 'context.tenantId' }
    }]
  }
})
async getTenantData(tenantId: string) {
  // ...
}
```

### Combine Policies Logically

```typescript
// ✅ Good: Logical policy combinations
@Method({
  auth: {
    policies: {
      all: [  // AND logic
        'requireAuth',
        'requireRole:user',
        'requireTenantAccess'
      ]
    }
  }
})
async accessTenantResource() {
  // All policies must pass
}

@Method({
  auth: {
    policies: {
      any: [  // OR logic
        'requireRole:admin',
        'requirePermission:write:own-data'
      ]
    }
  }
})
async updateData() {
  // Either policy can pass
}
```

### Cache Policy Results Appropriately

```typescript
// ✅ Good: Configure caching based on policy volatility
const policyEngine = new PolicyEngine({
  logger,
  caching: {
    enabled: true,
    ttl: 60000,  // 60 seconds for stable policies
    maxSize: 1000
  }
});

// For volatile policies, use shorter TTL
policyEngine.registerPolicy({
  name: 'requireActiveSubscription',
  cache: {
    ttl: 5000  // 5 seconds - check frequently
  },
  evaluate: async (context) => {
    const subscription = await getSubscription(context.auth.userId);
    return {
      allowed: subscription.active && subscription.expiresAt > Date.now()
    };
  }
});
```

## Error Handling

### Provide Meaningful Error Messages

```typescript
// ❌ Bad: Generic error messages
if (!user) {
  throw new Error('Error');
}

// ✅ Good: Specific, actionable errors
if (!user) {
  throw new TitanError({
    code: ErrorCode.NOT_FOUND,
    message: `User with ID '${userId}' not found`,
    details: {
      userId,
      action: 'get_user'
    }
  });
}
```

### Handle Auth Failures Gracefully

```typescript
// ✅ Good: Graceful error handling
try {
  const authResult = await peer.runTask('authenticate', credentials);

  if (!authResult.success) {
    logger.warn({ error: authResult.error }, 'Authentication failed');
    // Show user-friendly message
    showError('Invalid username or password');
    return;
  }

  // Continue with authenticated session
} catch (error) {
  logger.error({ error }, 'Authentication error');
  showError('An error occurred during authentication. Please try again.');
}
```

### Don't Leak Information in Errors

```typescript
// ❌ Bad: Leaking user existence
if (!user) {
  return { success: false, error: 'User not found' };
}
if (!await bcrypt.compare(password, user.passwordHash)) {
  return { success: false, error: 'Invalid password' };
}

// ✅ Good: Generic error message
const user = await db.users.findOne({ email });
const isValid = user && await bcrypt.compare(password, user.passwordHash);

if (!isValid) {
  return { success: false, error: 'Invalid credentials' };  // Same message
}
```

## Performance

### Enable Policy Caching

```typescript
// ✅ Good: Enable caching for better performance
const policyEngine = new PolicyEngine({
  logger,
  caching: {
    enabled: true,
    ttl: 60000,  // Cache for 60 seconds
    maxSize: 10000  // Store up to 10k results
  }
});
```

### Use Service Definition Caching

```typescript
// ✅ Good: Caching is automatic in Phase 6+
const service = await peer.queryInterface('userService@1.0.0');
// Subsequent queries use cached definition

// Invalidate when needed
peer.invalidateDefinitionCache('userService@1.0.0');
```

### Batch Authorization Checks

```typescript
// ❌ Bad: Multiple individual checks
for (const userId of userIds) {
  const canAccess = await authzManager.canAccessMethod(
    'userService@1.0.0',
    'getUser',
    authContext
  );
  if (canAccess) {
    users.push(await getUser(userId));
  }
}

// ✅ Good: Single check, then filter
const canAccess = await authzManager.canAccessMethod(
  'userService@1.0.0',
  'getUser',
  authContext
);

if (canAccess) {
  users = await Promise.all(userIds.map(id => getUser(id)));
}
```

### Use Circuit Breakers

```typescript
// ✅ Good: Circuit breakers protect against cascading failures
const policyEngine = new PolicyEngine({
  logger,
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,  // Open after 5 failures
    timeout: 60000,  // Try again after 60s
    monitoringPeriod: 10000  // Monitor failures over 10s
  }
});
```

## Security

### Always Validate Input

```typescript
// ✅ Good: Validate all inputs
@Method({
  auth: {
    roles: ['admin'],
    permissions: ['write:users']
  }
})
async updateUser(userId: string, data: any) {
  // Validate user ID
  if (!isValidUserId(userId)) {
    throw new TitanError({
      code: ErrorCode.INVALID_ARGUMENT,
      message: 'Invalid user ID format'
    });
  }

  // Validate update data
  const schema = Joi.object({
    name: Joi.string().max(100),
    email: Joi.string().email(),
    role: Joi.string().valid('user', 'admin', 'guest')
  });

  const { error, value } = schema.validate(data);
  if (error) {
    throw new TitanError({
      code: ErrorCode.INVALID_ARGUMENT,
      message: 'Invalid update data',
      details: error.details
    });
  }

  return this.repository.update(userId, value);
}
```

### Use HTTPS for Production

```typescript
// ✅ Good: Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  netron.registerTransportServer('https', {
    name: 'https',
    options: {
      host: '0.0.0.0',
      port: 443,
      cert: fs.readFileSync('/path/to/cert.pem'),
      key: fs.readFileSync('/path/to/key.pem')
    }
  });
} else {
  // HTTP for development only
  netron.registerTransportServer('http', {
    name: 'http',
    options: { host: 'localhost', port: 3000 }
  });
}
```

### Implement Rate Limiting

```typescript
// ✅ Good: Rate limit authentication attempts
const authAttempts = new Map<string, number[]>();

const authManager = new AuthenticationManager({
  authenticate: async (credentials) => {
    const username = credentials.username || '';
    const attempts = authAttempts.get(username) || [];

    // Clean old attempts (older than 15 minutes)
    const recentAttempts = attempts.filter(t => Date.now() - t < 900000);

    // Check rate limit
    if (recentAttempts.length >= 5) {
      return {
        success: false,
        error: 'Too many failed attempts. Please try again later.'
      };
    }

    // Attempt authentication
    const result = await authenticateUser(credentials);

    if (!result.success) {
      recentAttempts.push(Date.now());
      authAttempts.set(username, recentAttempts);
    } else {
      authAttempts.delete(username);
    }

    return result;
  }
});
```

### Sanitize Log Output

```typescript
// ❌ Bad: Logging sensitive data
logger.info({ credentials }, 'Authentication attempt');

// ✅ Good: Sanitize before logging
logger.info({
  username: credentials.username,
  // Password and tokens omitted
}, 'Authentication attempt');
```

## Testing

### Test Authentication Scenarios

```typescript
describe('Authentication', () => {
  it('should authenticate with valid credentials', async () => {
    const result = await authManager.authenticate({
      username: 'user@example.com',
      password: 'password123'
    });

    expect(result.success).toBe(true);
    expect(result.context).toBeDefined();
  });

  it('should reject invalid credentials', async () => {
    const result = await authManager.authenticate({
      username: 'user@example.com',
      password: 'wrong'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should validate tokens', async () => {
    const token = createTestToken({ userId: 'user1', roles: ['admin'] });

    const result = await authManager.validateToken(token);

    expect(result.success).toBe(true);
    expect(result.context.userId).toBe('user1');
  });
});
```

### Test Authorization Rules

```typescript
describe('Authorization', () => {
  it('should allow admin to access admin methods', async () => {
    const canAccess = authzManager.canAccessMethod(
      'userService@1.0.0',
      'deleteUser',
      { userId: 'user1', roles: ['admin'], permissions: ['delete:users'] }
    );

    expect(canAccess).toBe(true);
  });

  it('should deny non-admin from admin methods', async () => {
    const canAccess = authzManager.canAccessMethod(
      'userService@1.0.0',
      'deleteUser',
      { userId: 'user2', roles: ['user'], permissions: [] }
    );

    expect(canAccess).toBe(false);
  });
});
```

### Test Policy Evaluation

```typescript
describe('Policies', () => {
  it('should evaluate requireRole policy', async () => {
    const decision = await policyEngine.evaluate(
      'requireRole',
      {
        auth: { userId: 'user1', roles: ['admin'], permissions: [] },
        service: 'userService@1.0.0',
        method: 'deleteUser'
      },
      { role: 'admin' }
    );

    expect(decision.allowed).toBe(true);
  });
});
```

### Integration Testing

```typescript
describe('Full Auth Flow', () => {
  it('should complete end-to-end authentication and authorization', async () => {
    // Connect
    const peer = await netron.connect('ws://localhost:3000');

    // Authenticate
    const authResult = await peer.runTask('authenticate', {
      username: 'admin@example.com',
      password: 'admin123'
    });

    expect(authResult.success).toBe(true);

    // Query service
    const service = await peer.queryInterface('userService@1.0.0');

    // Call authorized method
    const user = await service.getUser('user1');
    expect(user).toBeDefined();

    // Cleanup
    await service.$release();
    await peer.disconnect();
  });
});
```

## Summary

Key takeaways:

1. **Authentication**: Use strong validation, implement token expiration, secure storage
2. **Authorization**: Principle of least privilege, granular method-level auth, resource ownership
3. **Service Design**: Keep focused, version properly, document contracts
4. **Policy Design**: Create reusable policies, combine logically, cache appropriately
5. **Error Handling**: Meaningful messages, graceful failures, don't leak information
6. **Performance**: Enable caching, batch checks, use circuit breakers
7. **Security**: Validate input, use HTTPS, rate limit, sanitize logs
8. **Testing**: Test all scenarios, integration tests, policy evaluation

Following these practices will help you build secure, performant, and maintainable Netron applications.
