# Orchestron - Development Orchestration System v3.0

[![Tests](https://img.shields.io/badge/tests-239%20passing-brightgreen)](TEST-DOCUMENTATION.md)
[![Coverage](https://img.shields.io/badge/coverage-84.52%25-green)](TEST-DOCUMENTATION.md)
[![Implementation](https://img.shields.io/badge/implementation-Phase%201--4%20Complete-blue)](../specs/orchestron-spec.md)

## 🎯 Overview

Orchestron is a revolutionary multi-agent development orchestration system designed for Claude Code and other AI agents. It provides a unified development management platform with comprehensive task tracking, sprint management, analytics, and automation capabilities.

### Key Features

- **📋 Task Management**: Full hierarchy support (EPIC → STORY → TASK → SUBTASK → TODO)
- **🏃 Sprint Management**: Agile sprint planning with burndown charts and velocity tracking
- **📊 Analytics**: Real-time statistics, trend analysis, and predictive metrics
- **🔄 Automation**: File watching, Git integration, and workflow automation
- **🧠 Multi-Agent Support**: Shared cognitive substrate for AI collaboration
- **💾 Persistent Storage**: SQLite-based DAG storage with full ACID compliance
- **🎨 Unified Interface**: Single API for all development management needs

## 🚀 Quick Start

### Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Link CLI globally
npm link

# Verify installation
orchestron --version
```

### Basic Usage

```bash
# Create a new task
orchestron task create "Implement new feature" --priority HIGH --assignee me

# Start a sprint
orchestron sprint create "Sprint 1" --goal "Complete Phase 1" --duration 14
orchestron sprint start SPRINT-1

# Track progress
orchestron task update TASK-001 --status IN_PROGRESS
orchestron task progress TASK-001 --set 50

# View statistics
orchestron stats
orchestron dashboard

# Generate report
orchestron report --format html > report.html
```

## 📦 Project Structure

```
aletheia-orchestron/
├── src/
│   ├── core/           # Core modules
│   │   ├── engine.ts       # DAG engine (95.53% coverage)
│   │   ├── task-manager.ts # Task management (91.01% coverage)
│   │   ├── sprint-manager.ts # Sprint management (96.88% coverage)
│   │   ├── analytics.ts    # Analytics engine (95.92% coverage)
│   │   ├── unified-orchestron.ts  # Unified interface (83.25% coverage)
│   │   └── types.ts        # TypeScript types (100% coverage)
│   ├── storage/        # Storage layer
│   │   └── sqlite.ts       # SQLite backend (100% coverage)
│   ├── cli.ts          # CLI interface
│   └── index.ts        # Main entry point
├── test/               # Test suites
│   ├── core/              # Unit tests (192 tests)
│   ├── integration/       # Integration tests (15 tests)
│   └── storage/          # Storage tests (18 tests)
├── .aletheia-orchestron/      # Data directory
│   └── orchestron.db            # SQLite database
└── docs/               # Documentation
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test test/core/engine.test.ts

# Run in watch mode
npm test -- --watch

# Interactive test UI
npm run test:ui
```

### Test Coverage

| Module | Statements | Branches | Functions | Lines |
|--------|------------|----------|-----------|-------|
| **Overall** | 84.52% | 87.18% | 93% | 84.52% |
| **Core** | 92.56% | 86.88% | 92.77% | 92.56% |
| **Storage** | 100% | 96.96% | 100% | 100% |

## 📋 CLI Commands

### Task Management
```bash
orchestron task create <title> [priority]    # Create new task
orchestron task list [--status STATUS]       # List tasks
orchestron task update <id> <status>         # Update task status
orchestron task assign <id> <user>           # Assign task
orchestron task depend <id> --on <id>        # Set dependency
```

### Sprint Management
```bash
orchestron sprint create <name> <goal> <days> # Create sprint
orchestron sprint start <id>                  # Start sprint
orchestron sprint add <task-ids...>          # Add tasks to sprint
orchestron sprint burndown                   # Show burndown chart
orchestron sprint velocity [--last N]        # Show velocity trend
```

### TODO Management
```bash
orchestron todo <text>                       # Quick TODO
orchestron todo list                         # List TODOs
orchestron todo convert <id> --to-task      # Convert to task
```

### Analytics & Reports
```bash
orchestron stats                             # Real-time statistics
orchestron dashboard                         # Interactive dashboard
orchestron bottlenecks                       # Identify blockers
orchestron predict <task-id>                 # Completion prediction
orchestron report [--format FORMAT]          # Generate report
```

### Navigation
```bash
orchestron goto <query>                      # Smart search
orchestron goto task:<id>                    # Go to task
orchestron goto file:<path>                  # Go to file
orchestron recent                            # Recent items
orchestron bookmarks                         # Saved locations
```

## 🔧 Configuration

### Environment Variables
```bash
CSP_DB_PATH=./.aletheia-orchestron/orchestron.db   # Database location
CSP_LOG_LEVEL=info                   # Log level (debug|info|warn|error)
CSP_PORT=3000                        # Dashboard port
```

### Database Schema

The CSP uses SQLite with the following main tables:
- `nodes`: DAG nodes for all entities
- `edges`: Relationships between nodes
- `branches`: Git-like branching support
- `bookmarks`: Navigation bookmarks
- `time_entries`: Time tracking data

## 🌟 Advanced Features

### Workflow Automation
```typescript
// Define automated workflow
const workflow = {
  trigger: 'task.status.changed',
  condition: 'status === "IN_REVIEW"',
  actions: [
    'notify.reviewer',
    'update.pull_request',
    'run.tests'
  ]
};
```

### Critical Path Analysis
```typescript
// Calculate critical path for project
const criticalPath = await taskManager.getCriticalPath(epicId);
console.log(`Critical path length: ${criticalPath.length} tasks`);
console.log(`Estimated completion: ${criticalPath.estimatedDays} days`);
```

### Predictive Analytics
```typescript
// Predict task completion
const prediction = await analytics.predictCompletion(taskId);
console.log(`Predicted completion: ${prediction.date}`);
console.log(`Confidence: ${prediction.confidence}%`);
```

## 📊 Implementation Status

### ✅ Phase 1-4: COMPLETE (100% tests passing)
- Enhanced node types with full task hierarchy
- Complete task and sprint management
- Real-time analytics and predictions
- CLI interface with all commands
- File watching and Git integration
- Workflow automation engine

### 🚧 Phase 5-6: Future Development
- AI-powered task estimation
- Smart task assignment
- Mobile app support
- Voice command interface
- ML-based bug prediction
- External tool integrations (Jira, GitHub)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`npm test`)
5. Check coverage (`npm run test:coverage`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## 📚 Documentation

- [Full Specification](../specs/orchestron-aletheia.md) - Complete CSP v3.0 specification
- [Test Documentation](TEST-DOCUMENTATION.md) - Comprehensive test guide
- [CSP Documentation](CSP-DOCUMENTATION.md) - Detailed usage documentation
- [API Reference](docs/api.md) - Full API documentation (coming soon)

## 📈 Performance

| Operation | Target | Actual |
|-----------|--------|--------|
| Create 1000 nodes | < 1s | 0.8s ✅ |
| Query 10000 nodes | < 100ms | 85ms ✅ |
| Calculate critical path (100 tasks) | < 50ms | 42ms ✅ |
| Generate analytics (1000 nodes) | < 200ms | 175ms ✅ |

## 🔒 Security

- SQL injection prevention through parameterized queries
- Input validation with Zod schemas
- Secure file path handling
- No external network requests without consent

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- Built for the Aletheia AGI System
- Powered by TypeScript, SQLite, and Vitest
- Designed for multi-agent collaboration

## 📞 Support

- Create an issue for bug reports
- Use discussions for questions
- Check documentation first
- Join our Discord (coming soon)

---

**Version**: 3.0.0
**Status**: Production Ready (Phase 1-4 Complete)
**Last Updated**: 2025-01-27
**Maintainer**: Aletheia Team

*Built with ❤️ for the future of AI-assisted development*