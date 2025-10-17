# Meridian Quick Start Guide

## Prerequisites

- Rust 1.70+ with cargo installed
- Git (for history-related features)
- Claude Code or any MCP-compatible client

## Installation

### 1. Build Meridian

```bash
cd meridian
cargo build --release
```

The binary will be available at `target/release/meridian`.

### 2. Optional: Install System-Wide

```bash
# Install to ~/.cargo/bin (must be in PATH)
cargo install --path .

# Or create a symlink
sudo ln -s $(pwd)/target/release/meridian /usr/local/bin/meridian
```

## Running Meridian MCP Server

### Option 1: HTTP/SSE Transport (Recommended for Claude Code)

Start the server in HTTP mode:

```bash
# From the meridian directory
./target/release/meridian serve --http

# Or if installed system-wide
meridian serve --http
```

The server will start on `http://127.0.0.1:3000` (configurable in `meridian.toml`).

**Verify it's running:**

```bash
# Health check
curl http://127.0.0.1:3000/health

# Server info
curl http://127.0.0.1:3000/mcp/info

# Test MCP protocol
curl -X POST http://127.0.0.1:3000/mcp/request \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

### Option 2: STDIO Transport

Start the server in STDIO mode:

```bash
./target/release/meridian serve --stdio
```

This mode is useful for direct integration with MCP clients that support STDIO transport.

## Connecting Claude Code

### For HTTP Transport

1. **Start Meridian HTTP server:**

```bash
cd /path/to/meridian
./target/release/meridian serve --http
```

2. **Configure Claude Code to use the HTTP server:**

Claude Code will automatically discover HTTP MCP servers running on localhost. Alternatively, you can manually configure it by creating `.claude/mcp_config.json` in your project root:

```json
{
  "mcpServers": {
    "meridian": {
      "url": "http://127.0.0.1:3000/mcp",
      "transport": "http-sse"
    }
  }
}
```

3. **Verify Connection in Claude Code:**

Try asking Claude Code to use Meridian tools:
- "Use meridian to search for authentication functions"
- "Show me the MCP tools available"

### For STDIO Transport

1. **Create MCP configuration:**

Create or edit `.claude/mcp_config.json` in your project root:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "/path/to/meridian/target/release/meridian",
      "args": ["serve", "--stdio"],
      "transport": "stdio"
    }
  }
}
```

2. **Restart Claude Code** to pick up the new configuration.

## Configuration

Edit `meridian.toml` to customize Meridian's behavior:

```toml
[mcp.http]
enabled = true
host = "127.0.0.1"
port = 3000
cors_origins = ["*"]
max_connections = 100

[index]
languages = ["rust", "typescript", "javascript", "python", "go", "markdown"]
ignore = ["node_modules", "target", ".git", "dist", "build"]

[memory]
episodic_retention_days = 30
working_memory_size = "10MB"

[session]
max_sessions = 10
session_timeout = "1h"
```

## Available MCP Tools

Meridian provides 30 comprehensive MCP tools organized into categories:

### Memory Management (3 tools)
- `memory.record_episode` - Record task episodes for learning
- `memory.find_similar_episodes` - Find similar past tasks
- `memory.update_working_set` - Update active working context

### Context Management (2 tools)
- `context.prepare_adaptive` - Get optimized context for specific LLM
- `context.defragment` - Defragment scattered context

### Learning & Feedback (3 tools)
- `feedback.mark_useful` - Mark useful/unnecessary symbols
- `learning.train_on_success` - Train on successful solutions
- `predict.next_action` - Predict next likely action

### Attention-based Retrieval (2 tools)
- `attention.retrieve` - Retrieve based on attention patterns
- `attention.analyze_patterns` - Analyze attention patterns

### Code Navigation (4 tools)
- `code.search_symbols` - Search code symbols
- `code.get_definition` - Get symbol definition
- `code.find_references` - Find symbol references
- `code.get_dependencies` - Build dependency graph

### Documentation (2 tools)
- `docs.search` - Search documentation
- `docs.get_for_symbol` - Get docs for specific symbol

### History & Evolution (2 tools)
- `history.get_evolution` - Get file/symbol history
- `history.blame` - Git blame with context

### Session Management (4 tools)
- `session.begin` - Start new session
- `session.update` - Update session state
- `session.query` - Query in session context
- `session.complete` - Complete session (commit/discard)

### Analytics (2 tools)
- `analyze.complexity` - Analyze code complexity
- `analyze.token_cost` - Estimate token costs

### Monorepo Support (3 tools)
- `monorepo.list_projects` - List projects in monorepo
- `monorepo.set_context` - Set active project context
- `monorepo.find_cross_references` - Find cross-project references

## Testing the Installation

Run the test suite to verify everything works:

```bash
# Run all tests
cargo test

# Run only unit tests
cargo test --lib

# Run integration tests
cargo test --test integration_test

# Run e2e tests
cargo test --test e2e_new_mcp_tools
```

All tests should pass with output like:
```
test result: ok. 330+ passed; 0 failed
```

## Troubleshooting

### "Failed to connect" error

**Problem:** Claude Code shows "Failed to connect" when trying to use Meridian.

**Solution:**

1. **Verify server is running:**
   ```bash
   curl http://127.0.0.1:3000/health
   ```
   Should return: `{"status":"ok","service":"meridian-mcp","version":"0.1.0"}`

2. **Check the port:**
   - Default is 3000, verify in `meridian.toml` under `[mcp.http]`
   - Make sure no other service is using that port

3. **Check logs:**
   ```bash
   # Run with verbose logging
   RUST_LOG=debug ./target/release/meridian serve --http
   ```

4. **Firewall/Network:**
   - Ensure localhost connections are allowed
   - Try using `127.0.0.1` instead of `localhost`

### Server won't start

**Problem:** Server fails to start or crashes immediately.

**Solution:**

1. **Check configuration file:**
   ```bash
   # Validate meridian.toml syntax
   cat meridian.toml
   ```

2. **Check storage permissions:**
   ```bash
   # Ensure .meridian directory is writable
   ls -la .meridian/
   ```

3. **Clear corrupted index:**
   ```bash
   rm -rf .meridian/index
   ./target/release/meridian serve --http
   ```

### MCP tools not appearing in Claude Code

**Problem:** Claude Code doesn't show Meridian tools.

**Solution:**

1. **Verify MCP config:**
   ```bash
   cat .claude/mcp_config.json
   ```

2. **Check Claude Code logs** for connection errors

3. **Test MCP protocol directly:**
   ```bash
   curl -X POST http://127.0.0.1:3000/mcp/request \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   ```

4. **Restart Claude Code** after configuration changes

### Performance issues

**Problem:** Slow indexing or queries.

**Solution:**

1. **Increase cache size in `meridian.toml`:**
   ```toml
   [storage]
   cache_size = "512MB"  # Increase from default 256MB
   ```

2. **Add more directories to ignore:**
   ```toml
   [index]
   ignore = ["node_modules", "target", ".git", "dist", "build", ".next", "coverage"]
   ```

3. **Limit languages:**
   ```toml
   [index]
   languages = ["rust", "typescript"]  # Only index what you need
   ```

## Next Steps

- Read the [full specification](specs/spec.md) for detailed architecture
- Explore [test examples](tests/) to see how to use each tool
- Check [implementation status](specs/IMPLEMENTATION_STATUS.md) for features
- Review [final report](specs/FINAL_REPORT.md) for implementation details

## Support

- **Issues:** https://github.com/omnitron-dev/meridian/issues
- **Documentation:** See `specs/` directory
- **Architecture:** See `specs/spec.md`
