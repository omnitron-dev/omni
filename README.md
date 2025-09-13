# DevGrid Monorepo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Turborepo](https://img.shields.io/badge/maintained%20with-turborepo-cc00ff.svg)](https://turbo.build/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3--5.9.2-blue)](https://www.typescriptlang.org/)
[![Yarn](https://img.shields.io/badge/yarn-4.9.2-2C8EBB)](https://yarnpkg.com/)
[![Bun](https://img.shields.io/badge/bun-compatible-f472b6)](https://bun.sh/)

A comprehensive TypeScript monorepo containing libraries for building distributed systems and data processing applications.

## 🎯 Vision

DevGrid provides a suite of production-ready TypeScript packages for building scalable, distributed applications with focus on:
- **Real-time Communication** - WebSocket-based RPC and event streaming
- **Data Processing** - Efficient serialization and buffer manipulation
- **Cross-Runtime Support** - Works with both Node.js and Bun
- **Developer Experience** - Type safety, great APIs, and comprehensive docs

## 📦 Packages

### Core Utilities

#### [@devgrid/common](packages/common)
Essential utilities and helper functions for TypeScript/JavaScript projects.
- Promise utilities (defer, delay, retry, timeout)
- Object manipulation (omit, entries, keys, values)
- Type predicates and guards
- Data structures (ListBuffer, TimedMap)
- ✅ Bun compatible

#### [@devgrid/eventemitter](packages/eventemitter)
Universal event emitter with both synchronous and asynchronous emission patterns.
- Standard EventEmitter API (on, off, emit, once)
- Parallel and sequential async event execution
- Reduce patterns for event accumulation
- Concurrency control with p-limit
- Promise-based event handling
- Works in Node.js, Bun, and browsers
- ✅ Bun compatible

#### [@devgrid/smartbuffer](packages/smartbuffer)
Enhanced binary data manipulation based on ByteBuffer.js.
- Efficient buffer operations
- Support for various data types (int8-64, float, double, varint)
- Big-endian and little-endian support
- String encoding/decoding utilities
- ✅ Bun compatible

### Data Processing

#### [@devgrid/messagepack](packages/messagepack)
High-performance MessagePack serialization with TypeScript support.
- Full MessagePack specification support
- Custom type extensions
- Efficient binary serialization
- Stream processing capabilities
- ✅ Bun compatible

### Distributed Systems

#### [@devgrid/netron](packages/netron)
WebSocket-based distributed systems framework for building microservices.
- Type-safe RPC with decorators
- Event bus with multiple emission patterns
- Service discovery via Redis
- Automatic reconnection and versioning
- Streaming support for large data transfers
- ✅ Bun compatible with test coverage

#### [@devgrid/netron-nest](packages/netron-nest)
NestJS integration for Netron framework.
- Seamless NestJS dependency injection
- Service decorators for easy exposure
- Module configuration
- Health checks and graceful shutdown

## 🚀 Getting Started

### Prerequisites

- Node.js >= 22 or Bun >= 1.0
- Yarn 4.9.2

### Installation

```bash
# Clone the repository
git clone https://github.com/d-e-v-grid/devgrid.git
cd devgrid

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
yarn workspace @devgrid/netron test
yarn workspace @devgrid/common build

# Add dependencies to specific package
yarn workspace @devgrid/common add lodash

# Run package-specific scripts
yarn workspace @devgrid/netron dev
```

## 🏗️ Architecture

### Monorepo Structure

```
devgrid/
├── packages/           # All published packages
│   ├── common/        # Shared utilities
│   ├── eventemitter/  # Event emitter
│   ├── smartbuffer/   # Binary data handling
│   ├── messagepack/   # Serialization
│   ├── netron/        # Distributed framework
│   └── netron-nest/   # NestJS integration
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

## 🔧 Common Use Cases

### Building a Microservice

```typescript
import { Netron, Service, Public } from '@devgrid/netron';

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
import { encode, decode } from '@devgrid/messagepack';

const data = { user: 'John', scores: [1, 2, 3] };
const encoded = encode(data); // Buffer
const decoded = decode(encoded); // Original data
```

### Advanced Event Handling

```typescript
import { EventEmitter } from '@devgrid/eventemitter';

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

## 📈 Roadmap

- [ ] gRPC transport for Netron
- [ ] Browser bundle optimizations
- [ ] Performance benchmarks suite
- [ ] Additional NestJS integrations
- [ ] WebAssembly support for data processing
- [ ] Deno compatibility

## 🔄 Recently Moved Packages

The following packages have been moved to separate repositories for better maintainability:

- **@devgrid/rotif** - Redis-based reliable notification system → [Separate monorepo](https://github.com/d-e-v-grid/rotif)
- **@devgrid/bitcoin-core** - Bitcoin Core RPC client → [Separate repository](https://github.com/d-e-v-grid/bitcoin-core)
- **@devgrid/onix** - Infrastructure orchestration (discontinued)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [GitHub Repository](https://github.com/d-e-v-grid/devgrid)
- [Issue Tracker](https://github.com/d-e-v-grid/devgrid/issues)
- [Discussions](https://github.com/d-e-v-grid/devgrid/discussions)

## 👥 Team

Created and maintained by the DevGrid team.

---

<div align="center">
  Built with ❤️ using TypeScript
</div>