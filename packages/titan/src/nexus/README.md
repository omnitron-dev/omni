# Nexus dependency injection

`@omnitron-dev/titan/nexus` supplies typed tokens, providers, scopes, modules, and container lifecycle. Titan applications own a container; use their registration and resolution APIs when working inside an application.

A standalone container must be disposed by its caller:

```ts
import { createContainer, createToken } from '@omnitron-dev/titan/nexus';

const GREETING = createToken<string>('example.greeting');
const container = createContainer();
container.register(GREETING, { useValue: 'Hello' });

try {
  const greeting = await container.resolveAsync(GREETING);
  console.log(greeting);
} finally {
  await container.dispose();
}
```

Use `resolveAsync` for asynchronous factories and dependency graphs. Keep tokens shared between provider registration and injection. Module imports and exports define which providers are visible; registering an implementation is distinct from exposing it through a module.

| Source | Responsibility |
| --- | --- |
| [Container](container.ts) | Registration, resolution, and disposal |
| [Tokens](token.ts) | Typed provider identities |
| [Provider helpers](provider-utils.ts) | Value, class, and factory declarations |
| [Modules](module.ts) | Module contracts |
| [Context](context.ts), [lifecycle](lifecycle.ts) | Resolution scope and lifecycle |
| [Dependency graph](dependency-graph.ts) | Dependency inspection |
| [Errors](errors.ts) | Resolution and registration failures |

See [public exports](index.ts), [application lifecycle](../application/README.md), and [DI integration tests](../../test/integration/nexus/).
