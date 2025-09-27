# Orchestron MCP Server Integration

## Overview

Orchestron includes a Model Context Protocol (MCP) server that enables Claude Code and other AI agents to interact with the development orchestration system.

## Features

### Available Tools (20+)

#### Task Management
- `task_create` - Create new tasks
- `task_update` - Update task status or progress
- `task_list` - List tasks with filters
- `task_get` - Get specific task details

#### Sprint Management
- `sprint_create` - Create new sprint
- `sprint_active` - Get active sprint

#### Session Management
- `session_start` - Start new session
- `session_end` - End session
- `context_save` - Save context for handoff
- `context_load` - Load previous context

#### Analytics
- `stats_get` - Get current statistics
- `bottlenecks_identify` - Find bottlenecks
- `predict_completion` - ML-powered predictions

#### Navigation
- `goto` - Navigate to items
- `recent` - Get recent items

### Available Resources (10+)

- `orchestron://dashboard` - Complete dashboard data
- `orchestron://stats` - Current statistics
- `orchestron://tasks` - All tasks
- `orchestron://sprints` - All sprints
- `orchestron://context` - Current context
- `orchestron://activity` - Recent activity
- `orchestron://bottlenecks` - Identified bottlenecks
- `orchestron://predictions` - ML predictions
- `orchestron://workflows` - Automation workflows
- `orchestron://handoff` - Session handoff info

## Installation

### 1. Build Orchestron

```bash
cd apps/orchestron
yarn build
# or
npm run build
```

### 2. Configure Claude Desktop

Add to your Claude Desktop config file (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "orchestron": {
      "command": "node",
      "args": ["/path/to/orchestron/dist/mcp/server.js"],
      "env": {
        "ORCHESTRON_STORAGE_PATH": ".orchestron"
      }
    }
  }
}
```

### 3. Test the Server

```bash
# Run standalone MCP server
yarn mcp:server
# or
npm run mcp:server
```

## Usage in Claude Code

Once configured, Claude Code can use Orchestron tools:

```typescript
// Create a task
await use_mcp_tool("orchestron", "task_create", {
  title: "Implement new feature",
  type: "TASK",
  priority: "HIGH"
});

// Check statistics
const stats = await use_mcp_tool("orchestron", "stats_get", {});

// Save context for handoff
await use_mcp_tool("orchestron", "context_save", {
  context: {
    currentTask: { id: "TASK-123", progress: 50 },
    completedSteps: ["API design", "Database schema"],
    nextSteps: ["Implement endpoints", "Write tests"]
  }
});
```

## Session Handoff Protocol

### Starting a Session

```typescript
const session = await use_mcp_tool("orchestron", "session_start", {
  agentId: "claude-1"
});
```

### Saving Context

```typescript
await use_mcp_tool("orchestron", "context_save", {
  sessionId: session.id,
  context: {
    // Your working context here
  }
});
```

### Loading Previous Context

```typescript
const context = await use_mcp_tool("orchestron", "context_load", {
  sessionId: previousSession.id
});
```

## Architecture

```
┌─────────────────────────────────────────┐
│         Claude Code / AI Agent           │
│                                          │
│  use_mcp_tool() / read_mcp_resource()   │
└─────────────────┬───────────────────────┘
                  │
                  │ MCP Protocol (stdio)
                  │
┌─────────────────▼───────────────────────┐
│       Orchestron MCP Server             │
│                                          │
│  ┌──────────┐    ┌──────────────────┐  │
│  │  Tools   │    │    Resources     │  │
│  └──────────┘    └──────────────────┘  │
│                                          │
│         UnifiedOrchestron API           │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│         SQLite Database                  │
│                                          │
│  Tasks, Sprints, Sessions, Context      │
└──────────────────────────────────────────┘
```

## Context Compression

The SessionManager automatically compresses context to stay within token limits:

- Target size: <4KB per context
- Keeps only essential information
- Summarizes verbose content
- Limits arrays to most recent/relevant items
- Truncates long strings

## Best Practices

1. **Start sessions** at the beginning of work
2. **Save context frequently** to enable recovery
3. **Use handoff protocol** when switching agents
4. **Check statistics** to understand project state
5. **Identify bottlenecks** regularly
6. **Load previous context** to continue work

## Troubleshooting

### Server Won't Start

- Ensure Orchestron is built: `yarn build`
- Check Node.js version: requires v22+
- Verify storage path exists and is writable

### Tools Not Available

- Restart Claude Desktop after config changes
- Check MCP server logs for errors
- Verify server is running: `yarn mcp:server`

### Context Too Large

- SessionManager automatically compresses
- Remove non-essential data from context
- Use summaries instead of full content

## Development

### Running in Development Mode

```bash
yarn mcp:dev
# or
npm run mcp:dev
```

### Testing Tools

```bash
# Test tool execution
node -e "
const { OrchestronMCPServer } = require('./dist/mcp/server');
const server = new OrchestronMCPServer();
server.test();
"
```

## Support

For issues or questions, please open an issue on the Orchestron repository.