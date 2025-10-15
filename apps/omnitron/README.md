# Omnitron

**The Meta-System for Fractal Coherent Computing**

Omnitron is a universal development platform that transcends traditional boundaries between IDE, platform, and runtime. Built on **Titan** (backend) and **Aether** (frontend), it embodies the principle that "everything is a Flow" - from atomic functions to entire distributed systems.

## Project Structure

```
apps/omnitron/
├── src/                    # Backend (Titan)
│   ├── modules/            # Service modules
│   │   ├── flow-executor/  # Flow execution service
│   │   ├── storage/        # Distributed storage
│   │   ├── intelligence/   # AI orchestration
│   │   ├── orchestration/  # Task scheduling
│   │   └── monitoring/     # Observability
│   ├── app.module.ts       # Application root module
│   └── main.ts             # Backend entry point
├── web/                    # Frontend (Aether)
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── styles/         # Stylesheets
│   │   ├── App.tsx         # Root component
│   │   └── main.tsx        # Frontend entry point
│   └── index.html          # HTML template
├── shared/                 # Shared code
│   ├── types/              # Type definitions
│   ├── contracts/          # API contracts
│   └── utils/              # Shared utilities
└── specs/                  # Specifications
```

## Commands

### Development

```bash
# Install dependencies (from monorepo root)
pnpm install

# Start backend and frontend in parallel
pnpm dev

# Start backend only
pnpm dev:backend

# Start frontend only
pnpm dev:web
```

### Building

```bash
# Build everything (shared, backend, web)
pnpm build

# Build shared types only
pnpm build:shared

# Build backend only
pnpm build:backend

# Build frontend only
pnpm build:web
```

### Testing

```bash
# Run all tests
pnpm test

# Run backend tests
pnpm test:backend

# Run frontend tests
pnpm test:web

# Run tests in watch mode
pnpm test:watch
```

### Type Checking

```bash
# Type check everything
pnpm typecheck

# Type check backend only
pnpm typecheck:backend

# Type check frontend only
pnpm typecheck:web
```

### Code Quality

```bash
# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check
```

## Architecture

### Backend (Titan)

The backend leverages Titan's distributed architecture:

- **Flow Executor**: Executes Flows with distributed coordination
- **Storage Service**: Multi-modal persistence (PostgreSQL, Redis, S3, Vector DB)
- **Intelligence Service**: AI orchestration and cognitive capabilities
- **Orchestration Service**: Task scheduling and workflow execution
- **Monitoring Service**: Observability with metrics, traces, and logs

### Frontend (Aether)

The frontend uses Aether's fine-grained reactivity:

- **Shell**: Application shell with layout management
- **Flow Canvas**: Visual flow editor (planned)
- **Code Editor**: Monaco-based editor (planned)
- **Terminal**: Web terminal (planned)
- **AI Chat**: Integrated AI assistant (planned)

### Shared

- **Types**: Flow definitions, API contracts
- **Utils**: ID generation, validation
- **Contracts**: Netron RPC service contracts

## Environment Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Configure your environment variables:
   - Database connection (PostgreSQL)
   - Cache connection (Redis)
   - Storage (S3-compatible)
   - AI keys (optional)

3. Start services:
   ```bash
   # Start PostgreSQL
   docker run -d --name omnitron-postgres \
     -e POSTGRES_DB=omnitron \
     -e POSTGRES_USER=omnitron \
     -e POSTGRES_PASSWORD=omnitron \
     -p 5432:5432 \
     postgres:15

   # Start Redis
   docker run -d --name omnitron-redis \
     -p 6379:6379 \
     redis:7
   ```

## Technology Stack

### Backend
- **Runtime**: Node.js 22+, Bun 1.2+
- **Framework**: Titan (Nexus DI + Netron RPC)
- **Database**: PostgreSQL, Redis
- **Testing**: Jest
- **Language**: TypeScript 5.9+

### Frontend
- **Framework**: Aether (Fine-grained reactivity)
- **Build**: Vite
- **Testing**: Vitest
- **Language**: TypeScript 5.9+

## Contributing

This project follows the Omnitron philosophy:

1. **Fractal Principle**: Same patterns at every scale
2. **Coherence Through Composition**: Universal composition
3. **Code as Configuration**: Everything is executable
4. **Intelligence First**: AI is fundamental
5. **Least Commitment**: Minimal assumptions, grow on demand

## License

MIT

---

**"In Omnitron, we don't build software. We grow computational organisms that evolve with our needs."**
