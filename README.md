# Dev Grid

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Turborepo](https://img.shields.io/badge/maintained%20with-turborepo-cc00ff.svg)](https://turbo.build/)

Monorepository with a set of TypeScript libraries for building distributed systems, data processing, and blockchain interaction.

## 📦 Packages

### Core Libraries

- [@devgrid/common](packages/common) - A collection of commonly used utilities and functions for TypeScript/JavaScript
- [@devgrid/netron](packages/netron) - A library for building distributed systems with support for RPC, event bus, and streams
- [@devgrid/messagepack](packages/messagepack) - High-performance MessagePack implementation for Node.js
- [@devgrid/smartbuffer](packages/smartbuffer) - An enhanced version of ByteBuffer.js for working with binary data
- [@devgrid/async-emitter](packages/async-emitter) - Asynchronous event emitter with support for parallel and sequential execution
- [@devgrid/bitcoin-core](packages/bitcoin-core) - Typed RPC client for Bitcoin Core
- [@devgrid/rest-core](packages/rest-core) - Core module for building REST APIs with TypeScript and Zod validation support
- [@devgrid/rest-openapi](packages/rest-openapi) - OpenAPI specification generation from TypeScript types
- [@devgrid/rest-react-query](packages/rest-react-query) - REST API integration with React Query for state management
- [@devgrid/rest-nest](packages/rest-nest) - NestJS integration for REST APIs

### Applications

- [omnitron](apps/omnitron) - Node.js/Bun process manager and infrastructure management system (in development)