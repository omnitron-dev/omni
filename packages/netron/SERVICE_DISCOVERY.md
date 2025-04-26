# 📡 Netron Service Discovery

**Netron Service Discovery** is a reliable, scalable, and high-performance service discovery and registration system based on Redis. It enables dynamic node and service registration, tracks their availability through a heartbeat mechanism, and supports automatic removal of inactive nodes.

---

## 🛠️ Key Features

- **Node Registration and Updates**  
  Nodes automatically publish their availability (heartbeat) at specified intervals.

- **Automatic Inactive Node Removal**  
  If a node stops sending heartbeats, it is automatically removed from the system after TTL expiration.

- **Service Discovery**  
  Nodes can discover each other by querying the list of active services by name and version.

- **Flexible Configuration**  
  Support for options to manage intervals, heartbeat TTL, and Pub/Sub mechanism.

- **Redis Pub/Sub for Event-driven Updates**  
  Capability for asynchronous subscription to node registration, update, and removal events.

- **Robust Error Handling and Retry Logic**  
  Built-in error handling with retry mechanisms.

---

## 🔧 Installation and Configuration

### 1. Installing Dependencies

```bash
npm install ioredis @types/ioredis
```

### 2. Creating an Instance

```typescript
import Redis from 'ioredis';
import { ServiceDiscovery } from './service-discovery';

const redis = new Redis('redis://localhost:6379/0');

const discovery = new ServiceDiscovery(redis, 'node-1', '127.0.0.1:3000', [
  { name: 'auth-service', version: '1.0.0' },
]);
```

---

## 🚀 Starting and Stopping Heartbeat

### Starting Heartbeat

```typescript
discovery.startHeartbeat();
```

### Stopping Heartbeat and Graceful Shutdown

```typescript
await discovery.shutdown();
```

---

## 🔍 Finding Nodes by Service

```typescript
// Get all nodes providing 'auth-service'
const nodes = await discovery.findNodesByService('auth-service');

// Find nodes providing 'auth-service' version '1.0.0'
const specificNodes = await discovery.findNodesByService('auth-service', '1.0.0');

console.log(nodes, specificNodes);
```

---

## 🔄 Updating Service Information and Node Address

### Updating Services

```typescript
await discovery.updateServices([
  { name: 'new-service', version: '2.0.0' },
  { name: 'another-service', version: '1.0.0' },
]);
```

### Updating Node Address

```typescript
await discovery.updateAddress('192.168.1.100:4000');
```

---

## 📢 Event-driven Updates (Redis Pub/Sub)

The Pub/Sub mechanism allows other system components to immediately react to changes in node and service states.

### Subscribing to Events

```typescript
const discoveryWithEvents = new ServiceDiscovery(redis, 'node-1', '127.0.0.1:3000', [
  { name: 'auth-service', version: '1.0.0' },
], {
  pubSubEnabled: true, // Enable Pub/Sub
});

// Subscribe to events
await discoveryWithEvents.subscribeToEvents((event) => {
  console.log('🔥 Service Discovery Event:', event);

  switch (event.type) {
    case 'NODE_REGISTERED':
      console.log(`✅ Node registered: ${event.nodeId}`);
      break;
    case 'NODE_UPDATED':
      console.log(`🔄 Node updated: ${event.nodeId}`);
      break;
    case 'NODE_DEREGISTERED':
      console.log(`❌ Node removed: ${event.nodeId}`);
      break;
  }
});

discoveryWithEvents.startHeartbeat();
```

---

## ⚙️ DiscoveryOptions Configuration

```typescript
{
  heartbeatInterval?: number;    // Heartbeat sending interval (default: 5000ms)
  heartbeatTTL?: number;         // Heartbeat key TTL (default: 15000ms)
  pubSubEnabled?: boolean;       // Enable/disable Pub/Sub events (default: false)
  pubSubChannel?: string;        // Redis channel for Pub/Sub (default: 'netron:discovery:events')
}
```

---

## ✅ Example Configuration with Custom Options

```typescript
const customDiscovery = new ServiceDiscovery(redis, 'node-custom', '10.0.0.2:8000', [
  { name: 'payment-service', version: '1.2.3' },
], {
  heartbeatInterval: 2000,
  heartbeatTTL: 6000,
  pubSubEnabled: true,
  pubSubChannel: 'custom:discovery:channel',
});

customDiscovery.startHeartbeat();
```

---

## 🚧 Error Handling and Retry Logic

Built-in retry mechanism ensures operation retries in case of errors (e.g., temporary Redis unavailability):

- **Heartbeat Registration:** 3 attempts with exponential backoff (500ms, 1000ms, 1500ms).
- **Node Deregistration:** Similar retry mechanism.

---

## 🧪 Complete Working Example

```typescript
import Redis from 'ioredis';
import { ServiceDiscovery } from './service-discovery';

(async () => {
  const redis = new Redis('redis://localhost:6379/0');

  const discovery = new ServiceDiscovery(redis, 'node-full-example', '127.0.0.1:9000', [
    { name: 'full-example-service', version: '3.0.0' },
  ], {
    pubSubEnabled: true,
  });

  await discovery.subscribeToEvents((event) => {
    console.log(`🚨 Event: ${event.type} - Node: ${event.nodeId}`);
  });

  discovery.startHeartbeat();

  setTimeout(async () => {
    console.log('🔍 Active nodes:', await discovery.getActiveNodes());
  }, 3000);

  // Graceful shutdown after 10 seconds
  setTimeout(async () => {
    await discovery.shutdown();
    redis.disconnect();
    console.log('🛑 Node stopped');
  }, 10000);
})();
```

---

## 📖 Useful Tips and Best Practices

- Use a separate Redis database or namespace for discovery to avoid conflicts.
- Always use `await discovery.shutdown()` before application shutdown for proper resource cleanup.
- In production environments, configure heartbeat interval and TTL based on your service availability requirements and Redis load.

---

## 📈 Potential Future Improvements

- Support for ACL and node authorization.
- Integration with external monitoring and metrics (Prometheus, Grafana).
- Support for Kubernetes integration and readiness/liveness probes.
