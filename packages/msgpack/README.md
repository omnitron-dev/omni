# @omnitron-dev/msgpack

> Extensible MessagePack serializer with custom type support and streaming

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/msgpack
```

## Overview

High-performance MessagePack implementation for Node.js. Compliant with the MessagePack spec, with built-in support for JavaScript-native types (Date, Map, Set, RegExp, BigInt, Error) and a custom type extension system. Used as the default wire format for Netron RPC.

### Key Features

- **Full spec compliance** — all MessagePack types
- **Native JS types** — Date, Map, Set, RegExp, BigInt, Error serialization out of the box
- **Custom extensions** — `serializer.register(typeId, constructor, encoder, decoder)`
- **Streaming** — incremental decode via `tryDecode` for handling partial buffers
- **Error preservation** — stack traces and custom properties survive round-trips

## Quick Start

```typescript
import { encode, decode } from '@omnitron-dev/msgpack';

const buf = encode({ name: 'John', joined: new Date() });
const obj = decode(buf); // Date instance preserved
```

## License

MIT
