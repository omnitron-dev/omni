# Runtime validation

`@omnitron-dev/titan/validation` provides Zod-backed validators, method contracts, and service wrappers. TypeScript types describe callers; runtime schemas check values arriving from other processes or untrusted inputs.

```ts
import { ValidationEngine, z } from '@omnitron-dev/titan/validation';

const engine = new ValidationEngine();
const validator = engine.compile(z.object({ name: z.string().min(1) }));
const value = validator.validate({ name: 'Ada' });
```

A compiled validator provides synchronous `validate`, asynchronous `validateAsync`, and the `is` type guard. Use asynchronous validation for schemas with asynchronous refinements.

[Contracts](contract.ts) describe method input, output, errors, and optional HTTP metadata. [ValidationMiddleware](validation-middleware.ts) applies a contract to methods or services; [validation decorators](../decorators/validation.ts) attach that behavior declaratively.

The engine's `ValidationError` is an adapter distinct from `ValidationError` in `@omnitron-dev/titan/errors`. Import the class actually thrown at a catch site, use its `toCanonical()` conversion where needed, or inspect the structured code at a transport boundary.

The current `cacheValidators` and `lazyCompilation` option fields do not control engine behavior. Do not rely on them to disable caching or change compilation timing.

See [the implementation](validation-engine.ts), [public exports](index.ts), and [validation tests](../../test/validation/) for supported behavior and edge cases.
