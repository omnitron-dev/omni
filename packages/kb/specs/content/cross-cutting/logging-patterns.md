---
module: cross-cutting
title: "Structured Logging Patterns"
tags: [logging, pino, structured, correlation, rotation]
summary: "How logging works across the entire stack: pino structured JSON, child capture, rotation, CLI"
---

# Structured Logging

## Architecture

```
Child process (app)                 Parent (daemon)
  │                                    │
  pino (JSON stdout) ─── silent:true ──► readline capture
                                       │
                                       ├── Re-emit through parent logger
                                       │   (with correlation fields)
                                       │
                                       ├── ~/.omnitron/logs/{appName}.log
                                       │   (LogManager.appendToFile)
                                       │
                                       └── ~/.omnitron/logs/omnitron.log
                                           (daemon's own log via pino multistream)
```

## Using Logger in Services

```typescript
import { Logger } from '@omnitron-dev/titan/module/logger';

@Injectable()
export class OrderService {
  constructor(@Logger() private readonly logger: ILogger) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    this.logger.info({ dto }, 'Creating order');

    try {
      const order = await this.repo.create(dto);
      this.logger.info({ orderId: order.id }, 'Order created successfully');
      return order;
    } catch (err) {
      this.logger.error({ err, dto }, 'Failed to create order');
      throw err;
    }
  }
}
```

## Log Structure

All logs are structured JSON (pino format):

```json
{
  "level": 30,
  "time": 1711234567890,
  "pid": 12345,
  "hostname": "node-1",
  "msg": "Order created successfully",
  "orderId": "clz4k7m8t...",
  "childProcess": "main",
  "processId": 1,
  "processName": "main-worker-0"
}
```

## Correlation Fields

When logs are captured from child processes, the daemon adds:
- `childProcessId` — OS process ID
- `childProcess` — app name
- `processId` — omnitron process registry ID
- `processName` — human-readable name
- `stream` — stdout or stderr

## Log Levels

| Level | Value | When to use |
|-------|-------|-------------|
| `trace` | 10 | Detailed debugging (DI resolution, packet details) |
| `debug` | 20 | Development debugging |
| `info` | 30 | Normal operations (started, processed, completed) |
| `warn` | 40 | Non-critical issues (deprecated usage, retry) |
| `error` | 50 | Errors that need attention |
| `fatal` | 60 | App cannot continue |

## Best Practices

1. **Always pass context as first argument** (pino convention):
```typescript
// CORRECT
logger.info({ orderId, userId }, 'Order placed');

// WRONG — message only, no queryable context
logger.info('Order placed for user ' + userId);
```

2. **Pass errors as `err` property**:
```typescript
// CORRECT — pino serializes Error objects specially
logger.error({ err, context }, 'Operation failed');

// WRONG — error won't serialize properly
logger.error('Error: ' + error.message);
```

3. **Never log sensitive data**:
```typescript
// WRONG
logger.info({ password, token }, 'Auth attempt');

// CORRECT
logger.info({ username, hasToken: !!token }, 'Auth attempt');
```

## Log Rotation

- **Size-based**: Default 50MB per file, configurable
- **Max files**: 10 (oldest rotated out)
- **Gzip**: Optional compression of rotated files
- **Check interval**: Every 60 seconds for daemon log

## CLI Log Access

```bash
omnitron logs                  # Daemon logs (live)
omnitron logs main             # App logs (live)
omnitron logs main -f          # Follow/tail
omnitron logs main -n 100      # Last 100 lines
omnitron logs main -l error    # Only errors
omnitron logs main -g "timeout" # Grep pattern
omnitron logs main --file      # Force file mode (offline)
```
