---
module: cross-cutting
title: "SOLID Principles Adapted for Titan"
tags: [solid, architecture, di, patterns, philosophy]
summary: "How SOLID principles are adapted and applied within Titan framework conventions"
---

## SOLID in Titan Context

### Single Responsibility
- **Service layer**: `{module}.service.ts` — pure domain logic, no transport concerns
- **RPC layer**: `{module}.rpc-service.ts` — Netron exposure, auth decorators, input validation
- **Module layer**: `{module}.module.ts` — DI wiring, no business logic

### Open/Closed
- Titan modules extend behavior through DI providers, not by modifying framework code
- `@Module({ providers: [...] })` — add new functionality by registering providers
- Middleware chains (Netron HTTP, validation) are composable without touching internals

### Liskov Substitution
- All RPC services implement typed interfaces (e.g., `IAuthService`)
- Backend apps export interfaces + DTOs: `@omnitron-dev/main/dto/services`
- Frontend uses same interfaces for type-safe RPC: `authRpc<M extends keyof IAuthService>(method, ...args)`

### Interface Segregation
- Package exports are granular: `@omnitron-dev/titan/netron`, `@omnitron-dev/titan/nexus`
- Each module exposes only what consumers need via package.json exports
- Never import from root when a sub-path export exists (breaks tree-shaking)

### Dependency Inversion
- **Always depend on tokens, never on concrete classes**
- `@Inject(AUTH_TOKEN)` not `@Inject(AuthService)`
- All DI tokens use `Symbol.for('titan:...')` to avoid dual-package hazard
- Modules declare what they provide and what they need — container resolves
