# Application lifecycle

`@omnitron-dev/titan/application` owns module registration, provider initialization, application start, health, and shutdown. Use one application instance for the lifecycle of a process.

```ts
import { Application } from '@omnitron-dev/titan/application';

const app = await Application.create({
  name: 'example',
  registerCoreModules: false,
});

await app.start();
try {
  // Run work using the application's registered services.
} finally {
  await app.stop();
}
```

`Application.create(MainModule, options)` also accepts a root module. Register dependencies before starting, use `resolveAsync` for asynchronous providers, and await `stop` to complete lifecycle cleanup. `createApp` constructs an application; `startApp` constructs and starts one.

Modules can define lifecycle hooks and register cleanup through the application. Put teardown in those hooks or `registerCleanup`, so the normal shutdown path owns it.

| Source | Responsibility |
| --- | --- |
| [Application](application.ts) | Public lifecycle and service access |
| [Module helpers](simple.ts) | Functional module and service declarations |
| [Module registry](_internal/module-registry.ts) | Imports and dynamic modules |
| [Service exposure](_internal/service-exposer.ts) | Netron publication |
| [Shutdown coordinator](_internal/shutdown-coordinator.ts) | Ordered shutdown work |
| [Health aggregation](_internal/health-aggregator.ts) | Module health |

See [public exports](index.ts), [option types](../types.ts), [Nexus](../nexus/README.md), and the [package README](../../README.md). Internal helpers are implementation details, not additional application entry points.
