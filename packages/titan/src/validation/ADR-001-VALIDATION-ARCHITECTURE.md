# ADR 001: Validation as Independent Subsystem

**Date**: 2025-10-09
**Status**: Accepted
**Deciders**: Architecture Team
**Related**: Titan Framework Design, Netron Integration

---

## Status

**ACCEPTED** - The validation subsystem will remain at `src/validation/` as an independent, reusable component.

---

## Context

During the architectural review of the Titan framework, a question arose about the placement of the validation subsystem. The validation code currently resides at `src/validation/` as a peer to `src/netron/`, `src/modules/`, and other top-level subsystems.

### Current Architecture

```
packages/titan/src/
├── validation/              # Independent validation subsystem
│   ├── contract.ts          # Contract definition system
│   ├── validation-engine.ts # High-performance validation engine
│   ├── validation-middleware.ts # Method wrapping & service validation
│   └── index.ts             # Public exports
├── netron/                  # RPC framework
│   ├── transport/
│   │   └── http/
│   │       └── server.ts    # Uses validation for request/response
│   └── ...
├── decorators/              # Titan decorators
│   └── validation.ts        # Uses validation for metadata
├── modules/                 # Built-in modules
│   ├── events/              # Uses validation for event schemas
│   ├── config/              # Uses validation for config schemas
│   └── ...
└── ...
```

### Usage Analysis

After analyzing the codebase, we found that the validation subsystem is used by:

**60+ files across the Titan framework**, including:

**Netron Integration** (21 files):
- `src/netron/transport/http/server.ts` - Request/response validation (Primary consumer)
- `src/netron/local-peer.ts` - Contract metadata bridge
- `src/netron/netron.ts` - Service registration
- `src/netron/middleware/builtin.ts` - Validation middleware

**Non-Netron Integration** (39+ files):
- `src/decorators/validation.ts` - Decorator definitions (`@Contract`, `@Validate`)
- `src/modules/events/event-validation.service.ts` - Event payload validation
- `src/modules/config/config-validator.service.ts` - Configuration validation
- `src/errors/contract.ts` - Contract error types
- Various service implementations across the framework

### The Question

Should the validation subsystem be:
1. **Kept at `src/validation/`** (current location) - Independent subsystem
2. **Moved to `src/netron/middleware/validation/`** - Netron-specific component
3. **Duplicated** - Separate implementations for different use cases

---

## Decision

**We will keep the validation subsystem at `src/validation/` as an independent, reusable component.**

The validation subsystem will remain a top-level architectural concern, separate from Netron, with clear interfaces for integration across multiple Titan subsystems.

---

## Rationale

### 1. Cross-Cutting Concern

Validation is not a Netron-specific feature. It is a **cross-cutting concern** used by multiple subsystems:

- **Netron**: Runtime contract enforcement, OpenAPI generation
- **Decorators**: Compile-time metadata storage, developer experience
- **Events Module**: Event payload validation
- **Config Module**: Configuration schema validation
- **Application Layer**: Service-level validation

Moving validation to `src/netron/middleware/validation/` would imply it belongs exclusively to Netron, which is architecturally incorrect.

### 2. Separation of Concerns

**Validation Concerns** (Domain-level):
- Schema definition and compilation
- Type validation and coercion
- Error formatting and reporting
- Performance optimization (caching, lazy compilation)

**Netron Concerns** (Transport-level):
- Network communication
- Protocol handling (HTTP, WebSocket)
- Connection management
- Request/response serialization

These are fundamentally different layers. Validation deals with **domain logic** (what data is valid), while Netron deals with **transport logic** (how data moves between services).

### 3. Reusability

The validation engine is designed to be reusable across different contexts:

```typescript
// Used in Netron HTTP server
if (method.contract?.input) {
  const validation = method.contract.input.safeParse(message.input);
  if (!validation.success) {
    throw new TitanError({ code: ErrorCode.INVALID_ARGUMENT, message: 'Input validation failed' });
  }
}

// Used in Events module
@OnEvent('user.created')
async handleUserCreated(@ValidateEvent(UserEventSchema) event: UserCreatedEvent) {
  // Event already validated
}

// Used in Config module
@Injectable()
class ConfigValidator {
  validateConfig(config: unknown): Config {
    return this.engine.compile(ConfigSchema).validate(config);
  }
}

// Used directly in application code
const validator = new ValidationEngine();
const userValidator = validator.compile(UserSchema);
const user = userValidator.validate(input);
```

Moving validation into Netron would either:
- **Force circular dependencies** (Events/Config → Netron → Titan core)
- **Require duplication** (separate validation for each module)
- **Create artificial coupling** (non-Netron code depending on Netron)

### 4. Performance Optimization

The validation engine is optimized for high-performance scenarios:

- **Validator Caching**: Compiled validators are cached for reuse
- **Lazy Compilation**: Schemas compiled only when first used
- **Fast-path Execution**: Optimized paths for common cases
- **Memory Efficiency**: WeakMap for schema tracking

These optimizations benefit all consumers, not just Netron. Placing validation inside Netron would artificially limit these benefits to Netron use cases.

### 5. Independent Evolution

Validation and Netron have different evolution paths:

**Validation Evolution**:
- New schema types (JSON Schema, TypeBox, etc.)
- Advanced validation modes (async, streaming, batch)
- Performance improvements (JIT compilation, SIMD)
- Error format enhancements

**Netron Evolution**:
- New transports (gRPC, MQTT, QUIC)
- Protocol optimizations (compression, encryption)
- Advanced routing (load balancing, failover)
- Connection pooling and management

These can evolve independently without affecting each other, as long as the interface between them remains stable.

### 6. Testing and Maintainability

Independent validation allows:

**Isolated Testing**:
```typescript
// Test validation without Netron
describe('ValidationEngine', () => {
  it('should validate complex schemas', () => {
    const engine = new ValidationEngine();
    const validator = engine.compile(ComplexSchema);
    expect(validator.validate(validData)).toEqual(validData);
  });
});
```

**Modular Development**:
- Validation team focuses on schema validation
- Netron team focuses on network transport
- Clear interfaces prevent coupling

**Clear Ownership**:
- `src/validation/` - Validation team
- `src/netron/` - Netron team
- Integration points clearly defined

### 7. Architectural Clarity

The current structure clearly shows Titan's architecture:

```
Titan Framework
├── Core Utilities (common, errors, decorators)
├── Dependency Injection (nexus)
├── Validation Subsystem ← Independent concern
├── RPC Framework (netron) ← Uses validation
├── Built-in Modules (events, config, scheduler) ← Use validation
└── Application Layer ← Uses all above
```

This hierarchy shows that validation is a **foundational capability** used by higher-level components, not a feature of any specific component.

---

## Consequences

### Positive

1. **Architectural Clarity**: Clear separation between validation (domain) and transport (Netron)
2. **Reusability**: Validation can be used across all Titan subsystems without coupling
3. **Testability**: Validation can be tested independently of Netron
4. **Maintainability**: Changes to validation don't affect Netron, and vice versa
5. **Performance**: Optimizations benefit all consumers, not just Netron
6. **Flexibility**: New consumers can use validation without importing Netron
7. **Documentation**: Clear scope and purpose for each subsystem

### Negative

1. **Additional Import Path**: Developers must import from `@omnitron-dev/titan/validation` instead of `@omnitron-dev/titan/netron`
   - **Mitigation**: This is actually clearer and shows the architectural separation

2. **Potential Confusion**: New developers might wonder where validation belongs
   - **Mitigation**: This ADR and the integration guide clearly document the decision

### Neutral

1. **No Breaking Changes**: Keeping current location means no migration needed
2. **File Count**: Same number of files regardless of location
3. **Package Size**: Same bundle size regardless of location

---

## Alternatives Considered

### Alternative 1: Move to `src/netron/middleware/validation/`

**Structure**:
```
src/netron/
├── middleware/
│   └── validation/
│       ├── contract.ts
│       ├── validation-engine.ts
│       └── validation-middleware.ts
```

**Rejected because**:

1. **Incorrect Scope**: Implies validation is Netron-specific
2. **Circular Dependencies**: Events/Config would import from Netron
3. **Violates Separation of Concerns**: Mixes transport and domain logic
4. **Limits Reusability**: Non-Netron code shouldn't depend on Netron
5. **Breaking Changes**: 60+ files would need import updates
6. **Architectural Confusion**: Suggests validation is middleware, not a subsystem

**Estimated Impact**:
- 40+ hours of migration work
- High risk of breaking changes
- Requires full test suite validation
- Potential for subtle bugs

### Alternative 2: Duplicate Validation for Each Module

**Structure**:
```
src/netron/validation/ - For Netron use
src/events/validation/ - For Events use
src/config/validation/ - For Config use
```

**Rejected because**:

1. **Violates DRY**: Multiple implementations of same functionality
2. **Maintenance Burden**: Bug fixes must be applied to all copies
3. **Inconsistency Risk**: Implementations may diverge over time
4. **Increased Bundle Size**: Duplicated code in final bundle
5. **Testing Overhead**: Must test each implementation separately
6. **Performance Loss**: Can't share validator cache across modules

### Alternative 3: Create Separate Package `@omnitron-dev/validation`

**Structure**:
```
packages/
├── validation/  - Standalone validation package
└── titan/       - Imports from validation package
```

**Rejected because**:

1. **Over-Engineering**: Validation is tightly coupled to Titan's needs
2. **Version Management**: Additional package to version and publish
3. **Development Friction**: Changes require coordinating two packages
4. **No External Use**: Unlikely to be used outside Titan
5. **Circular Dependencies**: Would need Titan types (TitanError, etc.)

**However**, this could be reconsidered if:
- External demand emerges for standalone validation
- Validation grows significantly in scope
- Multiple frameworks want to use it

---

## Related Decisions

### Future ADRs

1. **ADR 002: Validation Performance Optimization** (Planned)
   - JIT compilation strategies
   - SIMD validation for arrays
   - WebAssembly validation kernels

2. **ADR 003: Schema Format Support** (Planned)
   - JSON Schema integration
   - TypeBox support
   - Custom schema DSL

3. **ADR 004: Validation Metrics and Observability** (Planned)
   - Prometheus metrics
   - OpenTelemetry integration
   - Performance profiling

### Related Documents

- [Integration Guide](./INTEGRATION.md) - How to use validation with Netron
- [Refactoring Plan](./REFACTORING-PLAN.md) - Detailed analysis and recommendations
- [Netron HTTP Server](../netron/transport/http/server.ts) - Primary integration point

---

## Implementation Notes

### Current Integration Points

**1. Netron HTTP Server** (`src/netron/transport/http/server.ts`):
```typescript
import type { MethodContract } from '../../../validation/contract.js';

// Lines 450-459: Input validation
if (method.contract?.input) {
  const validation = method.contract.input.safeParse(message.input);
  if (!validation.success) {
    throw new TitanError({ code: ErrorCode.INVALID_ARGUMENT });
  }
}

// Lines 909-917: Contract discovery endpoint
// Lines 1129-1213: OpenAPI schema generation
```

**2. Decorators** (`src/decorators/validation.ts`):
```typescript
import { Contract as ContractClass, MethodContract } from '../validation/contract.js';

export function Contract<T extends ContractClass>(contract: T): ClassDecorator {
  return function (target: any) {
    Reflect.defineMetadata('validation:contract', contract, target);
  };
}
```

**3. Local Peer** (`src/netron/local-peer.ts`):
```typescript
// Line 101-102: Extract and pass contract to transport
const contract = (meta as any).contract || (instance.constructor as any).contract;
(this.netron.transportServer as any).registerService(meta.name, def, contract);
```

### Recommended Enhancements

**Phase 1: Fix Immediate Issues** (Priority: HIGH)
- ✅ Fix test failure in `validation-decorators.spec.ts` (COMPLETED by linter)
- ⏳ Improve test coverage from 62.38% to 90%+

**Phase 2: Documentation Improvements** (Priority: MEDIUM)
- ✅ Create INTEGRATION.md guide (THIS DOCUMENT)
- ✅ Add ADR-001 (THIS DOCUMENT)

**Phase 3: Strategic Refactoring** (Priority: LOW)
- Add request context awareness to ValidationMiddleware
- Add contract migration utilities for versioning
- Add validation metrics for observability

---

## Verification and Testing

### Test Coverage Goals

**Current Coverage**: 62.38%
**Target Coverage**: 90%+

**Coverage Breakdown**:
- `contract.ts`: 37.03% → Target: 90%
- `validation-engine.ts`: 76.36% → Target: 95%
- `validation-middleware.ts`: 52.8% → Target: 90%

**Required Tests**:
1. Real-world integration tests with HTTP transport
2. Streaming validation with async generators
3. Error format customization
4. Performance benchmarks for validator caching
5. Multi-service batch validation

### Integration Tests

See [validation-netron-integration.spec.ts](../../test/validation/validation-netron-integration.spec.ts) for comprehensive integration tests covering:

- Basic HTTP RPC with validation
- Validation errors over HTTP
- Streaming with validation
- Contract metadata in HTTP
- Multiple services with different contracts
- Validation middleware integration
- Performance with real load

---

## Metrics and Success Criteria

### Architecture Metrics

- ✅ **Separation of Concerns**: Validation is independent of transport
- ✅ **Reusability**: Used by 60+ files across Titan
- ✅ **Testability**: Can be tested without Netron
- ✅ **Performance**: Validator caching works across all consumers

### Quality Metrics

- ⏳ **Test Coverage**: 62.38% → Target: 90%+ (In Progress)
- ✅ **Documentation**: Integration guide and ADR complete
- ⏳ **Performance**: Benchmarks to be added in Phase 3
- ✅ **Error Handling**: Validation errors properly formatted

### Developer Experience Metrics

- ✅ **API Clarity**: Decorators are simple and intuitive
- ✅ **Type Safety**: Full TypeScript support with Zod
- ✅ **Error Messages**: Detailed validation errors
- ✅ **Examples**: Real-world examples in integration guide

---

## Notes

### Why This Decision Matters

This decision establishes a critical architectural pattern for Titan:

**Cross-cutting concerns are independent subsystems**, not features of specific components.

This pattern should be applied to other concerns:
- **Logging**: Independent, used by all components
- **Metrics**: Independent, used by all components
- **Tracing**: Independent, used by all components
- **Caching**: Independent, used by all components

### Lessons Learned

1. **Architecture First**: Structure should reflect conceptual model
2. **Coupling is Costly**: Tight coupling limits reusability and evolution
3. **Test Coverage Matters**: Good tests prevent regressions during refactoring
4. **Documentation Pays Off**: Clear docs reduce confusion and questions

### Future Considerations

**If validation grows significantly**, consider:
1. Extracting to separate package (`@omnitron-dev/validation`)
2. Adding plugin system for custom validators
3. Supporting multiple schema formats (JSON Schema, TypeBox)
4. Adding JIT compilation for performance

**If Netron evolves**, ensure:
1. Validation interface remains stable
2. New transports can use validation consistently
3. Performance optimizations benefit all transports

---

## References

### Internal Documents

- [Refactoring Plan](./REFACTORING-PLAN.md) - Analysis that led to this decision
- [Integration Guide](./INTEGRATION.md) - How to use validation with Netron
- [Test Coverage Report](../../test/validation/) - Current test status

### External Resources

- [Zod Documentation](https://zod.dev/) - Schema validation library
- [OpenAPI Specification](https://swagger.io/specification/) - API documentation standard
- [Architectural Decision Records](https://adr.github.io/) - ADR format reference

### Code References

- `src/validation/contract.ts` (298 lines) - Contract definition system
- `src/validation/validation-engine.ts` (320 lines) - Validation engine
- `src/validation/validation-middleware.ts` (329 lines) - Method wrapping
- `src/netron/transport/http/server.ts` (1460 lines) - Primary integration
- `src/decorators/validation.ts` (281 lines) - Decorator definitions

---

**Document Version**: 1.0
**Last Updated**: 2025-10-09
**Next Review**: 2025-11-09 (or when significant changes are proposed)

**Approved By**: Architecture Team
**Status**: ACCEPTED ✅
