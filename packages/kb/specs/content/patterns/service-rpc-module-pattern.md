---
name: service-rpc-module
title: "Service → RPC Service → Module Pattern"
tags: [pattern, service, rpc, module]
---

## Structure

Every backend feature uses exactly three files:

| File | Responsibility | Contains |
|------|---------------|----------|
| `{feature}.service.ts` | Domain logic | Business rules, repository calls, no transport |
| `{feature}.rpc-service.ts` | RPC exposure | `@Service`, `@Public`, validation, DTO mapping |
| `{feature}.module.ts` | DI wiring | `@Module({ providers, exports })` |

## Rules
1. Service names WITHOUT version: `@Service({ name: 'Auth' })`
2. Every RPC method has `@Public({ auth: {...} })` — explicit authorization
3. Domain service is injectable and testable in isolation
4. RPC service delegates to domain service — no business logic in RPC layer

## Example

```typescript
// auth.service.ts
@Injectable({ scope: Scope.Singleton })
export class AuthService {
  constructor(@Inject(USER_REPO) private users: IUserRepository) {}
  async signIn(username: string, password: string): Promise<AuthUser> { /* ... */ }
}

// auth.rpc-service.ts
@Service({ name: 'Auth' })
export class AuthRpcService {
  constructor(private auth: AuthService) {}

  @Public({ auth: { allowAnonymous: true } })
  async signIn(username: string, password: string): Promise<AuthResponseDto> {
    return this.auth.signIn(username, password);
  }
}

// auth.module.ts
@Module({ providers: [AuthService, AuthRpcService], exports: [AuthService] })
export class AuthModule {}
```
