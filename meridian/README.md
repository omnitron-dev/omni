# Meridian

**Cognitive Memory System for LLM Codebase Interaction**

Meridian is a revolutionary memory system for Large Language Models, designed to enable efficient and intelligent interaction with large codebases. Instead of traditional indexing, Meridian implements a cognitive memory architecture that mimics human memory patterns.

## Key Features

### 🧠 Four-Level Memory Architecture
- **Episodic Memory**: Records of specific tasks and their solutions
- **Working Memory**: Active context for current tasks with attention-based management
- **Semantic Memory**: Generalized patterns and architectural knowledge
- **Procedural Memory**: Knowledge about HOW to perform common tasks

### 🎯 Attention-Aware Context Management
- Tracks LLM attention patterns
- Predicts needed context
- Adaptive compression (85-95% token savings)
- Context defragmentation for coherent information flow

### 🚀 Model-Adaptive Design
- Adapts to different context windows (8K-1M tokens)
- Optimized strategies for Claude, GPT-4, Gemini, and custom models
- Progressive loading based on available tokens
- Intelligent token budgeting

### 📚 Learning System
- Learns from successful task completions
- Extracts patterns from episodes
- Predicts next actions
- Team-specific adaptation

### 🏗️ Enterprise-Grade Features
- RocksDB-backed persistent storage
- Session isolation for parallel work
- Monorepo support with project detection
- Incremental indexing
- Zero external dependencies

## Quick Start

### Installation

```bash
cd meridian
cargo build --release
```

### Initialize an Index

```bash
./target/release/meridian init /path/to/your/project
```

### Index a Project

```bash
./target/release/meridian index /path/to/your/project
```

### Start the MCP Server

```bash
./target/release/meridian serve --stdio
```

### Query the Index

```bash
./target/release/meridian query "PaymentService" --limit 10
```

## Configuration

Create a `meridian.toml` file:

```toml
[index]
languages = ["rust", "typescript", "javascript"]
ignore = ["node_modules", "target", ".git"]

[memory]
episodic_retention_days = 30
working_memory_size = "10MB"

[mcp]
max_token_response = 2000
```

## MCP Integration

Meridian implements the Model Context Protocol (MCP) for seamless integration with LLM tools.

### Configure with Claude Code

```json
{
  "servers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "env": {
        "MERIDIAN_CONFIG": "./meridian.toml"
      }
    }
  }
}
```

## Architecture

```
┌─────────────────────────────────────────┐
│           LLM Interface (MCP)           │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼────┐  ┌────▼─────┐  ┌───▼────┐
│Memory  │  │ Context  │  │Session │
│System  │  │ Manager  │  │Manager │
└───┬────┘  └────┬─────┘  └───┬────┘
    │            │            │
    └────────────┼────────────┘
                 │
         ┌───────▼────────┐
         │    Indexer     │
         └───────┬────────┘
                 │
         ┌───────▼────────┐
         │ Storage Layer  │
         │   (RocksDB)    │
         └────────────────┘
```

## Memory System

### Episodic Memory
Records complete task episodes including:
- Task description
- Files accessed
- Queries made
- Solution path
- Outcome (success/failure)

### Working Memory
Manages active context with:
- Attention weight tracking
- LRU eviction
- Prefetching predictions
- Token budget management

### Semantic Memory
Stores generalized knowledge:
- Code patterns
- Architectural decisions
- Coding conventions
- Cross-cutting concerns

### Procedural Memory
Learns task procedures:
- Step-by-step workflows
- Required context
- Typical queries
- Success rates

## Development

### Run Tests

```bash
cargo test
```

### Run Benchmarks

```bash
cargo bench
```

### Enable Debug Logging

```bash
RUST_LOG=debug ./target/release/meridian serve --stdio
```

## Project Status

Meridian is currently in active development. The core architecture is complete, but some advanced features are still being implemented:

- ✅ Storage layer with RocksDB
- ✅ Four-level memory architecture
- ✅ Session management
- ✅ Basic indexing infrastructure
- 🚧 Tree-sitter integration (in progress)
- 🚧 MCP server implementation (in progress)
- 🚧 Semantic embeddings (planned)
- 🚧 Pattern extraction (planned)
- 🚧 Attention tracking (planned)

## Roadmap

### Phase 1: Core Infrastructure ✅
- Storage layer
- Memory system skeleton
- Basic CLI

### Phase 2: Code Indexing (Current)
- Tree-sitter integration
- Symbol extraction
- Dependency graph

### Phase 3: MCP Server
- Full MCP protocol implementation
- Tool handlers
- Resource management

### Phase 4: Learning System
- Pattern extraction
- Procedural learning
- Prediction model

### Phase 5: Advanced Features
- Attention tracking
- Context defragmentation
- Team adaptation

## Performance Goals

- **Indexing**: < 10ms per file
- **Query**: < 50ms typical response
- **Memory**: < 100MB per 10K files
- **Token Savings**: 85-95% vs full files

## Contributing

Contributions are welcome! Please see the specification in `meridian/specs/spec.md` for detailed architecture and implementation guidelines.

## License

MIT

## Documentation

For detailed specifications and architecture, see:
- `specs/spec.md` - Complete system specification
- `specs/idea1.md` - Initial concept
- `specs/idea2.md` - Architecture refinements
