# Meridian Quick Start Guide

## 🚀 Immediate Usage with Claude Code

Meridian is a production-ready cognitive memory system for LLM codebase interaction.

### Prerequisites

- Rust 1.70+ and Cargo installed
- Claude Code CLI or compatible MCP client

### 1. Build Meridian (Release Mode)

```bash
cd meridian
cargo build --release
```

Binary location: `target/release/meridian`

### 2. Configure Claude Code

Create or update `.claude/mcp_config.json`:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "/absolute/path/to/meridian/target/release/meridian",
      "args": ["serve", "--stdio"],
      "env": {
        "RUST_LOG": "info"
      }
    }
  }
}
```

### 3. Test the Server

```bash
# Index current project
./target/release/meridian index . --force

# Check stats
./target/release/meridian stats

# Start server (for Claude Code)
./target/release/meridian serve --stdio
```

## 📋 Available Tools (30 total)

- **Memory**: record_episode, find_similar_episodes, update_working_set, get_statistics
- **Context**: prepare_adaptive, defragment, compress
- **Learning**: mark_useful, train_on_success, predict_next_action
- **Attention**: retrieve, analyze_patterns
- **Code**: search_symbols, get_definition, find_references, get_dependencies
- **Docs**: search, get_for_symbol
- **History**: get_evolution, blame
- **Session**: begin, update, query, complete
- **Analysis**: complexity, token_cost
- **Monorepo**: list_projects, set_context, find_cross_references

## ✅ Production Status

- ✅ **321 tests passing (100%)** - Unit + Integration + E2E coverage
- ✅ **All 30 MCP tools implemented** - Complete feature set
- ✅ **MCP 2024-11-05 spec compliant** - Custom implementation (not SDK)
- ✅ **Zero compiler warnings** - Clean release build
- ✅ **Thread-safe async** - DashMap, RwLock, Arc
- ✅ **Two transports** - STDIO (Claude Code) + HTTP/SSE (multi-project)

**Key Facts**:
- Custom MCP implementation (production-ready, no external SDK)
- 4-tier memory system (Episodic, Working, Semantic, Procedural)
- Token savings: 85-95% with intelligent compression
- Query performance: < 50ms typical

See `specs/FINAL_COMPLETION_REPORT.md` for full statistics.
