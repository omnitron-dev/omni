# Titan Framework Examples

This directory contains comprehensive examples demonstrating the capabilities of the Titan framework.

## Examples

### 1. Simple Demo (`simple-demo.ts`)

A concise demonstration of core Titan features:
- Application lifecycle management
- Module system integration
- Service injection with Nexus IoC
- Event-driven architecture
- Configuration management
- Logging system

**Run the demo:**
```bash
npx ts-node examples/simple-demo.ts
```

### 2. Task Manager Application (`task-manager-app.ts`)

A complete task management system showcasing advanced features:
- Multi-module architecture
- Complex service dependencies
- Event-driven workflows
- Real-time notifications
- Activity tracking
- Business logic orchestration

**Features demonstrated:**
- User management
- Task CRUD operations
- Task assignment and status tracking
- Priority and due date management
- Activity logging
- Statistics and analytics
- Notification system

**Run the application:**
```bash
npx ts-node examples/task-manager-app.ts
```

## Key Concepts Demonstrated

### 1. Modular Architecture

Both examples show how to structure applications using Titan's module system:

```typescript
@Module({
  name: 'CoreModule',
  providers: [UserService, TaskService],
  exports: [UserService, TaskService]
})
export class CoreModule {}
```

### 2. Dependency Injection

Services are managed through Nexus IoC container with decorators:

```typescript
@Injectable()
@Service('TaskService@1.0.0')
export class TaskService {
  @Inject(LoggerService)
  private logger!: LoggerService;
  
  @ConfigValue('features.taskAssignment')
  private assignmentEnabled!: boolean;
}
```

### 3. Event-Driven Architecture

Event handling with decorators and programmatic subscriptions:

```typescript
@EventHandler('task.created')
async onTaskCreated(data: TaskCreatedEvent) {
  // Handle event
}

// Or programmatically
events.subscribe('task.*', handler, {
  filter: (data) => data.priority === 'high'
});
```

### 4. Configuration Management

Centralized configuration with type safety:

```typescript
const config = {
  app: {
    name: 'TaskManager',
    port: 3000
  },
  features: {
    taskAssignment: true,
    notifications: true
  }
};

// Access in services
@ConfigValue('features.taskAssignment')
private assignmentEnabled!: boolean;
```

### 5. Lifecycle Hooks

Services can implement lifecycle interfaces:

```typescript
@Injectable()
export class TaskService implements OnInit, OnDestroy {
  async onInit() {
    // Initialize service
  }
  
  async onDestroy() {
    // Cleanup resources
  }
}
```

## Architecture Patterns

### Service Layer Pattern

The Task Manager example demonstrates a layered architecture:

1. **Domain Layer**: Models and interfaces (`User`, `Task`)
2. **Service Layer**: Business logic (`TaskService`, `UserService`)
3. **Orchestration Layer**: Workflow coordination (`TaskOrchestrator`)
4. **Infrastructure Layer**: External services (`NotificationService`)
5. **Cross-cutting Concerns**: Logging, Events, Configuration

### Event Sourcing

The Activity Service demonstrates event sourcing patterns:

```typescript
@Injectable()
export class ActivityService {
  @EventHandler('task.created')
  async onTaskCreated(event: TaskEvent) {
    await this.recordActivity(event);
  }
  
  async getActivities(filters?: ActivityFilter) {
    return this.eventStore.query(filters);
  }
}
```

### Repository Pattern

Services abstract data access:

```typescript
export class TaskService {
  private tasks: Map<string, Task> = new Map();
  
  async findById(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }
  
  async findAll(filters?: TaskFilter): Promise<Task[]> {
    // Apply filters and return results
  }
}
```

## Testing Patterns

While not shown in these examples, Titan applications are highly testable:

```typescript
describe('TaskService', () => {
  let app: TitanApplication;
  let taskService: TaskService;
  
  beforeEach(async () => {
    app = await TitanApplication.create({
      modules: [TestModule]
    });
    taskService = app.get(TaskService);
  });
  
  it('should create task', async () => {
    const task = await taskService.create({
      title: 'Test Task',
      status: 'pending'
    });
    expect(task.id).toBeDefined();
  });
});
```

## Best Practices

1. **Use Modules**: Organize related services into modules
2. **Leverage DI**: Let the container manage dependencies
3. **Event-Driven**: Use events for loose coupling between modules
4. **Configuration**: Externalize configuration for different environments
5. **Type Safety**: Use TypeScript interfaces and decorators
6. **Error Handling**: Implement proper error boundaries
7. **Logging**: Use structured logging for debugging
8. **Testing**: Write unit tests for services and integration tests for workflows

## Next Steps

1. Explore the source code of each example
2. Modify the examples to add new features
3. Create your own Titan application
4. Refer to the main documentation for detailed API reference

## Resources

- [Titan Documentation](../README.md)
- [Nexus IoC Documentation](../../nexus/README.md)
- [API Reference](../docs/api.md)
- [Architecture Guide](../docs/architecture.md)