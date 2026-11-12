# @omnitron-dev/titan

Titan is Omni's backend framework. It combines application lifecycle, Nexus dependency injection and Netron RPC so services share one configuration, identity and shutdown path.

## Capabilities

- Modules, scoped providers, lifecycle hooks, configuration and structured logging.
- Netron services over HTTP, WebSocket, TCP and Unix sockets.
- Service and method authorization, validation utilities and invocation context.
- Optional modules for databases, Redis, notifications, scheduling and other application services.

## Quick start

```sh
pnpm add @omnitron-dev/titan
```

```ts
import { Application, Injectable, Module } from '@omnitron-dev/titan';

@Injectable()
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

@Module({ providers: [Calculator] })
class AppModule {}

const app = await Application.create(AppModule);
await app.start();
console.log(app.resolve(Calculator).add(2, 3));
await app.stop();
```

Use a TypeScript configuration with decorator support. `Application.create` registers and initializes providers; `start` enters the running lifecycle. Await `stop` to dispose owned services.

## Publishing services

Use `@Service` and `@Public` to describe the RPC surface, then expose the service through the application's Netron peer. Shared client contracts use `ServiceDescriptor` from `@omnitron-dev/netron-protocol`. Configure listeners and authentication in the host application.

Service and method transport restrictions intersect. Protected calls require a configured authentication provider and the declared permissions; a client-side TypeScript interface does not validate an untrusted payload. Keep validation and authorization at the server boundary.

Logger destinations may be asynchronous. Await their flush during shutdown; network delivery and an application's own buffered output are not durable merely because a logging call returned.

## Documentation

[Public API](src/index.ts) · [Netron implementation](src/netron) · [Package exports](package.json) · [Omni package guide](../../README.md)

## License

[MIT](../../LICENSE).
