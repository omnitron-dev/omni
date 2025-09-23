# Omnitron Monorepo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Turborepo](https://img.shields.io/badge/maintained%20with-turborepo-cc00ff.svg)](https://turbo.build/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.2-f472b6)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3--5.9.2-blue)](https://www.typescriptlang.org/)
[![Yarn](https://img.shields.io/badge/yarn-4.9.2-2C8EBB)](https://yarnpkg.com/)

A comprehensive TypeScript monorepo containing libraries for building distributed systems and data processing applications with full support for both Node.js and Bun runtimes.

## 🎯 Vision

Omnitron provides a suite of production-ready TypeScript packages for building scalable, distributed applications with focus on:
- **Cross-Runtime Support** - First-class support for both Node.js 22+ and Bun 1.2+
- **Enterprise Framework** - Titan provides integrated DI, WebSocket RPC, and module system
- **Real-time Communication** - Built-in WebSocket-based RPC and event streaming
- **Data Processing** - Efficient serialization and buffer manipulation
- **Developer Experience** - Type safety, decorator-based APIs, and comprehensive docs

## 🚀 Runtime Support

All packages are designed and tested to work seamlessly with:
- **Node.js** >= 22.0.0 (primary runtime)
- **Bun** >= 1.2.0 (fully supported with dedicated tests)
- **Deno** (experimental support in select packages)

## 📦 Packages

### Enterprise Framework

#### [@omnitron-dev/titan](packages/titan)
Enterprise backend framework with integrated dependency injection and distributed systems support.
- **Integrated Nexus DI** - Full dependency injection container
- **Integrated Netron** - WebSocket RPC framework
- **Built-in Modules** - Config, Events, Scheduler, Redis, Logger
- **Application Lifecycle** - Graceful startup/shutdown, state management
- **Decorator-based API** - Clean, declarative syntax
- ✅ Node.js 22+ compatible
- ✅ Bun 1.2+ compatible
- 🚧 Deno support (experimental)

### Core Utilities

#### [@omnitron-dev/common](packages/common)
Essential utilities and helper functions for TypeScript/JavaScript projects.
- Promise utilities (defer, delay, retry, timeout)
- Object manipulation (omit, entries, keys, values)
- Type predicates and guards
- Data structures (ListBuffer, TimedMap)
- ✅ Node.js & Bun compatible

#### [@omnitron-dev/eventemitter](packages/eventemitter)
Universal event emitter with both synchronous and asynchronous emission patterns.
- Standard EventEmitter API (on, off, emit, once)
- Parallel and sequential async event execution
- Reduce patterns for event accumulation
- Concurrency control with p-limit
- Promise-based event handling
- ✅ Works in Node.js, Bun, and browsers

#### [@omnitron-dev/cuid](packages/cuid)
Collision-resistant unique identifiers generator.
- Secure random ID generation
- Timestamp-based ordering
- URL-safe characters
- ✅ Node.js & Bun compatible

### Data Processing

#### [@omnitron-dev/smartbuffer](packages/smartbuffer)
Enhanced binary data manipulation based on ByteBuffer.js.
- Efficient buffer operations
- Support for various data types (int8-64, float, double, varint)
- Big-endian and little-endian support
- String encoding/decoding utilities
- ✅ Node.js & Bun compatible

#### [@omnitron-dev/messagepack](packages/messagepack)
High-performance MessagePack serialization with TypeScript support.
- Full MessagePack specification support
- Custom type extensions
- Efficient binary serialization
- Stream processing capabilities
- ✅ Node.js & Bun compatible

### Messaging & Notifications

#### [@omnitron-dev/rotif](packages/rotif)
Redis-based reliable notification and messaging system with guaranteed delivery.
- ✅ Exactly-once processing with deduplication
- 🔄 Configurable retry mechanisms with exponential backoff
- ⏲️ Delayed message delivery and scheduling
- 💀 Dead Letter Queue (DLQ) for failed messages
- 📊 Built-in statistics and monitoring
- 🔧 Extensible middleware system
- 🚀 Consumer groups for horizontal scaling

### Development Tools

#### [@omnitron-dev/testing](packages/testing)
Testing utilities and helpers for all Omnitron packages.
- Mock factories
- Test fixtures
- Async test utilities
- Container testing helpers
- Redis test utilities

#### [@omnitron-dev/titan-module-template](packages/titan-module-template)
Template for creating Titan framework modules.
- Boilerplate for new modules
- Example implementations
- Best practices guide

## 🚀 Getting Started

### Prerequisites

Choose your runtime:
- **Node.js** >= 22.0.0, or
- **Bun** >= 1.2.0
- **Yarn** 4.9.2 (package manager)

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

# Run tests (uses your default runtime)
yarn test

# Run tests with specific runtime
yarn test:node  # Node.js tests
yarn test:bun   # Bun tests

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
yarn workspace @omnitron-dev/titan test
yarn workspace @omnitron-dev/common build

# Add dependencies to specific package
yarn workspace @omnitron-dev/common add lodash

# Run package-specific scripts
yarn workspace @omnitron-dev/titan dev
```

## 🏗️ Architecture

### Monorepo Structure

```
omni/
├── packages/                  # All published packages
│   ├── common/               # Shared utilities
│   ├── cuid/                 # Unique ID generation
│   ├── eventemitter/         # Event emitter
│   ├── messagepack/          # MessagePack serialization
│   ├── rotif/                # Redis messaging system
│   ├── smartbuffer/          # Binary data handling
│   ├── testing/              # Testing utilities
│   ├── titan/                # Enterprise framework
│   │   ├── src/
│   │   │   ├── nexus/       # Integrated DI container
│   │   │   ├── netron/      # Integrated WebSocket RPC
│   │   │   └── modules/     # Built-in modules
│   └── titan-module-template/ # Module template
├── scripts/                  # Build and utility scripts
└── turbo.json               # Turborepo configuration
```

### Technology Stack

- **Language**: TypeScript 5.8.3 - 5.9.2 with strict mode
- **Runtime**: Node.js 22+ and Bun 1.2+ (both fully supported)
- **Build System**: Turborepo for monorepo orchestration
- **Package Manager**: Yarn 4.9.2 with workspaces
- **Testing**: Jest 30.x (Node.js), Bun test (Bun runtime)
- **Linting**: ESLint v9 with flat config
- **Formatting**: Prettier
- **Versioning**: Changesets

### Design Principles

1. **Runtime Agnostic** - Full support for Node.js and Bun
2. **Type Safety First** - Full TypeScript with strict typing
3. **Zero/Minimal Dependencies** - Keep packages lightweight
4. **Performance Focused** - Optimized for production use
5. **Developer Experience** - Decorator-based APIs and clear documentation
6. **Modular Architecture** - Use only what you need

## 📚 Documentation

Each package contains detailed documentation:

- [Titan Framework Guide](packages/titan/README.md)
- [Common Utilities Guide](packages/common/README.md)
- [Event Emitter Guide](packages/eventemitter/README.md)
- [SmartBuffer Guide](packages/smartbuffer/README.md)
- [MessagePack Guide](packages/messagepack/README.md)
- [Rotif Messaging Guide](packages/rotif/README.md)
- [CUID Generator Guide](packages/cuid/README.md)
- [Testing Utilities Guide](packages/testing/README.md)

## 🔧 Common Use Cases

### Building an Application with Titan

```typescript
import { Application, Module, Injectable, OnStart } from '@omnitron-dev/titan';

@Injectable()
class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

@Module({
  providers: [GreetingService],
  exports: [GreetingService]
})
class AppModule implements OnStart {
  constructor(private greeting: GreetingService) {}

  async onStart(): Promise<void> {
    console.log(this.greeting.greet('Titan'));
  }
}

// Create and run application
const app = await Application.create(AppModule);
await app.start();
```

### Using Built-in WebSocket RPC (via Titan)

```typescript
import { Service, Public } from '@omnitron-dev/titan/netron';

@Service('calculator@1.0.0')
class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }
}

// Service is automatically exposed via Titan's Netron integration
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

// Works in both Node.js and Bun
emitter.on('data', async (value) => {
  await processData(value);
});

// Sequential async processing
await emitter.emitSerial('data', payload);

// Parallel async processing with concurrency control
emitter.setConcurrency(5);
await emitter.emitParallel('data', payload);
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

## 🧪 Runtime Testing

All packages are tested with multiple runtimes:

```bash
# Test with Node.js
yarn workspace @omnitron-dev/[package] test:node

# Test with Bun
yarn workspace @omnitron-dev/[package] test:bun

# Run all runtime tests
yarn workspace @omnitron-dev/[package] test:all
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using conventional commits
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Write tests for new features (test with both Node.js and Bun)
- Follow existing code patterns
- Update documentation
- Add changeset for version bumps
- Ensure all tests pass in both runtimes

## 📊 Package Status

| Package | Node.js | Bun | Deno | Version |
|---------|---------|-----|------|---------|
| @omnitron-dev/common | ✅ | ✅ | 🚧 | 0.1.0 |
| @omnitron-dev/cuid | ✅ | ✅ | 🚧 | 0.1.0 |
| @omnitron-dev/eventemitter | ✅ | ✅ | 🚧 | 0.1.0 |
| @omnitron-dev/messagepack | ✅ | ✅ | 🚧 | 0.1.0 |
| @omnitron-dev/rotif | ✅ | ✅ | ❌ | 0.1.0 |
| @omnitron-dev/smartbuffer | ✅ | ✅ | 🚧 | 0.1.0 |
| @omnitron-dev/testing | ✅ | ✅ | ❌ | 0.1.0 |
| @omnitron-dev/titan | ✅ | ✅ | 🚧 | 0.1.0 |
| @omnitron-dev/titan-module-template | ✅ | ✅ | ❌ | 0.1.0 |

Legend: ✅ Full Support | 🚧 Experimental | ❌ Not Supported

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
  Built with ❤️ for both Node.js and Bun runtimes using TypeScript
</div>