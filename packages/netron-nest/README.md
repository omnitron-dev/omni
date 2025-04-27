# Netron NestJS Integration

**Netron NestJS Integration** provides seamless integration between the **Netron** distributed framework and **NestJS**, making it easy to develop scalable, reliable, and fault-tolerant microservices.

## 📖 About the Project

Netron NestJS serves as a powerful alternative to built-in NestJS transports (e.g., gRPC, Kafka, Redis, RabbitMQ). It offers a declarative approach to microservice development with advanced Redis-based service discovery, automatic heartbeats, and fault tolerance.

---

## 🚀 Features

- 🚦 **Redis-based service discovery** with automatic heartbeats
- 📡 **RPC and Event Streams** for inter-service communication
- 🔧 **Declarative service definition and exposure**
- 🔄 **Seamless NestJS DI container integration**
- 💡 **Automatic service registration**
- 🔄 **Graceful shutdown** and robust error handling
- 🧪 **Comprehensive test coverage**

---

## 📦 Installation

```bash
npm install @devgrid/netron @devgrid/netron-nest
```

---

## 🎯 Usage Examples

### Creating a Microservice with Netron

```typescript
import { Module } from '@nestjs/common';
import { NetronModule } from '@devgrid/netron-nest';
import { AuthService } from './auth.service';

@Module({
  imports: [
    NetronModule.forRoot({
      listenHost: 'localhost',
      listenPort: 4000,
      discoveryEnabled: true,
      discoveryRedisUrl: 'redis://localhost:6379/0',
    }),
  ],
  providers: [AuthService],
})
export class AppModule {}
```

### Exposing Services with Decorators

```typescript
import { Injectable } from '@nestjs/common';
import { Service } from '@devgrid/netron-nest';

@Injectable()
@Service('auth@1.0.0')
export class AuthService {
  login(user: string, pass: string) {
    return user === 'admin' && pass === 'admin';
  }
}
```

### Invoking Remote Services

```typescript
import { Injectable } from '@nestjs/common';
import { InjectNetron, Netron } from '@devgrid/netron-nest';

@Injectable()
export class RemoteService {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async authenticate(user: string, pass: string): Promise<boolean> {
    const authService = await this.netron.getService('auth@1.0.0');
    return authService.login(user, pass);
  }
}
```

---

## 🔍 Comparison with NestJS Microservices (gRPC)

| Feature                            | NestJS (gRPC)                            | Netron NestJS                             |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------- |
| Transport                          | HTTP/2                                   | WebSocket                                 |
| Service Discovery                  | Not included (external solutions needed) | Built-in (Redis-based)                    |
| Automatic Service Registration     | No                                       | Yes                                       |
| Node Availability Detection        | Requires load balancing                  | Automatic (heartbeat, TTL)                |
| Graceful Shutdown                  | Limited                                  | Full support                              |
| Performance                        | High                                     | High                                      |
| Streaming and Event-driven Support | Limited streaming (HTTP/2)               | Full WebSocket-based streams              |
| Ease of Setup                      | Medium (requires proto files)            | High (declarative decorators)             |

### When to Choose Netron over gRPC?

- 📌 **If automatic service discovery and registration** are desired without additional middleware.
- 📌 **If ease of setup and development simplicity** are priorities, avoiding `.proto` files and complex tooling.
- 📌 **If robust automatic error handling** and node health checks (heartbeat) are essential.
- 📌 **If rich streaming capabilities and event-driven communication** over WebSocket are required.

---

## 🛠️ Redis-based Service Discovery

Netron leverages Redis for robust service discovery:

- Automatic node registration at startup.
- Heartbeat (TTL keys) for detecting node availability.
- Redis Pub/Sub for rapid event broadcasting.

---

## ✅ Comprehensive Test Coverage

Tests include:

- Unit and integration tests for all components.
- Error handling and Redis retry logic tests.
- Lifecycle management tests (startup, graceful shutdown).

Run tests with Jest:

```bash
npm run test
```

---

## 📌 Key Decorators and DI Tokens

- `@Service(name@version)` – Service exposure
- `@InjectNetron()` – Inject Netron instance
- `NETRON_OPTIONS`, `NETRON_INSTANCE` – DI tokens for NestJS integration

---

## 📚 Complete NestJS + Netron Microservice Example

### Server (Microservice):

```typescript
import { Module } from '@nestjs/common';
import { NetronModule } from '@devgrid/netron-nest';

@Module({
  imports: [
    NetronModule.forRoot({
      listenHost: 'localhost',
      listenPort: 5000,
      discoveryEnabled: true,
      discoveryRedisUrl: 'redis://localhost:6379/1',
    }),
  ],
})
export class UserServiceModule {}
```

### Service Implementation:

```typescript
import { Injectable } from '@nestjs/common';
import { Service } from '@devgrid/netron-nest';

@Injectable()
@Service('user.service@1.0.0')
export class UserService {
  getUser(id: string) {
    return { id, name: 'John Doe' };
  }
}
```

### Client (Another Microservice):

```typescript
import { Injectable } from '@nestjs/common';
import { InjectNetron, Netron } from '@devgrid/netron-nest';

@Injectable()
export class ClientService {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async fetchUser(id: string) {
    const userService = await this.netron.getService('user.service@1.0.0');
    return userService.getUser(id);
  }
}
```

---

## ⚖️ License

MIT © LuxQuant