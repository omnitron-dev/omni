# MCP Integration Guide

**Version**: 2.0.0
**Last Updated**: October 18, 2025
**Status**: Production-Ready
**Audience**: Developers, Integration Engineers

---

## Table of Contents

1. [Introduction](#introduction)
2. [MCP Protocol Overview](#mcp-protocol-overview)
3. [Server Configuration](#server-configuration)
4. [Transport Modes](#transport-modes)
5. [Tool Usage Examples](#tool-usage-examples)
6. [Integration with Claude Code](#integration-with-claude-code)
7. [Integration with Other Clients](#integration-with-other-clients)
8. [Custom Tool Development](#custom-tool-development)
9. [Troubleshooting](#troubleshooting)

---

## Introduction

### What is MCP?

**Model Context Protocol (MCP)** is a standardized protocol for connecting AI assistants to external tools and data sources. Meridian implements MCP to provide Claude and other LLMs with intelligent code navigation and memory capabilities.

**Key Features**:
- **Standardized**: Based on MCP Protocol 2025-03-26
- **Transport Agnostic**: STDIO, HTTP/SSE, or WebSocket
- **Tool-Based**: 49 production-ready tools
- **Type-Safe**: Full JSON-RPC 2.0 compliance

### Meridian MCP Server

**Custom Implementation**: Not SDK-based, optimized for performance

**Capabilities**:
- 29 core tools (production-ready)
- 10 documentation tools (catalog, docs, examples, tests)
- 10 specification tools
- Custom memory system integration
- Adaptive context management

**Performance**:
- <50ms average latency
- <10ms for cache hits
- Supports 100+ concurrent requests

---

## MCP Protocol Overview

### Protocol Specification

**Version**: MCP 2025-03-26

**Standard**: JSON-RPC 2.0

**Transport**: STDIO (primary), HTTP/SSE, WebSocket

### Message Format

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "code.search_symbols",
    "arguments": {
      "query": "Application",
      "type": ["class"],
      "max_results": 5
    }
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"symbols\":[...],\"total_tokens\":245,\"truncated\":false}"
      }
    ]
  }
}
```

**Error**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params: missing 'query' field"
  }
}
```

### Lifecycle

```
Client                        Server
  |                              |
  |--- initialize ------------>  |
  |<-- initialized ------------  |
  |                              |
  |--- tools/list ------------>  |
  |<-- [tool list] -----------   |
  |                              |
  |--- tools/call ------------>  |
  |<-- result ----------------   |
  |                              |
  |--- shutdown -------------->  |
  |<-- bye -------------------   |
```

---

## Server Configuration

### Global Configuration

**File**: `~/.meridian/meridian.toml`

```toml
[server]
host = "localhost"
port = 7878
daemon = true
auto_start = true

[mcp]
# MCP-specific settings
transport = "stdio"  # or "http" or "websocket"
max_connections = 100
request_timeout_ms = 30000
enable_streaming = false

[logging]
level = "info"
file = "~/.meridian/logs/mcp-server.log"
```

### Local Configuration

**File**: `[monorepo]/.meridian/meridian.toml`

```toml
[monorepo]
id = "frontend-app"
name = "Frontend Application"

[mcp]
enable_cross_monorepo_docs = true
include_external_sources = true
scope = "dependencies"  # local | dependencies | global

[cache]
enabled = true
ttl_hours = 24
cache_external_deps = true
```

### Environment Variables

```bash
# Global server URL
export MERIDIAN_GLOBAL_SERVER="http://localhost:7878"

# Log level
export RUST_LOG="meridian=debug"

# Disable global server (local only)
export MERIDIAN_OFFLINE_MODE=true

# Custom config path
export MERIDIAN_CONFIG_PATH="/custom/path/meridian.toml"
```

---

## Transport Modes

### STDIO (Default)

**Use Case**: Integration with Claude Code, command-line tools

**Advantages**:
- Simple setup
- No network configuration
- Process-level isolation

**Disadvantages**:
- Single client only
- No remote access

**Configuration**:
```json
// .claude.json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "cwd": "/path/to/monorepo"
    }
  }
}
```

**Starting**:
```bash
meridian serve --stdio
```

**Testing**:
```bash
# Send initialize request
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | meridian serve --stdio

# Expected response:
# {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26",...}}
```

### HTTP/SSE

**Use Case**: Multiple clients, web-based integrations, remote access

**Advantages**:
- Multiple clients supported
- Remote access
- RESTful interface

**Disadvantages**:
- More complex setup
- Network security considerations

**Configuration**:
```toml
# ~/.meridian/meridian.toml
[mcp]
transport = "http"
http_port = 8080
enable_cors = true
allowed_origins = ["http://localhost:3000"]
```

**Starting**:
```bash
meridian serve --http --port 8080
```

**Client Connection**:
```javascript
// JavaScript/TypeScript client
const response = await fetch('http://localhost:8080/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'code.search_symbols',
      arguments: { query: 'Application' }
    }
  })
});

const result = await response.json();
console.log(result);
```

### WebSocket

**Use Case**: Real-time updates, bidirectional communication

**Advantages**:
- Real-time updates
- Bidirectional communication
- Efficient for long-running sessions

**Disadvantages**:
- More complex client implementation

**Configuration**:
```toml
[mcp]
transport = "websocket"
ws_port = 8081
```

**Starting**:
```bash
meridian serve --websocket --port 8081
```

**Client Connection**:
```javascript
const ws = new WebSocket('ws://localhost:8081/mcp');

ws.onopen = () => {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' }
  }));
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log(response);
};
```

---

## Tool Usage Examples

### Category 1: Memory Management

#### `memory.record_episode`

**Description**: Record a task episode for learning

**Example**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "memory.record_episode",
    "arguments": {
      "task": "Add authentication to API",
      "files_accessed": ["src/auth.ts", "src/middleware.ts"],
      "solution": "Implemented JWT-based authentication",
      "outcome": "success"
    }
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"episode_id\":\"ep_123\",\"patterns_extracted\":[...],\"suggestions\":[...]}"
    }]
  }
}
```

#### `memory.find_similar_episodes`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "memory.find_similar_episodes",
    "arguments": {
      "task_description": "Add new API endpoint",
      "limit": 3
    }
  }
}
```

### Category 2: Code Navigation

#### `code.search_symbols`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "code.search_symbols",
    "arguments": {
      "query": "Application",
      "type": ["class"],
      "scope": "src/",
      "detail_level": "interface",
      "max_results": 5
    }
  }
}
```

**Response**:
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"symbols\":[{\"id\":\"...\",\"name\":\"Application\",\"kind\":\"class\",\"location\":{\"file\":\"src/app.ts\",\"line\":15},\"signature\":\"class Application { ... }\"}],\"total_tokens\":245,\"truncated\":false}"
    }]
  }
}
```

#### `code.get_definition`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "code.get_definition",
    "arguments": {
      "symbol_id": "src/app.ts:Application",
      "include_body": true,
      "include_references": true
    }
  }
}
```

#### `code.find_references`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "code.find_references",
    "arguments": {
      "symbol_id": "src/app.ts:Application",
      "include_context": true,
      "group_by_file": true
    }
  }
}
```

### Category 3: Session Management

#### Complete Session Workflow

```javascript
// 1. Start session
const beginResult = await mcp.call('session.begin', {
  task_description: 'Refactor authentication module',
  scope: ['src/auth/']
});

const sessionId = beginResult.session_id;

// 2. Update file
await mcp.call('session.update', {
  session_id: sessionId,
  path: 'src/auth.ts',
  content: updatedCode,
  reindex: true
});

// 3. Query within session
const queryResult = await mcp.call('session.query', {
  session_id: sessionId,
  query: 'functions calling authenticate',
  prefer_session: true
});

// 4. Complete session
await mcp.call('session.complete', {
  session_id: sessionId,
  action: 'commit',
  commit_message: 'Refactor authentication module'
});
```

### Category 4: Documentation

#### `docs.search`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "docs.search",
    "arguments": {
      "query": "authentication flow",
      "max_results": 10,
      "scope": "src/auth/"
    }
  }
}
```

#### `docs.get_for_symbol`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "docs.get_for_symbol",
    "arguments": {
      "symbol_id": "src/auth.ts:authenticate",
      "include_examples": true
    }
  }
}
```

### Category 5: Context Management

#### `context.prepare_adaptive`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "context.prepare_adaptive",
    "arguments": {
      "request": {
        "files": ["src/app.ts"],
        "symbols": ["Application"],
        "scope": "related"
      },
      "model": "claude-3",
      "available_tokens": 100000
    }
  }
}
```

**Response**:
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"context\":{...},\"compression_ratio\":0.15,\"strategy_used\":\"hybrid\",\"quality_score\":0.92}"
    }]
  }
}
```

### Category 6: Global Tools (Cross-Monorepo)

#### `global.search_all_projects`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "global.search_all_projects",
    "arguments": {
      "query": "authentication",
      "type": "typescript"
    }
  }
}
```

#### `external.get_documentation`

**Example**:
```json
{
  "method": "tools/call",
  "params": {
    "name": "external.get_documentation",
    "arguments": {
      "projectId": "@external/auth-lib",
      "symbolName": "authenticate",
      "includeExamples": true,
      "includeSource": false
    }
  }
}
```

---

## Integration with Claude Code

### Setup

**1. Install Claude Code**:
```bash
npm install -g @anthropic/claude-cli
```

**2. Configure MCP Server**:

Create `.claude.json` in your project root:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "cwd": "/absolute/path/to/monorepo",
      "env": {
        "RUST_LOG": "info",
        "MERIDIAN_GLOBAL_SERVER": "http://localhost:7878"
      }
    }
  }
}
```

**3. Start Claude Code**:
```bash
cd /path/to/monorepo
claude code
```

### Usage Patterns

#### Pattern 1: Code Exploration

```
User: Show me all classes in this project

Claude uses: code.search_symbols
Arguments: { query: "*", type: ["class"] }

User: Tell me about the Application class

Claude uses: code.get_definition
Arguments: { symbol_id: "src/app.ts:Application" }

User: Where is Application used?

Claude uses: code.find_references
Arguments: { symbol_id: "src/app.ts:Application" }
```

#### Pattern 2: Session-Based Refactoring

```
User: Let's refactor the auth module

Claude uses: session.begin
Arguments: { task_description: "Refactor auth module" }

User: Show me the current auth code

Claude uses: code.search_symbols
Arguments: { query: "*", scope: "src/auth/" }

[User makes changes in editor]

User: Update the session with my changes

Claude uses: session.update
Arguments: { session_id: "...", path: "src/auth.ts", content: "..." }

User: Commit these changes

Claude uses: session.complete
Arguments: { session_id: "...", action: "commit" }
```

#### Pattern 3: Learning from History

```
User: Have we done something like adding a new API endpoint before?

Claude uses: memory.find_similar_episodes
Arguments: { task_description: "Add new API endpoint" }

Claude: Yes, here are 3 similar tasks...

User: What's the recommended approach?

Claude: Based on past patterns, here's what typically works...
```

### Advanced Configuration

**Multi-Monorepo**:
```json
{
  "mcpServers": {
    "meridian-frontend": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "cwd": "/path/to/frontend-monorepo"
    },
    "meridian-backend": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "cwd": "/path/to/backend-monorepo"
    }
  }
}
```

**Custom Settings**:
```json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": [
        "serve",
        "--stdio",
        "--cache-size", "512",
        "--max-results", "20"
      ],
      "cwd": "/path/to/monorepo",
      "env": {
        "RUST_LOG": "debug",
        "MERIDIAN_OFFLINE_MODE": "false"
      }
    }
  }
}
```

---

## Integration with Other Clients

### Python Client

```python
import json
import subprocess

class MeridianClient:
    def __init__(self, monorepo_path):
        self.proc = subprocess.Popen(
            ['meridian', 'serve', '--stdio'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=monorepo_path,
            text=True
        )
        self.id_counter = 0
        self._initialize()

    def _initialize(self):
        self.call_method('initialize', {
            'protocolVersion': '2025-03-26',
            'capabilities': {},
            'clientInfo': {'name': 'python-client', 'version': '1.0'}
        })

    def call_method(self, method, params=None):
        self.id_counter += 1
        request = {
            'jsonrpc': '2.0',
            'id': self.id_counter,
            'method': method,
            'params': params or {}
        }

        self.proc.stdin.write(json.dumps(request) + '\n')
        self.proc.stdin.flush()

        response = json.loads(self.proc.stdout.readline())
        return response.get('result') or response.get('error')

    def search_symbols(self, query, **kwargs):
        return self.call_method('tools/call', {
            'name': 'code.search_symbols',
            'arguments': {'query': query, **kwargs}
        })

    def close(self):
        self.proc.terminate()

# Usage
client = MeridianClient('/path/to/monorepo')
result = client.search_symbols('Application', type=['class'])
print(result)
client.close()
```

### TypeScript/Node.js Client

```typescript
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

class MeridianClient extends EventEmitter {
  private proc: ChildProcess;
  private idCounter = 0;
  private pending = new Map<number, { resolve: Function; reject: Function }>();

  constructor(monorepoPath: string) {
    super();
    this.proc = spawn('meridian', ['serve', '--stdio'], {
      cwd: monorepoPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.proc.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.handleResponse(JSON.parse(line));
      }
    });

    this.initialize();
  }

  private async initialize() {
    await this.callMethod('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'ts-client', version: '1.0' }
    });
  }

  private handleResponse(response: any) {
    const handler = this.pending.get(response.id);
    if (handler) {
      if (response.error) {
        handler.reject(new Error(response.error.message));
      } else {
        handler.resolve(response.result);
      }
      this.pending.delete(response.id);
    }
  }

  callMethod(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.idCounter;
      this.pending.set(id, { resolve, reject });

      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params: params || {}
      };

      this.proc.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  async searchSymbols(query: string, options?: any) {
    return this.callMethod('tools/call', {
      name: 'code.search_symbols',
      arguments: { query, ...options }
    });
  }

  close() {
    this.proc.kill();
  }
}

// Usage
const client = new MeridianClient('/path/to/monorepo');
const result = await client.searchSymbols('Application', { type: ['class'] });
console.log(result);
client.close();
```

### REST API Client (HTTP Mode)

```bash
# Start Meridian in HTTP mode
meridian serve --http --port 8080
```

```bash
# Call tool via curl
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "code.search_symbols",
      "arguments": {
        "query": "Application",
        "type": ["class"]
      }
    }
  }'
```

---

## Custom Tool Development

### Adding a New Tool

**1. Define Tool Schema**:

Edit `src/mcp/tools.rs`:

```rust
// Add to tool list
pub const CUSTOM_TOOL: &str = "custom.my_tool";

// Implement handler
impl MeridianServer {
    async fn handle_custom_tool(&self, args: Value) -> Result<CallToolResult> {
        // Parse arguments
        let param = args.get("param")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("Missing 'param' argument"))?;

        // Execute logic
        let result = self.custom_logic(param).await?;

        // Return result
        Ok(CallToolResult {
            content: vec![ToolResponseContent::Text {
                text: serde_json::to_string(&result)?
            }],
            is_error: None
        })
    }

    async fn custom_logic(&self, param: &str) -> Result<CustomResult> {
        // Implementation
        Ok(CustomResult {
            data: format!("Processed: {}", param)
        })
    }
}
```

**2. Register Tool**:

```rust
// In list_tools() method
Tool {
    name: CUSTOM_TOOL.to_string(),
    description: Some("My custom tool description".to_string()),
    input_schema: json!({
        "type": "object",
        "properties": {
            "param": {
                "type": "string",
                "description": "Parameter description"
            }
        },
        "required": ["param"]
    })
}
```

**3. Wire Up Handler**:

```rust
// In handle_call_tool() method
match tool_name.as_str() {
    // ... existing tools
    CUSTOM_TOOL => self.handle_custom_tool(arguments).await?,
    _ => return Err(anyhow!("Unknown tool: {}", tool_name))
}
```

**4. Add Tests**:

```rust
#[tokio::test]
async fn test_custom_tool() {
    let server = create_test_server();

    let result = server.handle_custom_tool(json!({
        "param": "test"
    })).await.unwrap();

    assert!(result.content.len() > 0);
}
```

**5. Document**:

Add to `schemas/mcp-tools-catalog.md`:

```markdown
#### `custom.my_tool`

**Status**: ✅ Implemented

**Description**: My custom tool description

**Input**:
```typescript
{
  param: string;
}
```

**Output**:
```typescript
{
  data: string;
}
```
```

---

## Troubleshooting

### Issue 1: Connection Refused

**Symptom**: Client can't connect to MCP server

**Diagnosis**:
```bash
# Check if server is running
ps aux | grep meridian

# Test STDIO manually
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | meridian serve --stdio

# Check HTTP endpoint
curl http://localhost:8080/health
```

**Solution**:
```bash
# Restart server
pkill meridian
meridian serve --stdio

# Or for HTTP
meridian serve --http --port 8080
```

### Issue 2: Tool Not Found

**Symptom**: `Unknown tool: code.search_symbols`

**Diagnosis**:
```bash
# List available tools
meridian tools list

# Check tool registration
meridian tools info code.search_symbols
```

**Solution**: Ensure Meridian is up to date
```bash
meridian --version
cargo update  # If building from source
```

### Issue 3: Invalid Arguments

**Symptom**: `Invalid params: missing 'query' field`

**Diagnosis**: Check argument schema

```bash
# Get tool schema
meridian tools schema code.search_symbols
```

**Solution**: Match arguments to schema exactly

### Issue 4: Timeout

**Symptom**: Request times out after 30s

**Configuration**:
```toml
# ~/.meridian/meridian.toml
[mcp]
request_timeout_ms = 60000  # Increase to 60s
```

### Issue 5: Memory Leak

**Symptom**: Server memory grows over time

**Diagnosis**:
```bash
# Monitor memory
watch -n 1 'ps aux | grep meridian'

# Check cache size
meridian cache stats
```

**Solution**:
```bash
# Clear cache periodically
meridian cache clear

# Reduce cache size
# Edit ~/.meridian/meridian.toml
[cache]
max_cache_size_mb = 256
```

### Getting Support

**Logs**:
```bash
tail -f ~/.meridian/logs/mcp-server.log
```

**Debug Mode**:
```bash
RUST_LOG=debug meridian serve --stdio
```

**Report Issues**:
- Include: Meridian version, client type, request/response, logs
- GitHub: https://github.com/yourusername/meridian/issues

---

## Related Documentation

- **[Getting Started Guide](./getting-started.md)**: Installation and first steps
- **[Multi-Monorepo Setup](./multi-monorepo-setup.md)**: Global server configuration
- **[MCP Tools Catalog](../schemas/mcp-tools-catalog.md)**: Complete tool reference
- **[Core Specification](../spec.md)**: Architecture deep dive

---

**Guide Version**: 1.0.0
**Meridian Version**: 2.0.0
**MCP Protocol**: 2025-03-26
**Last Updated**: October 18, 2025
