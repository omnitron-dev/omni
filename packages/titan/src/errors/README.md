# Structured errors

`@omnitron-dev/titan/errors` provides `TitanError`, error codes, domain-specific classes, factories, and transport conversion. Use a stable code for programmatic handling and a message that explains the failed operation.

```ts
import { Errors, TitanError } from '@omnitron-dev/titan/errors';

try {
  throw Errors.notFound('Document', 'example');
} catch (error) {
  if (!(error instanceof TitanError)) throw error;
  console.log(error.code, error.message);
}
```

[Factories](factories.ts) include bad request, not found, conflict, authorization, validation, and internal errors. Choose the code that represents the failure; an expected conflict should not become a generic internal error.

| Source | Responsibility |
| --- | --- |
| [Core](core.ts), [codes](codes.ts) | Error representation and codes |
| [HTTP](http.ts), [Netron](netron.ts) | Protocol-specific error classes |
| [Validation](validation.ts) | Field and schema errors |
| [Contracts](contract.ts), [domain](domain.ts) | Declared and application-domain errors |
| [Transport](transport.ts), [utilities](utils.ts) | Serialization and normalization |

Treat error details as externally observable when returning them through a service. Keep credentials and private data out of messages and details.

The validation engine also exports its own `ValidationError` adapter. It is a different class from this module's `ValidationError`; use the [validation guide](../validation/README.md) when handling errors from that engine. See [public exports](index.ts) for the complete API.
