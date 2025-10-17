# Meridian Quick Start Guide

## Prerequisites

- Rust 1.70+ with cargo installed
- Git (for history-related features)
- Claude Desktop or Claude Code (MCP-compatible client)

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

## Connecting to Claude

### For Claude Desktop (Recommended)

Claude Desktop uses the **STDIO transport** which is the official MCP standard.

1. **Find your Claude Desktop configuration file:**

   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. **Add Meridian to the configuration:**

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

**Important:** Replace the `command` path with the **absolute path** to your meridian binary!

3. **Restart Claude Desktop**

The Meridian server will start automatically when Claude Desktop launches.

### For Claude Code (CLI/Editor)

Claude Code uses project-scoped MCP configuration.

1. **Create `.mcp.json` in your project root:**

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

**Important:** Replace the `command` path with the **absolute path** to your meridian binary!

2. **Restart Claude Code or reload the project**

## Verification

Once configured, you can verify Meridian is working by asking Claude:

- "What MCP tools are available?"
- "Use meridian to search for functions in the codebase"
- "Show me the meridian resources"

Claude should list the Meridian tools and be able to use them.

## Configuration

Edit `meridian.toml` to customize Meridian's behavior:

```toml
[index]
languages = ["rust", "typescript", "javascript", "python", "go", "markdown"]
ignore = ["node_modules", "target", ".git", "dist", "build"]
max_file_size = "1MB"

[storage]
path = ".meridian/index"
cache_size = "256MB"

[memory]
episodic_retention_days = 30
working_memory_size = "10MB"
consolidation_interval = "1h"

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
- `memory.get_statistics` - Get memory system statistics

### Context Management (3 tools)
- `context.prepare_adaptive` - Get optimized context for specific LLM
- `context.defragment` - Defragment scattered context
- `context.compress` - Compress context using various strategies

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
# Run all tests (330+ tests)
cargo test

# Run only unit tests
cargo test --lib

# Run integration tests
cargo test --tests

# Run e2e tests
cargo test --test e2e_new_mcp_tools
```

All tests should pass with output like:
```
test result: ok. 330+ passed; 0 failed
```

## Troubleshooting

### MCP server not appearing in Claude

**Problem:** Claude Desktop or Claude Code doesn't show Meridian tools.

**Solution:**

1. **Check configuration path:**
   - Make sure you're editing the correct configuration file
   - Verify the JSON syntax is valid

2. **Verify absolute path:**
   ```bash
   # Get the absolute path
   cd /path/to/meridian
   pwd
   # Use this path + /target/release/meridian in the config
   ```

3. **Check Claude logs:**
   - **macOS**: `~/Library/Logs/Claude/mcp.log`
   - **Windows**: Check Event Viewer or Claude logs directory

4. **Test STDIO manually:**
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | ./target/release/meridian serve --stdio
   ```
   Should return a JSON response with capabilities.

5. **Restart Claude** after configuration changes

### Server crashes on startup

**Problem:** Server fails to start or crashes immediately.

**Solution:**

1. **Check storage permissions:**
   ```bash
   # Ensure .meridian directory is writable
   ls -la .meridian/
   chmod -R 755 .meridian/
   ```

2. **Clear corrupted index:**
   ```bash
   rm -rf .meridian/index
   ./target/release/meridian serve --stdio
   ```

3. **Check for RocksDB lock:**
   ```bash
   # If you see "lock hold by current process"
   rm -f .meridian/index/LOCK
   ```

### Multiple instances running

**Problem:** "lock hold by current process" error.

**Solution:**

Only one Meridian instance can access the database at a time. This is by design.

- STDIO mode is automatically managed by Claude (one instance per project)
- Don't manually run `meridian serve --stdio` if using with Claude
- HTTP mode is experimental and should not be used with Claude

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

## Advanced: HTTP Transport (For Testing Only)

⚠️ **Warning**: HTTP transport is **NOT** part of the official MCP standard and is **NOT** supported by Claude Desktop or Claude Code. It is provided only for manual testing and debugging.

### Starting HTTP Server

```bash
./target/release/meridian serve --http
```

Server will be available at `http://127.0.0.1:3000`

### Testing HTTP Endpoints

```bash
# Health check
curl http://127.0.0.1:3000/health

# Initialize
curl -X POST http://127.0.0.1:3000/mcp/request \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# List tools
curl -X POST http://127.0.0.1:3000/mcp/request \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## Next Steps

- Read the [full specification](specs/spec.md) for detailed architecture
- Explore [test examples](tests/) to see how to use each tool
- Check [implementation status](specs/IMPLEMENTATION_STATUS.md) for features
- Review [final report](specs/FINAL_REPORT.md) for implementation details

## Support

- **Issues**: https://github.com/omnitron-dev/meridian/issues
- **Documentation**: See `specs/` directory
- **Architecture**: See `specs/spec.md`
- **MCP Protocol**: https://modelcontextprotocol.io/
