# Orchestron MCP Server Integration Guide

## Overview

This guide describes a **realistic and implementable** approach to integrating Orchestron with Model Context Protocol (MCP) servers for multi-agent coordination and continuous development workflows.

## Current MCP Capabilities

### What MCP Actually Provides

The Model Context Protocol (MCP) is a standard for:
- **Tool Definition**: Exposing custom tools to AI models
- **Resource Management**: Providing access to files, databases, and APIs
- **Prompt Templates**: Sharing reusable prompts and contexts
- **Server Discovery**: Finding and connecting to MCP servers

### What MCP Does NOT Provide

- Real-time bidirectional communication between agents
- Direct agent-to-agent messaging
- Shared memory or state synchronization
- Agent orchestration or coordination

## Realistic MCP Integration Pattern

### Architecture

```
┌─────────────────────────────────────────────┐
│            Orchestron MCP Server             │
│                                              │
│  ┌──────────────┐    ┌──────────────┐      │
│  │   Resource   │    │     Tool     │      │
│  │   Provider   │    │   Provider   │      │
│  └──────────────┘    └──────────────┘      │
│           │                  │               │
│           └──────┬───────────┘               │
│                  │                           │
│       ┌──────────▼──────────┐                │
│       │   Orchestron API    │                │
│       └──────────┬──────────┘                │
│                  │                           │
│       ┌──────────▼──────────┐                │
│       │   SQLite Database   │                │
│       └─────────────────────┘                │
└─────────────────────────────────────────────┘
                    │
                    │ MCP Protocol
                    │
        ┌───────────▼───────────┐
        │    Claude Code CLI    │
        └───────────────────────┘
```

## Implementation

### 1. MCP Server Configuration

Create `orchestron-mcp-server.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OrchestronEngine } from './core/engine';
import { UnifiedOrchestron } from './core/unified-orchestron';
import { SQLiteStorage } from './storage/sqlite';

class OrchestronMCPServer {
  private server: Server;
  private orchestron: UnifiedOrchestron;

  constructor() {
    this.server = new Server(
      {
        name: 'orchestron',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize Orchestron
    const storage = new SQLiteStorage('.orchestron/orchestron.db');
    this.orchestron = new UnifiedOrchestron(storage);
  }

  async initialize() {
    await this.orchestron.initialize();
    this.setupTools();
    this.setupResources();
  }

  private setupTools() {
    // Task Management Tools
    this.server.setRequestHandler('tools/list', async () => ({
      tools: [
        {
          name: 'orchestron_task_create',
          description: 'Create a new task',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              type: { type: 'string', enum: ['EPIC', 'STORY', 'TASK', 'SUBTASK', 'TODO'] },
              description: { type: 'string' },
              priority: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
            },
            required: ['title', 'type'],
          },
        },
        {
          name: 'orchestron_task_list',
          description: 'List tasks',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              assignee: { type: 'string' },
              limit: { type: 'number' },
            },
          },
        },
        {
          name: 'orchestron_task_update',
          description: 'Update task status or progress',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              status: { type: 'string' },
              progress: { type: 'number' },
              notes: { type: 'string' },
            },
            required: ['taskId'],
          },
        },
        {
          name: 'orchestron_context_get',
          description: 'Get current development context',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'orchestron_context_save',
          description: 'Save current context for handoff',
          inputSchema: {
            type: 'object',
            properties: {
              context: { type: 'object' },
              notes: { type: 'string' },
            },
          },
        },
      ],
    }));

    // Tool execution handlers
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'orchestron_task_create':
          return await this.createTask(args);

        case 'orchestron_task_list':
          return await this.listTasks(args);

        case 'orchestron_task_update':
          return await this.updateTask(args);

        case 'orchestron_context_get':
          return await this.getContext();

        case 'orchestron_context_save':
          return await this.saveContext(args);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private setupResources() {
    this.server.setRequestHandler('resources/list', async () => ({
      resources: [
        {
          uri: 'orchestron://tasks/current',
          name: 'Current Tasks',
          mimeType: 'application/json',
          description: 'Tasks currently in progress',
        },
        {
          uri: 'orchestron://sprint/active',
          name: 'Active Sprint',
          mimeType: 'application/json',
          description: 'Current sprint information',
        },
        {
          uri: 'orchestron://context/latest',
          name: 'Latest Context',
          mimeType: 'application/json',
          description: 'Most recent development context',
        },
      ],
    }));

    this.server.setRequestHandler('resources/read', async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'orchestron://tasks/current':
          return {
            contents: [
              {
                text: JSON.stringify(await this.orchestron.getActiveTasks(), null, 2),
                mimeType: 'application/json',
              },
            ],
          };

        case 'orchestron://sprint/active':
          return {
            contents: [
              {
                text: JSON.stringify(await this.orchestron.getActiveSprint(), null, 2),
                mimeType: 'application/json',
              },
            ],
          };

        case 'orchestron://context/latest':
          return {
            contents: [
              {
                text: JSON.stringify(this.orchestron.getCurrentContext(), null, 2),
                mimeType: 'application/json',
              },
            ],
          };

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    });
  }

  // Tool implementation methods
  private async createTask(args: any) {
    const task = await this.orchestron.createTask(args);
    return {
      content: [
        {
          type: 'text',
          text: `Created task ${task.nodeId}: ${task.payload.title}`,
        },
      ],
    };
  }

  private async listTasks(args: any) {
    const tasks = await this.orchestron.searchTasks(args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(tasks, null, 2),
        },
      ],
    };
  }

  private async updateTask(args: any) {
    const { taskId, ...updates } = args;

    if (updates.status) {
      await this.orchestron.updateTaskStatus(taskId, updates.status);
    }

    if (updates.progress !== undefined) {
      await this.orchestron.updateTaskProgress(taskId, updates.progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Updated task ${taskId}`,
        },
      ],
    };
  }

  private async getContext() {
    const context = this.orchestron.getCurrentContext();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(context, null, 2),
        },
      ],
    };
  }

  private async saveContext(args: any) {
    // Save context for handoff between sessions
    const contextId = await this.orchestron.saveContext(args.context);
    return {
      content: [
        {
          type: 'text',
          text: `Context saved with ID: ${contextId}`,
        },
      ],
    };
  }

  async start() {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Orchestron MCP Server running on stdio');
  }
}

// Start server
const server = new OrchestronMCPServer();
server.start().catch(console.error);
```

### 2. MCP Client Configuration

Add to Claude Code configuration (`.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "orchestron": {
      "command": "node",
      "args": ["./orchestron-mcp-server.js"],
      "env": {
        "ORCHESTRON_DB": ".orchestron/orchestron.db"
      }
    }
  }
}
```

### 3. Usage in Claude Code

Once configured, Claude Code can use Orchestron tools:

```python
# Claude can now use MCP tools directly
task = await use_mcp_tool("orchestron_task_create", {
  "title": "Implement authentication",
  "type": "TASK",
  "priority": "HIGH",
  "description": "Add JWT-based authentication to the API"
})

# List current tasks
tasks = await use_mcp_tool("orchestron_task_list", {
  "status": "IN_PROGRESS",
  "assignee": "claude"
})

# Update progress
await use_mcp_tool("orchestron_task_update", {
  "taskId": "TASK-123",
  "progress": 60,
  "notes": "Completed API endpoints, working on frontend"
})

# Get context from previous session
context = await use_mcp_tool("orchestron_context_get", {})

# Save context for next session
await use_mcp_tool("orchestron_context_save", {
  "context": {
    "currentTask": "TASK-123",
    "completedSteps": ["API design", "Database schema"],
    "nextSteps": ["Frontend implementation", "Testing"],
    "decisions": {
      "auth": "Using JWT with refresh tokens",
      "database": "PostgreSQL for users, Redis for sessions"
    }
  },
  "notes": "Ready for frontend work"
})
```

## Practical Multi-Session Workflow

### Session 1: Morning Work

```python
# Start of session
context = await use_mcp_tool("orchestron_context_get", {})
print(f"Resuming from: {context['lastSession']}")

# Pick up task
tasks = await use_mcp_tool("orchestron_task_list", {
  "status": "IN_PROGRESS",
  "assignee": "claude"
})

if not tasks:
  # Get new task from backlog
  tasks = await use_mcp_tool("orchestron_task_list", {
    "status": "TODO",
    "limit": 1
  })

  if tasks:
    await use_mcp_tool("orchestron_task_update", {
      "taskId": tasks[0]["id"],
      "status": "IN_PROGRESS"
    })

# Work on task...
# ... implement features ...

# Save progress
await use_mcp_tool("orchestron_task_update", {
  "taskId": current_task_id,
  "progress": 40,
  "notes": "Completed backend API, database schema ready"
})

# Save context for next session
await use_mcp_tool("orchestron_context_save", {
  "context": {
    "lastTask": current_task_id,
    "completedToday": ["API endpoints", "Database migrations"],
    "blockers": [],
    "nextSteps": ["Write tests", "Frontend integration"]
  }
})
```

### Session 2: Afternoon Continuation

```python
# New session, possibly different agent
context = await use_mcp_tool("orchestron_context_get", {})

# Review what was done
print(f"Previous session completed: {context['completedToday']}")
print(f"Next steps: {context['nextSteps']}")

# Continue work
task_id = context["lastTask"]
await use_mcp_tool("orchestron_task_update", {
  "taskId": task_id,
  "progress": 70,
  "notes": "Tests written, starting frontend"
})

# Complete task
await use_mcp_tool("orchestron_task_update", {
  "taskId": task_id,
  "status": "IN_REVIEW",
  "progress": 100,
  "notes": "Ready for code review"
})

# Pick next task
next_task = await use_mcp_tool("orchestron_task_list", {
  "status": "TODO",
  "limit": 1
})
```

## Human Intervention via MCP

### Asynchronous Updates

While Claude is working, humans can update the Orchestron database directly:

```bash
# Human adds clarification via CLI
orchestron task clarify TASK-123 \
  "Use OAuth2 for third-party integrations"

# Human changes priority
orchestron task priority TASK-124 --set CRITICAL

# Human adds dependency
orchestron task depend TASK-125 --on TASK-123
```

Claude will see these updates on the next MCP tool call:

```python
# Claude checks for updates periodically
task = await use_mcp_tool("orchestron_task_get", {
  "taskId": current_task_id
})

if task.get("clarifications"):
  print(f"New clarification: {task['clarifications']}")
  # Adjust implementation accordingly
```

## Limitations and Workarounds

### Current Limitations

1. **No Real-Time Updates**: MCP is request-response only
2. **No Direct Agent Communication**: Agents can't message each other
3. **No Push Notifications**: Can't alert Claude to changes
4. **Stateless Protocol**: Each request is independent

### Practical Workarounds

1. **Polling for Updates**:
```python
# Check for updates every 30 minutes
if time_since_last_check > 30_minutes:
  updates = await use_mcp_tool("orchestron_check_updates", {})
  if updates:
    apply_updates(updates)
```

2. **Context Checkpoints**:
```python
# Save context at key points
after_major_change:
  await use_mcp_tool("orchestron_context_save", {
    "context": current_state,
    "checkpoint": "After authentication implementation"
  })
```

3. **Task Handoff Protocol**:
```python
# Before ending session
await use_mcp_tool("orchestron_handoff_prepare", {
  "taskId": current_task_id,
  "completedWork": ["API", "Database", "Basic tests"],
  "remainingWork": ["UI polish", "Integration tests"],
  "notes": "Auth flow works, needs error handling improvements"
})
```

## Best Practices

### 1. Frequent Context Saves

Save context after each significant milestone:

```python
# After completing a module
await use_mcp_tool("orchestron_context_save", {
  "context": {
    "milestone": "Authentication module complete",
    "timestamp": datetime.now().isoformat(),
    "files_modified": ["auth.ts", "user.model.ts"],
    "tests_passing": True
  }
})
```

### 2. Clear Task Boundaries

Keep tasks focused and well-defined:

```python
# Good: Specific, measurable task
task = await use_mcp_tool("orchestron_task_create", {
  "title": "Add password reset endpoint",
  "type": "TASK",
  "acceptance_criteria": [
    "POST /api/auth/reset-password endpoint",
    "Email notification sent",
    "Token expires in 1 hour",
    "Unit tests pass"
  ]
})

# Bad: Vague, unbounded task
# "Improve authentication"
```

### 3. Progressive Enhancement

Start with basic MCP integration, add features gradually:

```python
# Phase 1: Basic task tracking
basic_tools = ["task_create", "task_list", "task_update"]

# Phase 2: Add context management
add_tools = ["context_save", "context_load"]

# Phase 3: Add analytics
advanced_tools = ["predict_completion", "analyze_bottlenecks"]
```

## Testing MCP Integration

### Unit Tests for MCP Server

```typescript
describe('Orchestron MCP Server', () => {
  let server: OrchestronMCPServer;

  beforeEach(async () => {
    server = new OrchestronMCPServer(':memory:');
    await server.initialize();
  });

  test('should create task via MCP', async () => {
    const result = await server.handleToolCall({
      name: 'orchestron_task_create',
      arguments: {
        title: 'Test task',
        type: 'TASK',
      },
    });

    expect(result.content[0].text).toContain('Created task');
  });

  test('should list tasks via MCP', async () => {
    // Create test task first
    await server.handleToolCall({
      name: 'orchestron_task_create',
      arguments: { title: 'Test', type: 'TASK' },
    });

    const result = await server.handleToolCall({
      name: 'orchestron_task_list',
      arguments: { status: 'TODO' },
    });

    const tasks = JSON.parse(result.content[0].text);
    expect(tasks).toHaveLength(1);
  });
});
```

### Integration Tests

```bash
#!/bin/bash
# test-mcp-integration.sh

# Start MCP server
node orchestron-mcp-server.js &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Test tool calls via MCP client
mcp-client call orchestron orchestron_task_create \
  '{"title": "Test task", "type": "TASK"}'

# Check task was created
TASKS=$(mcp-client call orchestron orchestron_task_list '{}')
if [[ $TASKS == *"Test task"* ]]; then
  echo "✅ MCP integration working"
else
  echo "❌ MCP integration failed"
fi

# Cleanup
kill $SERVER_PID
```

## Conclusion

This MCP integration provides a **realistic and implementable** way to:

1. **Persist state** between Claude Code sessions
2. **Share context** across multiple sessions
3. **Track progress** on long-running projects
4. **Enable handoffs** between different agents or sessions
5. **Allow human intervention** through database updates

While it doesn't provide real-time agent-to-agent communication or push notifications, it offers a solid foundation for continuous development workflows with Claude Code that can be implemented today with existing MCP capabilities.