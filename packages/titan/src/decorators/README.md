# Titan decorators

Import decorators from `@omnitron-dev/titan/decorators`. They declare dependency injection, lifecycle hooks, service exposure, and method contracts consumed by Titan and Netron.

```ts
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { createToken } from '@omnitron-dev/titan/nexus';

export const PREFIX = createToken<string>('example.prefix');

@Injectable()
export class Greeting {
  constructor(@Inject(PREFIX) private readonly prefix: string) {}

  greet(name: string) {
    return `${this.prefix}, ${name}`;
  }
}
```

Register the token's provider and the class in a module or container. A decorator does not create the application's dependency graph by itself.

| Source | Declarations |
| --- | --- |
| [Core](core.ts) | Modules, provider scopes, services, and public methods |
| [Injection](injection.ts) | Explicit tokens, optional dependencies, and injection helpers |
| [Lifecycle](lifecycle.ts) | Initialization, start, stop, and destruction hooks |
| [Validation](validation.ts) | Input/output contracts and validation options |
| [Factory](decorator-factory.ts) | Custom decorators and metadata composition |
| [Types](types.ts) | Public method options |

RPC exposure still passes through [Netron](../netron/README.md) and its configured authorization policy. Use [the validation guide](../validation/README.md) for runtime schemas; TypeScript types alone do not validate incoming data.

[The export list](index.ts) is the public surface. Configure decorator compilation as described in the [package README](../../README.md).
