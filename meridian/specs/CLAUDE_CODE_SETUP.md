# Meridian MCP Server - Claude Code Integration Guide

## Overview

Meridian is a cognitive memory system for LLMs that provides intelligent context management, experience-based learning, and adaptive codebase navigation through the Model Context Protocol (MCP).

## Quick Start

### Prerequisites

- Rust 1.90+ with Cargo
- Claude Code (latest version)
- Git

### Step 1: Build Meridian

```bash
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian
cargo build --release

# Verify the build
./target/release/meridian --version
```

### Step 2: Configure Claude Code

Create `.claude/mcp_config.json` in your project root:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/target/release/meridian",
      "args": ["serve", "--stdio"],
      "env": {
        "RUST_LOG": "info"
      }
    }
  }
}
```

### Step 3: Verify Connection

Test the MCP server:

```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}' | \
  ./target/release/meridian serve --stdio
```

Expected response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {"name": "meridian", "version": "0.1.0"},
    "capabilities": {"tools": {}}
  },
  "id": 1
}
```

### Step 4: Restart Claude Code

1. Restart Claude Code after creating the configuration
2. Open your project containing `.claude/mcp_config.json`
3. Meridian tools should now be available in Claude Code

## Available Tools

Once connected, you'll have access to these MCP tools:

### Memory Management
- `memory.record_episode` - Record a work episode for learning
- `memory.find_similar_episodes` - Find similar past tasks
- `memory.get_statistics` - Get memory system statistics

### Context Management
- `context.prepare_adaptive` - Prepare context adapted to available tokens
- `context.compress` - Compress content using various strategies
- `context.defragment` - Defragment scattered context fragments

### Code Navigation
- `code.search_symbols` - Search for symbols in codebase
- `code.get_definition` - Get symbol definition
- `code.find_references` - Find symbol references
- `code.get_dependencies` - Get dependency graph

### Session Management
- `session.begin` - Start a new work session
- `session.update` - Update file in session
- `session.query` - Query within session context
- `session.complete` - Complete session (commit/discard/stash)

## Example Usage in Claude Code

```typescript
// Find similar past tasks
const episodes = await mcp.call("meridian", "memory.find_similar_episodes", {
  task_description: "Add authentication middleware",
  limit: 3
});

// Search for symbols
const symbols = await mcp.call("meridian", "code.search_symbols", {
  query: "PaymentService",
  max_results: 10,
  types: ["class", "interface"]
});

// Start a work session
const sessionId = await mcp.call("meridian", "session.begin", {
  task_description: "Refactor payment module",
  scope: ["src/services/payment/"]
});

// Prepare adaptive context
const context = await mcp.call("meridian", "context.prepare_adaptive", {
  files: ["src/auth/middleware.rs"],
  max_tokens: 8000
});
```

## Configuration (Optional)

Create `meridian.toml` in your project root for custom settings:

```toml
[storage]
path = ".meridian/storage"

[memory]
episodic_retention_days = 30
working_memory_size = "10MB"
consolidation_interval = "1h"

[session]
max_sessions = 10
session_timeout = "1h"

[index]
languages = ["rust", "typescript", "javascript", "python", "go"]
ignore_patterns = ["target/", "node_modules/", ".git/"]
```

## Troubleshooting

### "Command not found: meridian"

Use the full path in `.claude/mcp_config.json`:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "/full/path/to/meridian/target/release/meridian",
      "args": ["serve", "--stdio"]
    }
  }
}
```

### "Connection timeout"

Check if the server starts without errors:

```bash
./target/release/meridian serve --stdio --debug
```

### "Tools not showing in Claude Code"

1. Verify `.claude/mcp_config.json` is correct
2. Restart Claude Code completely
3. Ensure you're in the project with the configuration file
4. Check Claude Code logs for MCP connection errors

### Enable Debug Logging

For detailed debugging:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "/path/to/meridian",
      "args": ["serve", "--stdio", "--debug"],
      "env": {
        "RUST_LOG": "debug,meridian=trace",
        "RUST_BACKTRACE": "1"
      }
    }
  }
}
```

## Features

### 🧠 Intelligent Memory

- **Episodic Memory**: Remembers past tasks and successful patterns
- **Working Memory**: Maintains focus on relevant symbols
- **Semantic Memory**: Learns relationships between concepts
- **Procedural Memory**: Captures step-by-step workflows

### 🔍 Smart Code Navigation

- Multi-language support (Rust, TypeScript, Python, Go)
- Semantic search with fuzzy matching
- Dependency graph analysis
- Symbol definition and reference tracking

### 📊 Adaptive Context

- 8 compression strategies (Skeleton, Summary, TreeShaking, etc.)
- Automatic adaptation to available token budget
- Context defragmentation with semantic bridging
- Up to 95% token savings while preserving meaning

### 🚀 Session Management

- Copy-on-write isolated workspaces
- Conflict detection across parallel sessions
- Stash/commit/discard workflows
- Query within session scope

## Testing

Verify everything works:

```bash
# Run all tests
cargo test

# Run specific test suite
cargo test --test integration_context
cargo test --test e2e_full_workflow

# Check test coverage
cargo test --all-features -- --nocapture
```

All 252 tests should pass with 0 failures.

## Support

If you encounter issues:

1. Check Meridian logs: `.meridian/logs/meridian.log`
2. Run diagnostics: `cargo test --lib`
3. Create an issue with debug output

## What's Next

Meridian will automatically:

- 🧠 Learn your work patterns and preferences
- 🔍 Build semantic understanding of your codebase
- 📊 Optimize context for your specific use cases
- 🚀 Save up to 95% of tokens while maintaining quality
- 📈 Improve with each interaction

Happy coding with Meridian! 🎉
