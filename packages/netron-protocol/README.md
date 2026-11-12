# @omnitron-dev/netron-protocol

The wire contract shared by Titan's Netron implementation and browser clients. It contains transport-independent definitions and codecs without starting a server or connecting to one.

## Capabilities

- Packet types, operation constants, correlation IDs and UUID generation.
- Service descriptors, published definitions and references.
- Shared error codes, serialized errors and HTTP error decoding.

## Quick start

```sh
pnpm add @omnitron-dev/netron-protocol
```

```ts
import { ServiceDescriptor } from '@omnitron-dev/netron-protocol';

export interface Catalog {
  read(id: string): Promise<{ title: string }>;
}
export const CatalogService = ServiceDescriptor.of<Catalog>('Catalog', '1.0.0');
```

Keep the interface and descriptor in an application contract module shared by client and server. Titan's `@Service(CatalogService)`, browser invocation and React's `useService(CatalogService)` use the same qualified service identity.

The concrete stream implementations and transport-specific serializer registrations remain with their runtimes. Error handling should branch on codes and structured details, not message text.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
