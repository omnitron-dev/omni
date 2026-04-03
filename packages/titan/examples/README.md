# Titan Framework Examples

Runnable examples demonstrating Titan's core features.

## Examples

### Simple Demo (`simple-demo.ts`)

Application lifecycle, module system, DI, events, configuration, logging.

```bash
npx tsx examples/simple-demo.ts
```

### Task Manager (`task-manager-app.ts`)

Multi-module architecture with services, event-driven workflows, notifications, and activity tracking.

```bash
npx tsx examples/task-manager-app.ts
```

## Concepts Covered

- `@Module`, `@Injectable`, `@Service` decorators
- Constructor and property injection via Nexus IoC
- `@EventHandler` and programmatic subscriptions
- `@ConfigValue` for typed configuration
- `OnInit` / `OnDestroy` lifecycle hooks
- Layered architecture: domain, service, orchestration, infrastructure
