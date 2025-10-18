# Getting Started with Meridian

**Version**: 2.0.0
**Last Updated**: October 18, 2025
**Status**: Production-Ready
**Audience**: New users, Developers

---

## Table of Contents

1. [What is Meridian?](#what-is-meridian)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [First Indexing](#first-indexing)
5. [Claude Code Integration](#claude-code-integration)
6. [Basic MCP Tool Usage](#basic-mcp-tool-usage)
7. [Common Workflows](#common-workflows)
8. [Troubleshooting](#troubleshooting)
9. [Next Steps](#next-steps)

---

## What is Meridian?

Meridian is a **cognitive code memory system** designed for Large Language Models (LLMs) like Claude. It provides:

- **Intelligent Code Indexing**: Tree-sitter based parsing for TypeScript, Rust, JavaScript, Python, and Go
- **4-Tier Memory System**: Episodic, Working, Semantic, and Procedural memory
- **Adaptive Context Management**: Optimized for different LLM context windows (8K-200K tokens)
- **Learning System**: Learns from your coding patterns and predicts next actions
- **Session Management**: Isolated workspaces for iterative development
- **Git Integration**: Track code evolution and history

### Key Benefits

- **Token Efficiency**: 85-95% reduction in token usage vs. full file loading
- **Context Aware**: Provides exactly the right information at the right time
- **Learning**: Gets better as you use it
- **Fast**: <50ms response time for typical queries
- **Production Ready**: 431 tests, 100% pass rate

---

## Installation

### System Requirements

- **Operating System**: macOS, Linux, or Windows (WSL recommended)
- **Rust**: 1.70+ (for building from source)
- **Node.js**: 22+ (optional, for TypeScript projects)
- **Git**: 2.30+ (for history tracking)
- **Disk Space**: ~500MB for installation + indexed data

### Install from Binary (Recommended)

**Coming Soon**: Pre-built binaries will be available for download.

### Install from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/meridian.git
cd meridian

# Build in release mode
cargo build --release

# Install to system path
cargo install --path .

# Verify installation
meridian --version
# Output: meridian 2.0.0
```

### Post-Installation

```bash
# Initialize global configuration
meridian init --global

# This creates:
# - ~/.meridian/meridian.toml (global config)
# - ~/.meridian/data/ (global database)
# - ~/.meridian/logs/ (server logs)
```

---

## Quick Start

### 1. Index Your First Project

```bash
# Navigate to your project
cd /path/to/your/monorepo

# Initialize Meridian in the project
meridian init

# This creates:
# - .meridian/meridian.toml (local config)
# - .meridian/cache.db/ (local cache)

# Start indexing
meridian index

# Output:
# Indexing project...
# Found 5 packages:
#   - @company/ui-kit (TypeScript)
#   - @company/components (TypeScript)
#   - @company/utils (TypeScript)
#   - @company/api (TypeScript)
#   - @company/core (TypeScript)
#
# Indexed 1,234 symbols in 23 files
# Duration: 2.3s
# Index size: 15.2 MB
```

### 2. Test the Index

```bash
# Search for symbols
meridian search "Application"

# Output:
# Found 3 symbols:
# 1. class Application (@company/core/src/app.ts:15)
# 2. interface ApplicationConfig (@company/core/src/config.ts:8)
# 3. function createApplication (@company/core/src/factory.ts:42)

# Get detailed information
meridian get "@company/core/src/app.ts:15"

# Output:
# Symbol: Application
# Type: class
# Location: @company/core/src/app.ts:15-89
#
# Documentation:
# Main application class that manages the lifecycle...
#
# Dependencies:
# - EventEmitter (@company/utils)
# - Logger (@company/core)
#
# Used by:
# - createApplication (@company/core/src/factory.ts)
# - main (@company/api/src/index.ts)
```

### 3. Start Global Server (Optional)

For multi-monorepo support:

```bash
# Start the global server as a daemon
meridian server start --daemon

# Check status
meridian server status

# Output:
# Meridian Global Server
# Status: Running
# PID: 12345
# Uptime: 2m 15s
# Registered monorepos: 1
# Total projects: 5
# Memory usage: 42.3 MB
```

---

## First Indexing

### Understanding the Indexing Process

Meridian uses **tree-sitter** to parse your code and extract symbols. The process:

1. **Project Detection**: Finds all projects in your workspace
2. **Language Detection**: Identifies file types (TypeScript, Rust, etc.)
3. **AST Parsing**: Parses files into Abstract Syntax Trees
4. **Symbol Extraction**: Extracts functions, classes, interfaces, types
5. **Relationship Building**: Creates dependency graphs and cross-references
6. **Storage**: Saves to RocksDB for fast retrieval

### What Gets Indexed

**TypeScript/JavaScript**:
- Functions and methods
- Classes and interfaces
- Type definitions
- Variables and constants
- Imports and exports

**Rust**:
- Functions and associated functions
- Structs, enums, and traits
- Modules and crates
- Type definitions
- Use statements

**Other Languages** (Python, Go):
- Similar symbol extraction based on language features

### Indexing a Single-Package Project

```bash
cd /path/to/single-package
meridian init
meridian index

# Output:
# Indexing project...
# Found 1 package:
#   - my-project (TypeScript)
#
# Indexed 234 symbols in 12 files
# Duration: 0.8s
```

### Indexing a Monorepo

```bash
cd /path/to/monorepo
meridian init
meridian index

# For pnpm workspaces:
# Automatically detects packages/ directories

# For Cargo workspaces:
# Automatically detects workspace members

# Output:
# Indexing monorepo...
# Workspace type: pnpm
# Found 8 packages:
#   - @company/ui-kit
#   - @company/components
#   - ... (6 more)
#
# Indexed 2,456 symbols in 89 files
# Duration: 5.2s
```

### Incremental Re-Indexing

```bash
# After making changes, re-index only changed files
meridian index --incremental

# Output:
# Re-indexing changed files...
# Changed: 2 files
# Updated: 14 symbols
# Duration: 0.3s
```

### Monitoring Index Status

```bash
# Get index statistics
meridian stats

# Output:
# Project: @company/ui-kit
# Total symbols: 2,456
# Total files: 89
# Index size: 25.4 MB
# Last indexed: 2 minutes ago
#
# Breakdown:
#   Functions: 1,234
#   Classes: 456
#   Interfaces: 345
#   Types: 421
```

---

## Claude Code Integration

### Prerequisites

- Claude Code CLI installed
- Meridian installed and indexed

### Configuration

Create or update `.claude.json` in your project root:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "cwd": "/path/to/your/monorepo",
      "env": {
        "RUST_LOG": "info"
      }
    }
  }
}
```

### Starting Claude Code

```bash
cd /path/to/your/monorepo
claude code

# Claude Code will automatically:
# 1. Detect .claude.json
# 2. Start Meridian MCP server
# 3. Connect via STDIO
# 4. Load your project context
```

### Verifying Connection

In Claude Code, try:

```
Can you search for the Application class in this project?
```

Claude should use Meridian's `code.search_symbols` tool and return results.

### MCP Health Check

```bash
# In a separate terminal
meridian mcp-health

# Output:
# MCP Server Health Check
# Status: Connected ✓
# Tools available: 29
# Last request: 2s ago
# Requests handled: 15
# Average latency: 23ms
```

---

## Basic MCP Tool Usage

### Code Search

**From Claude Code**:
```
Search for all functions that handle authentication
```

Claude uses: `code.search_symbols`
```typescript
{
  query: "authenticate",
  type: ["function"],
  max_results: 10
}
```

### Get Documentation

**From Claude Code**:
```
Show me the documentation for the Application class
```

Claude uses: `docs.get_for_symbol`
```typescript
{
  symbol_id: "@company/core/src/app.ts:Application",
  include_examples: true
}
```

### Session Management

**From Claude Code**:
```
Let's refactor the authentication module. Start a session.
```

Claude uses: `session.begin`
```typescript
{
  task_description: "Refactor authentication module",
  scope: ["src/auth/"]
}
```

### Memory System

**From Claude Code**:
```
Have we done anything similar to adding a new API endpoint before?
```

Claude uses: `memory.find_similar_episodes`
```typescript
{
  task_description: "Add new API endpoint",
  limit: 5
}
```

---

## Common Workflows

### Workflow 1: Exploring an Unfamiliar Codebase

```
User: I'm new to this codebase. Can you give me an overview?

Claude (uses): monorepo.list_projects
Result: Lists all packages

User: What's in the @company/core package?

Claude (uses): code.search_symbols { scope: "@company/core" }
Result: Lists main symbols

User: Show me the Application class

Claude (uses): code.get_definition { symbol_id: "..." }
Result: Full class definition with docs
```

### Workflow 2: Refactoring a Module

```
User: Let's refactor the authentication module

Claude (uses): session.begin
Result: Session created

User: What functions are in the auth module?

Claude (uses): code.search_symbols { scope: "src/auth/" }
Result: Lists functions

User: Show me where authenticate() is used

Claude (uses): code.find_references { symbol_id: "authenticate" }
Result: All call sites

[User makes changes]

User: Commit these changes

Claude (uses): session.complete { action: "commit" }
Result: Changes committed
```

### Workflow 3: Learning from Past Work

```
User: I need to add a new database migration. Have we done this before?

Claude (uses): memory.find_similar_episodes
Result: Similar past tasks

Claude: Yes, here are 3 similar migrations we've done...

User: What files did we touch?

Claude: [Shows files from episode memory]

User: Let's do the same for this migration

Claude (uses): predict.next_action
Result: Suggests next steps based on past patterns
```

---

## Troubleshooting

### Issue 1: Indexing Fails

**Symptom**: `Error: Failed to parse file`

**Cause**: Syntax errors in source files

**Solution**:
```bash
# Check for syntax errors
npm run lint  # or cargo check

# Skip problematic files
echo "src/broken.ts" >> .meridian/ignore

# Re-index
meridian index
```

### Issue 2: MCP Server Not Connecting

**Symptom**: Claude Code can't connect to Meridian

**Diagnosis**:
```bash
# Check if Meridian is running
ps aux | grep meridian

# Check logs
cat ~/.meridian/logs/server.log

# Test STDIO manually
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | meridian serve --stdio
```

**Solution**:
```bash
# Restart Meridian
pkill meridian
meridian serve --stdio
```

### Issue 3: Slow Indexing

**Symptom**: Indexing takes >1 minute for small project

**Cause**: Too many files or large files

**Solution**:
```bash
# Add ignore patterns to .meridian/meridian.toml
[indexing]
ignore_patterns = [
  "node_modules",
  "dist",
  "*.test.ts",
  "*.spec.ts"
]

# Re-index
meridian index --force
```

### Issue 4: Memory Usage Too High

**Symptom**: Meridian using >1GB RAM

**Diagnosis**:
```bash
# Check memory stats
meridian stats

# Check index size
du -sh ~/.meridian/data/
```

**Solution**:
```bash
# Reduce cache size in ~/.meridian/meridian.toml
[cache]
max_cache_size_mb = 256  # Default: 2048

# Clean old data
meridian cache clear --global
```

### Issue 5: Missing Symbols

**Symptom**: Can't find symbols that exist

**Cause**: Index out of date

**Solution**:
```bash
# Force full re-index
meridian index --force

# Or incremental update
meridian index --incremental
```

### Getting Help

**Check Logs**:
```bash
# Server logs
tail -f ~/.meridian/logs/server.log

# Indexing logs
tail -f ~/.meridian/logs/indexing.log

# Error logs
tail -f ~/.meridian/logs/errors.log
```

**Debug Mode**:
```bash
# Run with verbose logging
RUST_LOG=debug meridian serve --stdio
```

**Report Issues**:
- GitHub Issues: https://github.com/yourusername/meridian/issues
- Include: Meridian version, OS, error logs, steps to reproduce

---

## Next Steps

### Beginner

1. **Explore More Tools**: Try `code.find_references`, `history.get_evolution`
2. **Use Sessions**: Practice with `session.begin`, `session.update`, `session.complete`
3. **Learn Memory System**: Experiment with `memory.record_episode`, `memory.find_similar_episodes`

### Intermediate

1. **Multi-Monorepo Setup**: See [Multi-Monorepo Setup Guide](./multi-monorepo-setup.md)
2. **MCP Integration**: See [MCP Integration Guide](./mcp-integration.md)
3. **Custom Configuration**: Optimize `.meridian/meridian.toml` for your workflow

### Advanced

1. **Global Server**: Set up global server for multiple monorepos
2. **Cross-Repository Documentation**: Access docs from other projects
3. **Testing**: See [Testing Guide](./testing-guide.md)

### Related Documentation

- **[Core Specification](../spec.md)**: Deep dive into architecture
- **[Strong Tools Specification](../strong-tools-spec.md)**: Documentation generation
- **[Global Architecture](../global-architecture-spec.md)**: Multi-monorepo features
- **[MCP Tools Catalog](../schemas/mcp-tools-catalog.md)**: Complete tool reference

---

**Guide Version**: 1.0.0
**Meridian Version**: 2.0.0
**Last Updated**: October 18, 2025
**Feedback**: Submit issues to GitHub
