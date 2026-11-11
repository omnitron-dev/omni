# @omnitron-dev/titan

> Enterprise backend framework — DI, Netron RPC, decorators, and validation

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan
```

## Overview

Titan is the core backend framework of the Omni stack. It provides a modular architecture built on dependency injection, with first-class support for Netron RPC services, decorator-based configuration, and runtime validation.

### Key Features

- **Modular architecture** — `@Module`, `@Injectable`, provider scoping
- **Netron RPC** — `@Service`, `@Public` decorators for exposing typed RPC endpoints
- **Dependency injection** — Nexus IoC container with constructor/property injection
- **Configuration** — `@ConfigValue` decorator, typed config objects
- **Event system** — `@EventHandler` decorator, programmatic subscriptions
- **Lifecycle hooks** — `OnInit`, `OnDestroy`, `OnModuleInit` interfaces
- **Logging** — Structured pino-based logging with multistream destinations
- **Authentication** — `AuthConfig`, `PolicyEngine`, method-level authorization via `@Public`

## Quick Start

```typescript
import { Application, Module, Injectable, Service, Public } from '@omnitron-dev/titan';

@Injectable()
@Service({ name: 'Calculator' })
class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }
}

@Module({
  providers: [CalculatorService],
})
class AppModule {}

const app = await Application.create({ modules: [AppModule] });
```

## Titan Modules

Titan's functionality is extended through official modules:

| Module | Package | Description |
|--------|---------|-------------|
| Auth | `@omnitron-dev/titan-auth` | JWT authentication |
| Cache | `@omnitron-dev/titan-cache` | Multi-tier caching |
| Database | `@omnitron-dev/titan-database` | Kysely ORM, migrations, RLS |
| Discovery | `@omnitron-dev/titan-discovery` | Service discovery |
| Events | `@omnitron-dev/titan-events` | Event bus |
| Health | `@omnitron-dev/titan-health` | Health checks |
| Lock | `@omnitron-dev/titan-lock` | Distributed locks |
| Metrics | `@omnitron-dev/titan-metrics` | Counters, gauges, histograms |
| Notifications | `@omnitron-dev/titan-notifications` | Multi-channel delivery |
| PM | `@omnitron-dev/titan-pm` | Process management |
| Rate Limit | `@omnitron-dev/titan-ratelimit` | Rate limiting |
| Redis | `@omnitron-dev/titan-redis` | Redis connections |
| Scheduler | `@omnitron-dev/titan-scheduler` | Job scheduling |
| Telemetry | `@omnitron-dev/titan-telemetry-relay` | Telemetry pipeline |

## Log delivery

Custom logger destinations are asynchronous by default. `await loggerModule.flush()`
waits for queued destination writes and transport writes before flushing transports;
call it during graceful shutdown. A synchronous local journal can opt in with
`destinations: [{ stream: journal, delivery: 'sync' }]`. This invokes the sink before
returning from the logging call, at the cost of that sink's write latency. The sink
is responsible for durable storage; asynchronous network delivery is not a commit.
An abrupt termination can still discard output buffered inside an application before
it reaches its destination.

## License

MIT

### Service identity and transport authorization

HTTP and persistent Netron transports select the same published service. An exact
unversioned publication wins for `Service` or `Service@*`; otherwise the highest
semantic version is selected. `Service@1.0.0` always selects that exact publication.
Registration order does not change this rule, and removing one publication leaves
other versions available. HTTP OpenAPI paths identify the actual publications.

Every invocation applies registered ACLs, then `@Public({ auth })`, then optional
`authDefaultDeny`. This applies equally to individual HTTP calls, HTTP batches and
persistent transports. A declared protected method refuses anonymous calls even
when no authentication manager is configured; ordinary public methods remain open
unless default-deny is enabled. Missing policy engines refuse declared policies.
The resolved service identity is used for ACL and policy checks, so an unqualified
request cannot bypass the selected version's permissions.

## Transport boundaries

`@Service({ transports: [new HttpTransport()] })` restricts the entire service.
`@Public({ transports: ['http'] })` restricts one method or property. The effective
remote surface is their intersection; a member cannot widen its service. Missing
`transports` means unrestricted, while `[]` explicitly denies every remote
transport. Invalid declarations fail during publication. `ws` is the documented
alias for `websocket`; custom transport implementation names are supported.

Netron obtains the actual ingress from the transport factory, including callbacks
on outgoing connections. HTTP headers and request context cannot override it.
HTTP single calls, both batch modes, and persistent CALL/GET/SET enforce the same
boundary before executing a member. Transport restrictions do not replace roles,
permissions, session validation, or domain authorization.

Discovery, HTTP OpenAPI and nested interfaces present the corresponding restricted
surface. Published definitions retain optional transport restrictions when they
are forwarded through another server; old definitions without these fields remain
unrestricted. Direct calls by a known service name or definition ID still enforce
the boundary. Trusted in-process `LocalPeer` calls are local operations, not remote
requests. HTTP custom routes need their own endpoint authorization; HTTP does not
currently provide an SSE invocation endpoint.

Forwarding an `Interface` through a gateway is an explicit delegation boundary.
Register a gateway `AuthorizationManager` ACL for the forwarded service or method;
Netron evaluates it against the actual incoming caller. Without a matching ACL
there is no remote forwarding grant, even when the upstream connection holds
privileged credentials or HTTP authentication has an exemption. The upstream
service still applies its own guards. Definitions carry transport restrictions,
not the publisher's executable authorization policy; trusted local proxy calls
continue to use the existing local contract.


## Identity inside an RPC method

Use `getCurrentInvocationContext()` from `@omnitron-dev/titan/netron` to read
Netron's admitted caller. It works on HTTP (including batches) and persistent
transports such as WebSocket, TCP and Unix. It requires no application wrapper.
The context contains the service, method, transport, optional request/peer IDs,
and verified `auth`. Outside a network invocation it is `undefined`; an
anonymous invocation has no `auth`. RPC arguments and tracing hints cannot
supply an authenticated identity.

```ts
import { Public, Service, getCurrentInvocationContext } from '@omnitron-dev/titan/netron';

@Service('Documents@1.0.0')
class Documents {
  @Public({ auth: { permissions: ['documents.write'] } })
  async save(id: string, content: string) {
    const actor = getCurrentInvocationContext()!.auth!.userId;
    return { id, content, actor };
  }
}
```

Method authorization runs before dispatch. The admitted role, permission and
scope arrays are immutable snapshots; parallel logins or adapter updates cannot
replace them mid-call. The next invocation undergoes normal authentication and
revocation checks. Async work and streamed results retain the originating frame.
Do not store the caller on a shared service instance or accept a `session` DTO as
authentication. `invocationWrapper` remains an extension point for application
contexts such as RLS; it is not required to obtain Netron identity. HTTP token
issuance and cookie reading share this invocation storage, and lazy HTTP results
are consumed before leaving the application wrapper.
