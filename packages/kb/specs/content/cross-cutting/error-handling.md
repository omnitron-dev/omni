---
module: cross-cutting
title: "Error Handling Patterns"
tags: [errors, patterns, titan, netron, rpc]
summary: "Error hierarchy, propagation, and handling conventions across the stack"
---

## Error Hierarchy

```
TitanError (base)
├── ValidationError        → input validation failures (Zod)
├── ServiceError           → domain-level errors
├── NexusError             → DI container errors
│   ├── ResolutionError
│   ├── CircularDependencyError
│   └── DependencyNotFoundError
├── NetronError            → RPC transport errors
└── HttpError              → HTTP-specific errors with status codes
```

## Convention
- All custom errors extend `TitanError`
- Errors carry structured metadata (code, details, cause)
- RPC errors are serialized/deserialized transparently across Netron
- HTTP transport maps error codes to HTTP status codes

## In RPC Services
```typescript
@Public({ auth: { roles: ['admin'] } })
async deleteUser(userId: string): Promise<void> {
  const user = await this.users.findById(userId);
  if (!user) {
    throw new ServiceError('USER_NOT_FOUND', `User ${userId} not found`);
  }
  // ServiceError propagates to caller with code + message
}
```

## In Frontend
- RPC errors arrive with code + message via Netron protocol
- `invokeWithRetry()` catches 401/SESSION_EXPIRED, refreshes session, retries once
- Auth methods (signin/signup/signout) are never retried (prevents loops)
