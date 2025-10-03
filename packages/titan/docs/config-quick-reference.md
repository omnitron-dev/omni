# Titan Config Module - Quick Reference

## Quick Start

```typescript
import { ConfigModule } from '@omnitron-dev/titan/modules/config';

// Basic setup
ConfigModule.forRoot({
  sources: [
    { type: 'file', path: './config.json' },
    { type: 'env', prefix: 'APP_' }
  ]
})
```

## Common Patterns

### 1. Property Injection
```typescript
@Injectable()
class Service {
  @Config('app.port', 3000)
  private port: number;
}
```

### 2. Constructor Injection
```typescript
constructor(
  @Config('database.host') private dbHost: string,
  @InjectConfig() private config: ConfigService
) {}
```

### 3. Typed Configuration
```typescript
const schema = z.object({
  port: z.number(),
  host: z.string()
});

const config = configService.getTyped(schema);
```

### 4. Watch Changes
```typescript
@ConfigWatch('feature.enabled')
onFeatureToggle(enabled: boolean) {
  // React to change
}
```

## Configuration Sources Priority

```typescript
sources: [
  { type: 'file', path: 'default.json' },     // 1. Lowest
  { type: 'file', path: 'env.json' },         // 2.
  { type: 'object', data: {...} },            // 3.
  { type: 'env', prefix: 'APP_' },            // 4.
  { type: 'argv', prefix: '--' }              // 5. Highest
]
```

## Decorators Cheat Sheet

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@Config()` | Inject config value | `@Config('app.port', 3000)` |
| `@InjectConfig()` | Inject ConfigService | `@InjectConfig() config` |
| `@ConfigSchema()` | Define schema for class | `@ConfigSchema(schema)` |
| `@ConfigWatch()` | Watch for changes | `@ConfigWatch('path')` |
| `@ConfigValidate()` | Validate property | `@ConfigValidate(z.number())` |
| `@ConfigTransform()` | Transform value | `@ConfigTransform(v => v.toUpperCase())` |
| `@Configuration()` | Mark config class | `@Configuration('db')` |
| `@ConfigDefaults()` | Set defaults | `@ConfigDefaults({port: 3000})` |

## Environment Variables Mapping

```bash
# Environment variables
APP__DATABASE__HOST=localhost     # → database.host
APP__DATABASE__PORT=5432          # → database.port
APP__CACHE__ENABLED=true          # → cache.enabled
APP__FEATURES__NEW_UI=false       # → features.newUi
```

## Common Configuration Options

```typescript
ConfigModule.forRoot({
  // Sources
  sources: [...],

  // Validation
  schema: ZodSchema,
  validateOnStartup: true,
  strict: true,

  // Hot reload
  watchForChanges: true,

  // Caching
  cache: {
    enabled: true,
    ttl: 60000
  },

  // Environment
  environment: 'production',

  // Global access
  global: true
})
```

## File Format Support

| Format | Extension | Example |
|--------|-----------|---------|
| JSON | `.json` | `{"app": {"port": 3000}}` |
| YAML | `.yaml`, `.yml` | `app:\n  port: 3000` |
| ENV | `.env` | `APP_PORT=3000` |
| TOML | `.toml` | `[app]\nport = 3000` |
| INI | `.ini` | `[app]\nport=3000` |

## ConfigService Methods

```typescript
// Get value
config.get('path', defaultValue)
config.get<Type>('path')

// Get all
config.getAll()

// Check existence
config.has('path')

// Set runtime value
config.set('path', value)

// Get typed
config.getTyped(schema, 'path')

// Validate
config.validate(schema)

// Watch changes
config.onChange((event) => {...})

// Reload
await config.reload()
```

## Error Handling

```typescript
// Optional sources won't throw
{ type: 'file', path: 'optional.json', optional: true }

// Validation with error handling
const result = config.validate(schema);
if (!result.success) {
  console.error('Validation errors:', result.errors);
}

// Safe typed access
try {
  const typed = config.getTyped(schema);
} catch (error) {
  // Handle validation error
}
```

## Testing Configuration

```typescript
// Mock configuration for tests
const testConfig = {
  app: { port: 3001 },
  database: { host: 'test-db' }
};

ConfigModule.forRoot({
  sources: [
    { type: 'object', data: testConfig }
  ]
})
```

## Performance Tips

1. **Enable caching** for frequently accessed values
2. **Use typed getters** to avoid repeated validation
3. **Batch configuration access** in initialization
4. **Avoid deep nesting** in configuration paths
5. **Use `optional: true` for non-critical sources

## Security Best Practices

```typescript
// ❌ Don't store secrets in config files
{
  "database": {
    "password": "plain-text-password"
  }
}

// ✅ Use environment variables
{
  "database": {
    "password": "${DB_PASSWORD}"
  }
}

// ✅ Or use secret management
const secrets = await secretManager.get();
ConfigModule.forRoot({
  sources: [
    { type: 'object', data: { secrets } }
  ]
})
```

## Debug Configuration

```typescript
// Log configuration sources
const metadata = config.getMetadata();
console.log('Loaded from:', metadata.sources);

// Log all configuration
console.log('Config:', config.getAll());

// Watch all changes
config.onChange((event) => {
  console.log(`[CONFIG] ${event.path}:`, event.newValue);
});
```

## Common Mistakes to Avoid

1. ❌ **Not validating on startup** - Always validate critical configuration
2. ❌ **Hardcoding secrets** - Use environment variables or secret management
3. ❌ **Deep nesting** - Keep configuration structure flat when possible
4. ❌ **Not handling missing values** - Always provide defaults or use optional
5. ❌ **Ignoring type safety** - Use TypeScript and Zod for validation
6. ❌ **Not documenting schema** - Document configuration requirements
7. ❌ **Mixing concerns** - Separate app config from feature flags
8. ❌ **Not testing config** - Test with different configuration scenarios