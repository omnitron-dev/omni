# Titan Framework Examples

This directory contains comprehensive examples demonstrating the power and flexibility of the Titan application framework.

## 📚 Examples Overview

### 1. [basic-app.ts](./basic-app.ts) - Basic Application
A minimal Titan application demonstrating:
- Configuration management
- Logging
- Custom module creation
- Lifecycle hooks
- Graceful shutdown

**Run it:**
```bash
bun run examples/basic-app.ts
```

### 2. [config-usage.ts](./config-usage.ts) - Configuration System
Advanced configuration features:
- Multiple configuration sources (files, environment, objects)
- Schema validation with Zod
- Hot-reloading
- Secret management
- Configuration watching

**Run it:**
```bash
bun run examples/config-usage.ts
```

### 3. [custom-core-modules.ts](./custom-core-modules.ts) - Ultimate Flexibility
Replace ANY core module with custom implementations:
- Custom logger replacing Pino
- Custom configuration system
- Custom metrics collection
- Complete control over the framework

**Run it:**
```bash
bun run examples/custom-core-modules.ts
```

### 4. [simplified-api.ts](./simplified-api.ts) - User-Friendly API
Multiple examples showing how simple Titan can be:
- One-line app creation
- Fluent API chaining
- Service-oriented modules
- Async resource management

**Run it:**
```bash
bun run examples/simplified-api.ts
```

## 🚀 Key Features Demonstrated

### Maximum Flexibility
Every single component of Titan can be replaced thanks to the Nexus DI container:

```typescript
// Replace the default logger
app.replaceModule(LoggerModuleToken, MyCustomLogger);

// Replace the configuration system
app.replaceModule(ConfigModuleToken, MyCustomConfig);
```

### User-Friendly API
Create a fully functional app in one line:

```typescript
const app = await createAndStartApp({
  name: 'my-app',
  version: '1.0.0'
});
```

### Type-Safe Modules
Define modules with full TypeScript support:

```typescript
interface MyService {
  doSomething(): void;
}

const MyModule = defineModule<MyService>({
  name: 'my-module',
  doSomething() {
    console.log('Doing something!');
  }
});
```

### Lifecycle Management
Automatic initialization and cleanup:

```typescript
const DatabaseModule = defineModule({
  name: 'database',
  
  async onStart(app) {
    await this.connect();
  },
  
  async onStop(app) {
    await this.disconnect();
  }
});
```

## 🎯 Philosophy

Titan follows these core principles:

1. **Progressive Complexity** - Start simple, scale infinitely
2. **Everything is Replaceable** - No vendor lock-in, ever
3. **Type Safety First** - Full TypeScript support throughout
4. **User-Friendly API** - As simple as possible, but no simpler
5. **Production Ready** - Built-in logging, config, health checks

## 🏗️ Architecture

```
Application
    ├── Core Modules (Replaceable!)
    │   ├── ConfigModule
    │   └── LoggerModule
    ├── User Modules
    │   └── Your custom modules
    └── Nexus DI Container
        └── Powers everything
```

## 📝 Creating Your Own Module

The simplest module:

```typescript
const MyModule = defineModule({
  name: 'my-module',
  
  sayHello() {
    return 'Hello!';
  }
});
```

With lifecycle hooks:

```typescript
const MyModule = defineModule({
  name: 'my-module',
  
  async onStart(app) {
    console.log('Starting...');
  },
  
  async onStop(app) {
    console.log('Stopping...');
  },
  
  async health() {
    return {
      status: 'healthy',
      message: 'All good!'
    };
  }
});
```

With dependencies:

```typescript
const MyModule = defineModule({
  name: 'my-module',
  dependencies: [DatabaseToken, CacheToken],
  
  async onStart(app) {
    const db = app.get(DatabaseToken);
    const cache = app.get(CacheToken);
    // Use your dependencies
  }
});
```

## 🔄 Replacing Core Modules

Titan's ultimate flexibility means you can replace ANY core module:

```typescript
// Before app.start()
app.replaceModule(LoggerModuleToken, {
  name: 'my-logger',
  logger: myCustomLoggerInstance
});

app.replaceModule(ConfigModuleToken, {
  name: 'my-config',
  get(key) { return myConfig[key]; },
  set(key, value) { myConfig[key] = value; }
});
```

This is powered by the Nexus DI container, giving you complete control over your application architecture.

## 🎓 Learning Path

1. Start with `simplified-api.ts` to see how easy Titan can be
2. Look at `basic-app.ts` for a real-world example
3. Explore `config-usage.ts` for advanced configuration
4. Study `custom-core-modules.ts` to understand the ultimate flexibility

## 💡 Tips

- Always define module interfaces for better type safety
- Use lifecycle hooks for resource management
- Replace core modules when you need custom behavior
- Keep modules focused on a single responsibility
- Use the fluent API for cleaner code

## 🤝 Contributing

Have an interesting example? Feel free to contribute! Make sure your example:
- Demonstrates a specific feature or pattern
- Includes helpful comments
- Follows the existing code style
- Runs without errors

## 📄 License

MIT