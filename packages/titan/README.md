# Titan - Enterprise Backend Framework

Titan is a next-generation backend framework built on the [Nexus](../nexus) DI container, designed to be the definitive solution for building scalable, maintainable, and high-performance server applications.

## Features

- 🚀 **Blazing Fast** - Optimized router, minimal overhead, compiled routes
- 🔒 **Type-Safe** - End-to-end type safety without code generation
- 🏗️ **Modular Architecture** - Built on Nexus DI for clean, testable code
- 🌍 **Platform Agnostic** - Run on Node.js, Bun, Deno, Workers, or Edge
- 🔌 **Protocol Support** - HTTP, GraphQL, WebSocket, gRPC, and more
- 🧪 **Testing First** - Comprehensive testing utilities built-in
- 📊 **Production Ready** - Health checks, metrics, tracing, and more
- 🎯 **Minimal Boilerplate** - Focus on business logic, not infrastructure

## Quick Start

```typescript
import { Titan } from '@devgrid/titan';

const app = Titan.create();

app.get('/hello/:name', ({ params }) => ({
  message: `Hello, ${params.name}!`
}));

app.listen(3000);
```

## With Dependency Injection

```typescript
import { Titan, Controller, Get, Inject } from '@devgrid/titan';
import { createToken } from '@devgrid/nexus';

// Define service token
const GreetingServiceToken = createToken<GreetingService>('GreetingService');

// Service implementation
class GreetingService {
  greet(name: string) {
    return `Hello, ${name}!`;
  }
}

// Controller with DI
@Controller('/greetings')
class GreetingController {
  constructor(
    @Inject(GreetingServiceToken) private greetings: GreetingService
  ) {}
  
  @Get('/:name')
  greet(@Param('name') name: string) {
    return { message: this.greetings.greet(name) };
  }
}

// Application setup
const app = Titan.create({
  controllers: [GreetingController],
  providers: [
    { provide: GreetingServiceToken, useClass: GreetingService }
  ]
});

app.listen(3000);
```

## Protocol Support

### HTTP/REST

```typescript
app.get('/users', () => userService.findAll());
app.post('/users', ({ body }) => userService.create(body));
app.put('/users/:id', ({ params, body }) => userService.update(params.id, body));
app.delete('/users/:id', ({ params }) => userService.delete(params.id));
```

### GraphQL

```typescript
@Resolver()
class UserResolver {
  @Query(() => [User])
  users() {
    return this.userService.findAll();
  }
  
  @Mutation(() => User)
  createUser(@Args() input: CreateUserInput) {
    return this.userService.create(input);
  }
}

app.graphql({ 
  schema: buildSchema({ resolvers: [UserResolver] })
});
```

### WebSocket

```typescript
@Gateway('/chat')
class ChatGateway {
  @Subscribe('message')
  onMessage(@Payload() data: MessageDto, @Socket() socket: Socket) {
    socket.broadcast.emit('message', data);
  }
}

app.websocket({ gateways: [ChatGateway] });
```

### Microservices

```typescript
@Controller()
class UserMicroservice {
  @MessagePattern('user.create')
  createUser(@Payload() data: CreateUserDto) {
    return this.userService.create(data);
  }
  
  @EventPattern('user.updated')
  onUserUpdated(@Payload() user: User) {
    this.cache.invalidate(`user:${user.id}`);
  }
}

app.microservice({
  transport: Transport.REDIS,
  options: { url: 'redis://localhost:6379' }
});
```

## Testing

```typescript
describe('UserController', () => {
  let app: TestingModule;
  
  beforeEach(async () => {
    app = await Test.createTestingModule({
      controllers: [UserController],
      providers: [UserService]
    }).compile();
  });
  
  it('should return users', () => {
    return app.request()
      .get('/users')
      .expect(200)
      .expect(res => {
        expect(res.body).toBeInstanceOf(Array);
      });
  });
});
```

## Performance

Titan is designed for maximum performance:

- **Radix tree routing** for O(log n) route matching
- **Compiled routes** with pre-compiled regex patterns
- **Zero-copy streaming** for efficient data transfer
- **Connection pooling** for database connections
- **Response caching** with automatic invalidation

## Platform Support

Titan runs anywhere JavaScript runs:

```typescript
// Auto-detect platform
const app = Titan.create();
app.listen(3000); // Automatically uses the best adapter

// Or explicitly choose
import { NodeAdapter, BunAdapter, DenoAdapter } from '@devgrid/titan';

app.useAdapter(new BunAdapter());
```

## Documentation

See the [full documentation](./docs/specification.md) for detailed information on all features.

## License

MIT