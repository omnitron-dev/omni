# @holon/runtime

> Flow-Machine runtime with distributed execution, service mesh, and production infrastructure

## Overview

`@holon/runtime` provides the execution infrastructure for Flow-Machine, building on top of `@holon/flow` with:

- **Runtime Engine**: Advanced execution engine with resource management, scheduling, and error recovery
- **Service Mesh**: Service discovery, routing, load balancing, and circuit breaking
- **Distributed Execution**: Multi-node coordination, consensus, and fault tolerance
- **Visualization**: Flow graph generation, performance metrics, and debugging tools
- **Integrations**: HTTP, gRPC, Kafka, Redis integrations for production systems
- **CLI Tools**: Command-line interface for running, inspecting, and visualizing flows

## Installation

```bash
npm install @holon/runtime @holon/flow
# or
pnpm add @holon/runtime @holon/flow
# or
yarn add @holon/runtime @holon/flow
```

## Quick Start

```typescript
import { flow } from '@holon/flow';
import { createEngine, createExecutor } from '@holon/runtime';

// Create a flow
const add = flow((x: number, y: number) => x + y);

// Create runtime engine
const engine = createEngine({
  maxConcurrency: 4,
  resourceLimits: {
    cpu: 0.8, // 80% CPU
    memory: '512MB'
  }
});

// Execute flow
const result = await engine.execute(add, [5, 3]);
console.log(result); // 8
```

## Features

### Runtime Engine

Execute flows with advanced resource management:

```typescript
import { createEngine } from '@holon/runtime/runtime/engine';

const engine = createEngine({
  maxConcurrency: 8,
  resourceLimits: {
    cpu: 0.8,
    memory: '1GB'
  },
  errorRecovery: {
    maxRetries: 3,
    backoff: 'exponential'
  }
});

// Execute with monitoring
const result = await engine.execute(myFlow, input, {
  timeout: 5000,
  priority: 'high',
  trace: true
});
```

### Service Mesh

Deploy flows as services with automatic discovery:

```typescript
import { createMeshNode } from '@holon/runtime/mesh';

const node = await createMeshNode({
  name: 'calculator-service',
  port: 3000,
  discovery: {
    type: 'dns',
    domain: 'services.local'
  }
});

// Register flows as services
await node.register('add', addFlow);
await node.register('multiply', multiplyFlow);

// Start serving
await node.start();
```

### Distributed Execution

Scale flows across multiple nodes:

```typescript
import { createCoordinator } from '@holon/runtime/distributed';

const coordinator = await createCoordinator({
  nodes: [
    'http://node1:3000',
    'http://node2:3000',
    'http://node3:3000'
  ],
  strategy: 'round-robin'
});

// Execute across cluster
const result = await coordinator.execute(computeFlow, largeDataset);
```

### Visualization

Generate visual representations and debug flows:

```typescript
import { visualizeFlow, createDebugger } from '@holon/runtime/viz';

// Generate DOT graph
const dot = visualizeFlow(myFlow, { format: 'dot' });

// Generate Mermaid diagram
const mermaid = visualizeFlow(myFlow, { format: 'mermaid' });

// Debug with step-through
const debugger = createDebugger(myFlow);
debugger.setBreakpoint('processData');
await debugger.run(input);
```

### HTTP Integration

Expose flows as HTTP endpoints:

```typescript
import { createHttpServer } from '@holon/runtime/integrations/http';

const server = createHttpServer({
  port: 3000,
  flows: {
    '/add': addFlow,
    '/multiply': multiplyFlow,
    '/compute': computeFlow
  }
});

await server.start();
// POST http://localhost:3000/add with { x: 5, y: 3 }
```

### CLI Tools

Command-line tools for flow management:

```bash
# Run a flow from a file
holon run ./flows/compute.ts --input data.json

# Inspect flow metadata
holon inspect ./flows/compute.ts

# Visualize flow as diagram
holon visualize ./flows/compute.ts --format mermaid --output diagram.md

# Test flow execution
holon test ./flows/compute.ts --test-cases tests.json
```

## Architecture

```
@holon/runtime
├── runtime/          # Core execution engine
│   ├── engine.ts     # Main execution engine
│   ├── executor.ts   # Flow executor
│   └── scheduler.ts  # Task scheduler
├── mesh/             # Service mesh
│   ├── node.ts       # Mesh node
│   ├── router.ts     # Request router
│   └── discovery.ts  # Service discovery
├── distributed/      # Distributed execution
│   ├── coordinator.ts # Job coordinator
│   ├── worker.ts     # Worker nodes
│   └── consensus.ts  # Consensus protocols
├── viz/              # Visualization
│   ├── graph.ts      # Graph generation
│   ├── metrics.ts    # Metrics collection
│   └── debugger.ts   # Debugging tools
├── integrations/     # External integrations
│   ├── http.ts       # HTTP server/client
│   ├── grpc.ts       # gRPC support
│   ├── kafka.ts      # Kafka integration
│   └── redis.ts      # Redis integration
└── cli/              # CLI tools
    └── commands/     # CLI commands
```

## API Documentation

### Engine

```typescript
interface EngineConfig {
  maxConcurrency?: number;
  resourceLimits?: ResourceLimits;
  errorRecovery?: ErrorRecoveryConfig;
  monitoring?: MonitoringConfig;
}

interface ResourceLimits {
  cpu?: number; // 0.0 to 1.0
  memory?: string; // e.g., '512MB', '2GB'
  timeout?: number; // milliseconds
}
```

### Mesh Node

```typescript
interface MeshNodeConfig {
  name: string;
  port: number;
  discovery?: DiscoveryConfig;
  healthCheck?: HealthCheckConfig;
  metrics?: MetricsConfig;
}
```

### Coordinator

```typescript
interface CoordinatorConfig {
  nodes: string[];
  strategy?: 'round-robin' | 'least-loaded' | 'consistent-hash';
  failover?: FailoverConfig;
  consensus?: ConsensusConfig;
}
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Run in development mode
pnpm dev
```

## License

MIT
