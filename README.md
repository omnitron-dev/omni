# DevGrid Monorepo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Turborepo](https://img.shields.io/badge/maintained%20with-turborepo-cc00ff.svg)](https://turbo.build/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)

A comprehensive TypeScript monorepo containing libraries for building distributed systems, data processing, and blockchain interaction.

## 📦 Packages

### Core Utilities

- [**@devgrid/common**](packages/common) - Essential utilities and helper functions for TypeScript/JavaScript projects
  - Promise utilities (defer, delay, retry, timeout)
  - Object manipulation (omit, entries, keys, values)
  - Type predicates and guards
  - Data structures (ListBuffer, TimedMap)

- [**@devgrid/async-emitter**](packages/async-emitter) - Advanced asynchronous event emitter
  - Parallel and sequential event execution
  - Concurrency control with p-limit
  - Promise-based event handling
  - Event filtering and reduction

- [**@devgrid/smartbuffer**](packages/smartbuffer) - Enhanced binary data manipulation
  - Efficient buffer operations
  - Support for various data types (int8-64, float, double, varint)
  - Big-endian and little-endian support
  - String encoding/decoding utilities

### Distributed Systems

- [**@devgrid/netron**](packages/netron) - WebSocket-based distributed systems framework
  - Type-safe RPC with decorators
  - Event bus with multiple emission patterns
  - Service discovery via Redis
  - Automatic reconnection and versioning
  - Streaming support for large data transfers

- [**@devgrid/netron-nest**](packages/netron-nest) - NestJS integration for Netron
  - Dependency injection support
  - Service decorators
  - Module configuration
  - Health checks

### Message Queue & Notifications

- [**@devgrid/rotif**](packages/rotif) - Redis-based reliable notification system
  - Guaranteed message delivery
  - Dead Letter Queue (DLQ) support
  - Retry mechanisms with exponential backoff
  - Consumer groups for horizontal scaling
  - Delayed message delivery
  - Middleware hooks system

- [**@devgrid/rotif-nest**](packages/rotif-nest) - NestJS integration for Rotif
  - Decorator-based message handlers
  - Module configuration
  - Health indicators
  - Graceful shutdown support

### Data Processing

- [**@devgrid/messagepack**](packages/messagepack) - High-performance MessagePack serialization
  - Full MessagePack specification support
  - Efficient binary serialization
  - Custom type support
  - Stream processing capabilities

### Blockchain

- [**@devgrid/bitcoin-core**](packages/bitcoin-core) - Typed Bitcoin Core RPC client
  - Full RPC API coverage
  - TypeScript type definitions
  - Promise-based interface
  - Error handling

## 🚀 Applications

- [**onix**](apps/onix) - Infrastructure orchestration and configuration management
  - SSH-based task execution
  - Playbook system (similar to Ansible)
  - Inventory management
  - Template engine support
  - Pluggable task system

## 🛠️ Tech Stack

- **Language**: TypeScript 5.8.3
- **Runtime**: Node.js 22+
- **Package Manager**: Yarn 4.7.0 (with workspaces)
- **Build System**: Turborepo
- **Testing**: Jest 30
- **Linting**: ESLint 9 with TypeScript support
- **Formatting**: Prettier

## 🚀 Getting Started

### Prerequisites

- Node.js >= 22
- Yarn 4.7.0

### Installation

```bash
# Clone the repository
git clone https://github.com/d-e-v-grid/dg-monorepo.git
cd dg-monorepo

# Install dependencies
yarn install

# Build all packages
yarn build
```

### Development

```bash
# Run development mode for all packages
yarn dev

# Run tests
yarn test

# Lint code
yarn lint

# Fix linting and formatting issues
yarn fix:all

# Clean all node_modules
yarn cleanup
```

### Working with Specific Packages

```bash
# Run commands for a specific package
yarn workspace @devgrid/netron test
yarn workspace @devgrid/rotif build

# Add dependencies to a specific package
yarn workspace @devgrid/common add lodash
```

## 📚 Documentation

Each package contains its own README with detailed documentation:

- Core utilities documentation in [`packages/common`](packages/common)
- Distributed systems guide in [`packages/netron`](packages/netron)
- Message queue documentation in [`packages/rotif`](packages/rotif)
- Binary data handling in [`packages/smartbuffer`](packages/smartbuffer)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using conventional commits
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [GitHub Repository](https://github.com/d-e-v-grid/dg-monorepo)
- [Issue Tracker](https://github.com/d-e-v-grid/dg-monorepo/issues)