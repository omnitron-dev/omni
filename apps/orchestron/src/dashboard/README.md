# Orchestron Dashboard

## Overview
The Orchestron Dashboard is a web-based interface for the Orchestron development orchestration system. Built with Fastify 5.6.1, it provides real-time monitoring and management of development tasks, sprints, and project analytics.

## Features
- **Real-time Statistics**: Live updates of tasks, sprints, and velocity metrics
- **Task Management**: View and update task statuses
- **Sprint Tracking**: Monitor sprint progress with burndown charts
- **Bottleneck Detection**: Identify and resolve project blockers
- **Activity Feed**: Real-time stream of development activities
- **Command Interface**: Execute Orchestron commands directly from the dashboard
- **WebSocket Support**: Live updates without page refresh

## Technology Stack
- **Server**: Fastify 5.6.1 (high-performance Node.js web framework)
- **WebSocket**: Native WebSocket server for real-time communication
- **Validation**: Zod 4.1.11 for request/response schema validation
- **Logging**: Pino with pretty formatting
- **Static Files**: @fastify/static for serving the web interface

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the dashboard server (production)
npm run dashboard

# Start in development mode with hot reload
npm run dashboard:dev
```

## Configuration

### Environment Variables
- `ORCHESTRON_DASHBOARD_PORT`: Server port (default: 3001)
- `ORCHESTRON_DASHBOARD_HOST`: Server host (default: 0.0.0.0)
- `LOG_LEVEL`: Logging level (default: info)

### WebSocket
The WebSocket server runs on `PORT + 1` (default: 3002) for real-time updates.

## API Endpoints

### Dashboard & Statistics
- `GET /api/dashboard` - Get complete dashboard data
- `GET /api/stats` - Get project statistics

### Tasks
- `GET /api/tasks` - List tasks with optional filters
  - Query params: `status`, `priority`, `assignee`
- `GET /api/tasks/:id` - Get specific task details
- `PATCH /api/tasks/:id/status` - Update task status

### Sprints
- `GET /api/sprints` - List all sprints
- `GET /api/sprints/active` - Get active sprint
- `GET /api/sprints/:id/burndown` - Get sprint burndown data

### Analysis
- `GET /api/bottlenecks` - Get identified bottlenecks
- `GET /api/activity?limit=20` - Get recent activity

### Timers
- `POST /api/timers/start` - Start task timer
- `POST /api/timers/stop` - Stop task timer

### Workflows
- `GET /api/workflows` - List all workflows

### Command Execution
- `POST /api/command` - Execute Orchestron command
  ```json
  {
    "command": "task",
    "args": ["list"]
  }
  ```

## WebSocket Events

The dashboard listens for and handles the following real-time events:
- `task:created` - New task created
- `task:updated` - Task updated
- `task:completed` - Task completed
- `sprint:started` - Sprint started
- `sprint:ended` - Sprint ended
- `timer:started` - Timer started
- `timer:stopped` - Timer stopped
- `workflow:triggered` - Workflow triggered

## Web Interface

Access the dashboard at `http://localhost:3001` (or configured port).

### Features:
- **Statistics Widget**: Real-time task counts and velocity
- **Active Tasks**: List of in-progress tasks with priorities
- **Sprint Progress**: Visual progress bar and sprint metrics
- **Bottlenecks**: Highlighted issues requiring attention
- **Activity Feed**: Live stream of recent activities
- **Command Interface**: Execute Orchestron commands from the browser

## Development

### Project Structure
```
src/dashboard/
├── server.ts       # Fastify server implementation
├── public/         # Static web files
│   └── index.html  # Dashboard web interface
└── README.md       # This file
```

### Key Technologies Used
- **Fastify 5.6.1**: Modern web framework with excellent TypeScript support
- **Zod**: Schema validation replacing deprecated patterns
- **WebSocket**: Native WebSocket for real-time communication
- **Pino**: High-performance logging

### Type Safety
All API endpoints use Zod schemas for request/response validation:
- Query parameters are validated
- Request bodies are type-checked
- Errors return structured responses

## Security Considerations
- CORS is enabled for cross-origin requests
- Request validation prevents injection attacks
- Error messages don't expose sensitive information
- Graceful shutdown ensures data integrity

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Change port via environment variable
   ORCHESTRON_DASHBOARD_PORT=3002 npm run dashboard
   ```

2. **WebSocket Connection Failed**
   - Ensure WebSocket port (default: 3002) is not blocked
   - Check firewall settings

3. **Database Not Found**
   - Ensure Orchestron is initialized: `orchestron init`
   - Check `.orchestron/orchestron.db` exists

## License
MIT - Part of the Orchestron Development System