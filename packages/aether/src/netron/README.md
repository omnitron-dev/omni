# Netron Browser Client

> High-performance HTTP & RPC client for browser applications connecting to Titan backend services

## Overview

This directory contains the **Netron Browser Client** - a complete port of Netron RPC framework adapted for browser environments. It provides WebSocket and HTTP transport with full TypeScript support.

## Features

- ✅ **WebSocket** - Full-duplex binary communication with MessagePack protocol
- ✅ **HTTP REST** - Standard REST API for simple use cases
- ✅ **Type Safety** - Full TypeScript support with generic interfaces
- ✅ **Auto-Reconnection** - Configurable automatic reconnection
- ✅ **Event Subscriptions** - Real-time event handling
- ✅ **Lightweight** - ~35 KB gzipped

## Quick Start

### WebSocket Client

```typescript
import { NetronClient } from '@omnitron-dev/aether/netron';

const client = new NetronClient({ url: 'ws://localhost:3000' });
await client.connect();

const service = await client.queryInterface<MyService>('MyService@1.0.0');
const result = await service.method();

await client.disconnect();
```

### HTTP Client

```typescript
import { HttpNetronClient } from '@omnitron-dev/aether/netron';

const client = new HttpNetronClient({ baseUrl: 'http://localhost:3000' });
await client.initialize();

const service = await client.queryInterface<MyService>('MyService@1.0.0');
const result = await service.method();
```

## Documentation

- **User Guide**: [docs/NETRON-CLIENT-GUIDE.md](../../docs/NETRON-CLIENT-GUIDE.md)
- **Migration Spec**: [docs/NETRON-BROWSER-ADAPTATION.md](../../docs/NETRON-BROWSER-ADAPTATION.md)

## License

MIT License
