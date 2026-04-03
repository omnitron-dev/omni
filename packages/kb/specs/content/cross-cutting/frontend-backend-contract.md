---
module: cross-cutting
title: "Frontend-Backend Contract"
tags: [frontend, backend, rpc, dto, contract, type-safety]
summary: "How frontend and backend share types and communicate: DTO exports, typed RPC, service interfaces"
---

# Frontend-Backend Contract

## Architecture

```
Backend (apps/main/)              Frontend (apps/portal/)
  │                                     │
  ├── IAuthService interface            ├── import type { IAuthService }
  ├── AuthResponseDto                   │     from '@omnitron-dev/main/dto/services'
  ├── CreateUserDto                     │
  │                                     ├── authRpc<'signIn'>('signIn', user, pass)
  └── package.json exports:             │     → type-safe call via Netron
      "./dto/services"                  │
                                        └── Response typed as AuthResponseDto
```

## Backend: Export Interfaces + DTOs

### Step 1: Define service interface
```typescript
// apps/main/src/modules/auth/auth.types.ts
export interface IAuthService {
  signIn(username: string, password: string): Promise<AuthResponseDto>;
  signUp(dto: CreateUserDto): Promise<AuthResponseDto>;
  signOut(sessionId: string): Promise<void>;
  refreshSession(): Promise<SessionDto>;
  getProfile(): Promise<UserProfileDto>;
}
```

### Step 2: Re-export from shared/dto
```typescript
// apps/main/src/shared/dto/services.ts
export type { IAuthService } from '../../modules/auth/auth.types.js';
export type { IUsersService } from '../../modules/users/users.types.js';
export type {
  AuthResponseDto,
  CreateUserDto,
  UserProfileDto,
  SessionDto,
} from '../../modules/auth/auth.types.js';
```

### Step 3: Expose via package.json exports
```json
{
  "exports": {
    "./dto/services": {
      "types": "./src/shared/dto/services.ts",
      "default": "./dist/shared/dto/services.js"
    }
  }
}
```

## Frontend: Typed RPC Calls

### Pattern 1: Imperative (Zustand stores)
```typescript
// apps/portal/src/auth/api.ts
import type { IAuthService } from '@omnitron-dev/main/dto/services';

export const authRpc = <M extends keyof IAuthService>(
  method: M,
  ...args: Parameters<IAuthService[M]>
): Promise<ReturnType<IAuthService[M]>> => {
  return rpcClient.call('Auth', method, ...args);
};

// Usage in store
const response = await authRpc('signIn', username, password);
// response is typed as AuthResponseDto
```

### Pattern 2: Declarative (React hooks via Prism)
```typescript
import { useBackendService } from '@omnitron-dev/prism/netron';

function UserProfile() {
  const { data, loading, error } = useBackendService('Auth', 'getProfile');
  // data is typed based on IAuthService.getProfile return type
}
```

## Multi-Backend Routing

Frontend connects to multiple backends through a single client:

```typescript
// apps/portal/src/netron/client.ts
import { createMultiBackendClient } from '@omnitron-dev/prism/netron';

export const client = createMultiBackendClient<{
  main: IAuthService & IUsersService;
  storage: IStorageService;
  messaging: IMessagingService;
}>({
  backends: {
    main: { url: '/api/main', transport: 'http' },
    storage: { url: '/api/storage', transport: 'http' },
    messaging: { url: '/ws/messaging', transport: 'websocket' },
  },
});
```

## DTO Rules

1. **Never expose internal fields** (passwordHash, internalFlags)
2. **Dates as ISO strings** in DTOs, not Date objects (serialization-safe)
3. **Separate input and output DTOs** (CreateUserDto ≠ UserDto)
4. **Use `readonly` on DTO fields** for immutability
5. **All DTOs are plain objects** — no class instances, no methods

## Rules for AI Agents

When implementing a new backend feature:
1. Define the service interface FIRST (contract-first)
2. Implement the service
3. Export DTOs via `shared/dto/services.ts`
4. Frontend can immediately start using the typed RPC
5. Never use `fetch()` on the frontend — always Netron RPC through Prism
