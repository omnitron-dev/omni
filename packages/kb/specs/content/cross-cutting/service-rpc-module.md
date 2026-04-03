---
module: cross-cutting
title: "Service → RPC Service → Module Pattern"
tags: [pattern, service, rpc, module, architecture]
summary: "The canonical three-file pattern for every Titan backend feature"
---

## The Pattern

Every backend feature follows a strict three-file structure:

### 1. `{feature}.service.ts` — Domain Logic
```typescript
@Injectable({ scope: Scope.Singleton })
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(JWT_SERVICE) private jwt: JWTService,
  ) {}

  async validateCredentials(username: string, password: string): Promise<AuthUser> {
    // Pure business logic — no HTTP, no RPC, no auth decorators
  }
}
```

### 2. `{feature}.rpc-service.ts` — Netron RPC Exposure
```typescript
@Service({ name: 'Auth' })
export class AuthRpcService {
  constructor(private authService: AuthService) {}

  @Public({ auth: { allowAnonymous: true } })
  async signIn(username: string, password: string): Promise<AuthResponseDto> {
    // Delegates to service, adds auth + validation + DTO mapping
    return this.authService.validateCredentials(username, password);
  }

  @Public({ auth: { roles: ['admin'] } })
  async listUsers(pagination: PaginationDto): Promise<UserListDto> {
    return this.authService.listUsers(pagination);
  }
}
```

### 3. `{feature}.module.ts` — DI Wiring
```typescript
@Module({
  providers: [AuthService, AuthRpcService, UserRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

## Key Rules
- Service names WITHOUT version suffixes: `@Service({ name: 'Auth' })`, NOT `'Auth@1.0.0'`
- Every RPC method MUST have `@Public({ auth: { ... } })` — explicit authorization
- Domain service is testable in isolation (inject mocks via DI)
- RPC service is the only place for `@Public`, `@RateLimit`, `@Cache` decorators
