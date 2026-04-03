---
module: titan-discovery
title: "Service Discovery Module"
tags: [discovery, redis, service-registry, health]
summary: "Redis-backed service discovery: registration, heartbeat, lookup, Netron integration"
depends_on: [titan/nexus, titan-redis]
---

## How It Works

1. Services register on startup with name, version, host, port, metadata
2. Redis stores registrations with TTL (heartbeat-based)
3. Consumers lookup services by name → get healthy endpoints
4. NetronDiscoveryIntegration auto-registers Netron services

## Key Types
```typescript
interface NodeInfo {
  id: string;
  host: string;
  port: number;
  metadata: Record<string, unknown>;
}

interface ServiceInfo {
  name: string;
  version: string;
  nodes: NodeInfo[];
}
```

## Lua Scripts
Redis Lua scripts ensure atomic registration and health check operations.
