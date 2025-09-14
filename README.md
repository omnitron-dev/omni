# Omnitron Monorepo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Turborepo](https://img.shields.io/badge/maintained%20with-turborepo-cc00ff.svg)](https://turbo.build/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3--5.9.2-blue)](https://www.typescriptlang.org/)
[![Yarn](https://img.shields.io/badge/yarn-4.9.2-2C8EBB)](https://yarnpkg.com/)
[![Bun](https://img.shields.io/badge/bun-compatible-f472b6)](https://bun.sh/)

A comprehensive TypeScript monorepo containing libraries for building distributed systems and data processing applications.

## 🎯 Vision

Omnitron provides a suite of production-ready TypeScript packages for building scalable, distributed applications with focus on:
- **Real-time Communication** - WebSocket-based RPC and event streaming
- **Data Processing** - Efficient serialization and buffer manipulation
- **Cross-Runtime Support** - Works with both Node.js and Bun
- **Developer Experience** - Type safety, great APIs, and comprehensive docs

## 📦 Packages

### Core Utilities

#### [@omnitron-dev/common](packages/common)
Essential utilities and helper functions for TypeScript/JavaScript projects.
- Promise utilities (defer, delay, retry, timeout)
- Object manipulation (omit, entries, keys, values)
- Type predicates and guards
- Data structures (ListBuffer, TimedMap)
- ✅ Bun compatible

#### [@omnitron-dev/eventemitter](packages/eventemitter)
Universal event emitter with both synchronous and asynchronous emission patterns.
- Standard EventEmitter API (on, off, emit, once)
- Parallel and sequential async event execution
- Reduce patterns for event accumulation
- Concurrency control with p-limit
- Promise-based event handling
- Works in Node.js, Bun, and browsers
- ✅ Bun compatible

#### [@omnitron-dev/smartbuffer](packages/smartbuffer)
Enhanced binary data manipulation based on ByteBuffer.js.
- Efficient buffer operations
- Support for various data types (int8-64, float, double, varint)
- Big-endian and little-endian support
- String encoding/decoding utilities
- ✅ Bun compatible

### Data Processing

#### [@omnitron-dev/messagepack](packages/messagepack)
High-performance MessagePack serialization with TypeScript support.
- Full MessagePack specification support
- Custom type extensions
- Efficient binary serialization
- Stream processing capabilities
- ✅ Bun compatible

### Distributed Systems

#### [@omnitron-dev/netron](packages/netron)
WebSocket-based distributed systems framework for building microservices.
- Type-safe RPC with decorators
- Event bus with multiple emission patterns
- Service discovery via Redis
- Automatic reconnection and versioning
- Streaming support for large data transfers
- ✅ Bun compatible with test coverage

#### [@omnitron-dev/netron-nest](packages/netron-nest)
NestJS integration for Netron framework.
- Seamless NestJS dependency injection
- Service decorators for easy exposure
- Module configuration
- Health checks and graceful shutdown

### Messaging & Notifications

#### [@omnitron-dev/rotif](packages/rotif)
Redis-based reliable notification and messaging system with guaranteed delivery.
- ✅ Exactly-once processing with deduplication
- 🔄 Configurable retry mechanisms with exponential backoff
- ⏲️ Delayed message delivery
- 💀 Dead Letter Queue (DLQ) for failed messages
- 📊 Built-in statistics and monitoring
- 🔧 Extensible middleware system
- 🚀 Consumer groups for horizontal scaling
- 🛡️ Full TypeScript support

#### [@omnitron-dev/rotif-nest](packages/rotif-nest)
NestJS integration for Rotif messaging system.
- 🎯 Seamless NestJS DI integration
- 🏷️ Decorator-based message handlers
- 💉 Automatic dependency injection
- 🏥 Health checks and monitoring
- 🛡️ Custom exception filters
- 📊 Built-in interceptors for logging and metrics
- 🔧 NestJS-style middleware support
- 🚀 Auto-discovery of decorated handlers

## 🚀 Getting Started

### Prerequisites

- Node.js >= 22 or Bun >= 1.0
- Yarn 4.9.2

### Installation

```bash
# Clone the repository
git clone https://github.com/omnitron-dev/omni.git
cd omni

# Install dependencies
yarn install

# Build all packages
yarn build
```

### Development Workflow

```bash
# Run in development mode
yarn dev

# Run tests
yarn test

# Lint and format code
yarn fix:all

# Create changeset for version management
yarn changeset

# Clean all node_modules
yarn cleanup
```

### Working with Packages

```bash
# Run commands for specific package
yarn workspace @omnitron-dev/netron test
yarn workspace @omnitron-dev/common build

# Add dependencies to specific package
yarn workspace @omnitron-dev/common add lodash

# Run package-specific scripts
yarn workspace @omnitron-dev/netron dev
```

## 🏗️ Architecture

### Monorepo Structure

```
omni/
├── packages/           # All published packages
│   ├── common/        # Shared utilities
│   ├── eventemitter/  # Event emitter
│   ├── smartbuffer/   # Binary data handling
│   ├── messagepack/   # Serialization
│   ├── netron/        # Distributed framework
│   ├── netron-nest/   # NestJS integration
│   ├── rotif/         # Redis messaging system
│   └── rotif-nest/    # NestJS integration for Rotif
├── scripts/           # Build and utility scripts
├── experiments/       # Experimental code and docs
├── .changeset/        # Version management
└── turbo.json        # Turborepo configuration
```

### Technology Stack

- **Language**: TypeScript 5.8.3 - 5.9.2 with strict mode
- **Runtime**: Node.js 22+ and Bun 1.0+
- **Build System**: Turborepo for monorepo orchestration
- **Package Manager**: Yarn 4.9.2 with workspaces
- **Testing**: Jest 30.x with ts-jest
- **Linting**: ESLint v9 with flat config
- **Formatting**: Prettier
- **Versioning**: Changesets

### Design Principles

1. **Type Safety First** - Full TypeScript with strict typing
2. **Zero/Minimal Dependencies** - Keep packages lightweight
3. **Performance Focused** - Optimized for production use
4. **Cross-Runtime Support** - Works with Node.js and Bun
5. **Developer Experience** - Clear APIs and comprehensive docs
6. **Modular Architecture** - Use only what you need

## 📚 Documentation

Each package contains detailed documentation:

- [Common Utilities Guide](packages/common/README.md)
- [Event Emitter Guide](packages/eventemitter/README.md)
- [SmartBuffer Guide](packages/smartbuffer/README.md)
- [MessagePack Guide](packages/messagepack/README.md)
- [Netron Framework Guide](packages/netron/README.md)
- [Netron-Nest Integration Guide](packages/netron-nest/README.md)
- [Rotif Messaging Guide](packages/rotif/README.md)
- [Rotif-Nest Integration Guide](packages/rotif-nest/README.md)

## 🔧 Common Use Cases

### Building a Microservice

```typescript
import { Netron, Service, Public } from '@omnitron-dev/netron';

@Service('users@1.0.0')
class UserService {
  @Public()
  async getUser(id: string) {
    return { id, name: 'John Doe' };
  }
}

const netron = await Netron.create({ listenPort: 8080 });
await netron.peer.exposeService(new UserService());
```

### Efficient Data Serialization

```typescript
import { encode, decode } from '@omnitron-dev/messagepack';

const data = { user: 'John', scores: [1, 2, 3] };
const encoded = encode(data); // Buffer
const decoded = decode(encoded); // Original data
```

### Advanced Event Handling

```typescript
import { EventEmitter } from '@omnitron-dev/eventemitter';

const emitter = new EventEmitter();

// Synchronous emission (standard EventEmitter)
emitter.emit('process', data);

// Sequential async processing
await emitter.emitSerial('process', data);

// Parallel async processing with optional concurrency
emitter.setConcurrency(5);
await emitter.emitParallel('process', data);

// Reduce pattern for aggregation
const result = await emitter.emitReduce('calculate', initialValue);
```

### Reliable Message Processing

```typescript
import { NotificationManager } from '@omnitron-dev/rotif';

const manager = new NotificationManager({
  redis: 'redis://localhost:6379',
  maxRetries: 3,
});

// Publish with guaranteed delivery
await manager.publish('order.created', { orderId: '123' });

// Subscribe with automatic retry
await manager.subscribe('order.*', async (msg) => {
  await processOrder(msg.payload);
  await msg.ack(); // Acknowledge on success
});
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using conventional commits
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Write tests for new features
- Follow existing code patterns
- Update documentation
- Add changeset for version bumps
- Ensure all tests pass

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [GitHub Repository](https://github.com/omnitron-dev/omni)
- [Issue Tracker](https://github.com/omnitron-dev/omni/issues)
- [Discussions](https://github.com/omnitron-dev/omni/discussions)

## 👥 Team

Created and maintained by the Omnitron team.

---

<div align="center">
  Built with ❤️ using TypeScript
</div>