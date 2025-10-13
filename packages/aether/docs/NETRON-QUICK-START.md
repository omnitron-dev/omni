# Aether-Netron Integration: Quick Start Guide

> **Get started in 5 minutes** - Zero-config data layer for Aether + Titan

---

## Installation

```bash
# Aether already includes netron integration
yarn add @omnitron-dev/aether
```

---

## Basic Setup (Level 1)

### 1. Configure Module

```typescript
import { Module } from '@omnitron-dev/aether';
import { NetronModule } from '@omnitron-dev/aether/netron';

@Module({
  imports: [
    // That's it! Just provide your API URL
    NetronModule.forRoot({
      baseUrl: 'https://api.example.com'
    })
  ],
  providers: [UserService, ProductService]
})
export class AppModule {}
```

### 2. Create Service Class

```typescript
import { Injectable } from '@omnitron-dev/aether';
import { NetronService } from '@omnitron-dev/aether/netron';

// Define your service interface (shared with Titan backend)
interface IUserService {
  getUsers(): Promise<User[]>;
  getUser(id: string): Promise<User>;
  createUser(data: CreateUserDto): Promise<User>;
  updateUser(id: string, data: UpdateUserDto): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

// Create service class - NO BOILERPLATE!
@Injectable()
export class UserService extends NetronService<IUserService> {
  // That's it! All methods are auto-available
  // No need to implement anything
}
```

### 3. Use in Components

```typescript
import { defineComponent } from '@omnitron-dev/aether';
import { useQuery } from '@omnitron-dev/aether/netron';
import { UserService } from './user.service';

export const UserList = defineComponent(() => {
  // Reactive query with auto-caching
  const { data: users, loading, error, refetch } = useQuery(
    UserService,
    'getUsers',
    []
  );

  return () => (
    <div>
      {loading() && <div>Loading...</div>}
      {error() && <div>Error: {error()!.message}</div>}
      {users() && (
        <ul>
          {users()!.map(user => (
            <li key={user.id}>{user.name}</li>
          ))}
        </ul>
      )}
      <button onClick={refetch}>Refresh</button>
    </div>
  );
});
```

**That's it! You're done.** 🎉

---

## Common Patterns

### Pattern 1: Query with Caching

```typescript
// Cache for 60 seconds
const { data: users, loading } = useQuery(
  UserService,
  'getUsers',
  [],
  { cache: 60000 }
);
```

### Pattern 2: Query with Retry

```typescript
// Retry failed requests 3 times
const { data: user, loading } = useQuery(
  UserService,
  'getUser',
  [userId],
  { retry: 3 }
);
```

### Pattern 3: Mutation

```typescript
const CreateUser = defineComponent(() => {
  const { mutate, loading } = useMutation(
    UserService,
    'createUser',
    {
      onSuccess: (newUser) => {
        toast.success('User created!');
        navigate(`/users/${newUser.id}`);
      },
      onError: (error) => {
        toast.error('Failed to create user');
      }
    }
  );

  const handleSubmit = async (formData: CreateUserDto) => {
    await mutate(formData);
  };

  return () => <UserForm onSubmit={handleSubmit} disabled={loading()} />;
});
```

### Pattern 4: Optimistic Update

```typescript
const { mutate } = useMutation(
  UserService,
  'updateUser',
  {
    optimistic: (id: string, data: UpdateUserDto) => ({
      // Return optimistic data (used immediately)
      id,
      ...data
    }),
    invalidate: ['users'],  // Invalidate related queries
    onSuccess: () => toast.success('Updated!')
  }
);

// UI updates instantly, auto-rollback on error
await mutate(userId, { name: 'New Name' });
```

### Pattern 5: Store Pattern

```typescript
import { signal, computed } from '@omnitron-dev/aether';
import { NetronStore } from '@omnitron-dev/aether/netron';

@Injectable()
export class UserStore extends NetronStore<IUserService> {
  // Reactive state
  users = signal<User[]>([]);
  selectedUser = signal<User | null>(null);

  // Computed
  activeUsers = computed(() =>
    this.users().filter(u => u.active)
  );

  // Actions
  async loadUsers() {
    const data = await this.query('getUsers', [], {
      cache: { maxAge: 60000, tags: ['users'] }
    });
    this.users.set(data);
  }

  async selectUser(id: string) {
    const user = await this.query('getUser', [id]);
    this.selectedUser.set(user);
  }

  async updateUser(id: string, data: UpdateUserDto) {
    await this.mutate('updateUser', [id, data], {
      optimistic: () => {
        // Optimistic update with auto-rollback
        this.users.set(
          this.users().map(u =>
            u.id === id ? { ...u, ...data } : u
          )
        );
      },
      invalidate: ['users']
    });
  }
}

// Component usage
const UserManagement = defineComponent(() => {
  const store = inject(UserStore);

  onMount(() => store.loadUsers());

  return () => (
    <div>
      <UserList
        users={store.activeUsers()}
        onSelect={(id) => store.selectUser(id)}
      />
      {store.selectedUser() && (
        <UserEditor
          user={store.selectedUser()!}
          onSave={(data) => store.updateUser(store.selectedUser()!.id, data)}
        />
      )}
    </div>
  );
});
```

---

## Multi-Backend Support (Level 2)

### 1. Configure Multiple Backends

```typescript
@Module({
  imports: [
    NetronModule.forRoot({
      backends: {
        main: 'https://api.example.com',
        analytics: 'https://analytics.example.com',
        auth: 'https://auth.example.com'
      },
      default: 'main'  // Optional
    })
  ]
})
export class AppModule {}
```

### 2. Specify Backend per Service

```typescript
@Injectable()
@Backend('main')
export class UserService extends NetronService<IUserService> {}

@Injectable()
@Backend('analytics')
export class AnalyticsService extends NetronService<IAnalyticsService> {}

@Injectable()
@Backend('auth')
export class AuthService extends NetronService<IAuthService> {}
```

### 3. Use in Components (same API!)

```typescript
const Dashboard = defineComponent(() => {
  // Each service uses its configured backend
  const { data: users } = useQuery(UserService, 'getUsers', []);
  const analytics = inject(AnalyticsService);
  const auth = inject(AuthService);

  onMount(async () => {
    await analytics.trackPageView('dashboard');
    const session = await auth.verifySession();
  });

  return () => <UserTable users={users()} />;
});
```

---

## Advanced Features

### Advanced Caching

```typescript
const { data: users } = useQuery(
  UserService,
  'getUsers',
  [],
  {
    cache: {
      maxAge: 60000,                 // Fresh for 60s
      staleWhileRevalidate: 30000,   // Serve stale while revalidating
      tags: ['users'],               // Tag for invalidation
      cacheOnError: true             // Serve stale on network error
    }
  }
);
```

### Advanced Retry

```typescript
const { data: user } = useQuery(
  UserService,
  'getUser',
  [userId],
  {
    retry: {
      attempts: 3,
      backoff: 'exponential',
      initialDelay: 1000,
      maxDelay: 30000
    }
  }
);
```

### Request Transformations

```typescript
const { data: users } = useQuery(
  UserService,
  'getUsers',
  [],
  {
    transform: (users) => users.map(normalizeUser),
    validate: (users) => Array.isArray(users),
    fallback: []
  }
);
```

### Performance Metrics

```typescript
const { data: users } = useQuery(
  UserService,
  'getUsers',
  [],
  {
    metrics: (timing) => {
      console.log('Duration:', timing.duration);
      console.log('Cache hit:', timing.cacheHit);
    }
  }
);
```

### Cache Invalidation

```typescript
import { inject } from '@omnitron-dev/aether';
import { NetronClient } from '@omnitron-dev/aether/netron';

const MyComponent = defineComponent(() => {
  const netron = inject(NetronClient);

  const invalidateUsers = () => {
    // Invalidate by pattern
    netron.invalidate('User*');

    // Invalidate by tag
    netron.invalidate(['users', 'auth']);

    // Invalidate by regex
    netron.invalidate(/^users\./);
  };

  return () => <button onClick={invalidateUsers}>Clear Cache</button>;
});
```

### Cache Statistics

```typescript
const netron = inject(NetronClient);
const stats = netron.getCacheStats();

console.log({
  hitRate: stats.hitRate,        // 80-90% typical
  hits: stats.hits,
  misses: stats.misses,
  entries: stats.entries,
  sizeBytes: stats.sizeBytes
});
```

---

## TypeScript Contracts

### Shared Interface (Backend & Frontend)

```typescript
// contracts/user.service.ts (shared between Aether and Titan)
export interface IUserService {
  getUsers(): Promise<User[]>;
  getUser(id: string): Promise<User>;
  createUser(data: CreateUserDto): Promise<User>;
  updateUser(id: string, data: UpdateUserDto): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

export interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: Date;
}

export interface CreateUserDto {
  name: string;
  email: string;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  active?: boolean;
}
```

### Titan Backend

```typescript
import { Injectable, Service, Public } from '@omnitron-dev/titan';
import { IUserService, User, CreateUserDto, UpdateUserDto } from '../contracts/user.service';

@Injectable()
@Service('users@1.0.0')
export class UserService implements IUserService {
  constructor(private db: DatabaseService) {}

  @Public()
  async getUsers(): Promise<User[]> {
    return await this.db.users.findMany();
  }

  @Public()
  async getUser(id: string): Promise<User> {
    return await this.db.users.findOne(id);
  }

  @Public()
  async createUser(data: CreateUserDto): Promise<User> {
    return await this.db.users.create(data);
  }

  @Public()
  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    return await this.db.users.update(id, data);
  }

  @Public()
  async deleteUser(id: string): Promise<void> {
    await this.db.users.delete(id);
  }
}
```

### Aether Frontend

```typescript
import { Injectable } from '@omnitron-dev/aether';
import { NetronService } from '@omnitron-dev/aether/netron';
import { IUserService } from '../contracts/user.service';

@Injectable()
export class UserService extends NetronService<IUserService> {
  // All methods auto-available with full type safety!
  // No need to implement anything
}
```

**Result:** Full type safety from frontend to backend! 🎉

---

## Debugging

### Enable Debug Mode

```typescript
@Module({
  imports: [
    NetronModule.forRoot({
      baseUrl: 'https://api.example.com',
      cache: {
        debug: true  // Log all cache operations
      }
    })
  ]
})
export class AppModule {}
```

### Console Output

```
[Cache] MISS: users/getUsers, fetching...
[Cache] SET: users/getUsers (age: 0ms)
[Cache] HIT: users/getUsers (age: 1234ms)
[Cache] STALE: users/getUsers (age: 65000ms), revalidating...
[Cache] REVALIDATED: users/getUsers
[Cache] INVALIDATED: 3 entries matching pattern: User*
```

---

## Performance Tips

### 1. Use Appropriate Cache Times

```typescript
// Short-lived data (user sessions, cart)
{ cache: 5000 }  // 5 seconds

// Medium-lived data (product lists, user profiles)
{ cache: 60000 }  // 60 seconds

// Long-lived data (static content, config)
{ cache: 300000 }  // 5 minutes
```

### 2. Use Stale-While-Revalidate

```typescript
// Instant response from cache + background refresh
{
  cache: {
    maxAge: 60000,
    staleWhileRevalidate: 30000  // Serve stale for 30s while revalidating
  }
}
```

### 3. Use Cache Tags

```typescript
// Tag related queries
useQuery(UserService, 'getUsers', [], {
  cache: { maxAge: 60000, tags: ['users'] }
});

useQuery(UserService, 'getUser', [id], {
  cache: { maxAge: 60000, tags: ['users', `user:${id}`] }
});

// Invalidate all user-related queries
netron.invalidate(['users']);
```

### 4. Use Optimistic Updates

```typescript
// Update UI immediately, rollback on error
const { mutate } = useMutation(UserService, 'updateUser', {
  optimistic: (id, data) => ({ id, ...data }),
  invalidate: ['users']
});
```

---

## Common Errors

### Error: "No provider for NetronClient"

**Solution:** Import NetronModule in your root module:

```typescript
@Module({
  imports: [
    NetronModule.forRoot({ baseUrl: '...' })
  ]
})
```

### Error: "Backend 'main' not found"

**Solution:** Make sure backend is configured in NetronModule:

```typescript
NetronModule.forRoot({
  backends: {
    main: 'https://api.example.com'
  }
})
```

### Error: "Service name could not be inferred"

**Solution:** Explicitly specify service name:

```typescript
@Injectable()
@ServiceName('users')  // Add this
export class UserService extends NetronService<IUserService> {}
```

---

## Next Steps

### Learn More

- Read the [full design document](./NETRON-INTEGRATION-DESIGN.md)
- Check out [example apps](../examples/)
- Join the [Discord community](https://discord.gg/omnitron)

### Contribute

- Report bugs on [GitHub Issues](https://github.com/omnitron-dev/omni/issues)
- Submit feature requests
- Contribute to documentation

---

## Cheat Sheet

### Module Setup

```typescript
@Module({
  imports: [NetronModule.forRoot({ baseUrl: 'https://api.example.com' })]
})
```

### Service Class

```typescript
@Injectable()
export class UserService extends NetronService<IUserService> {}
```

### Query

```typescript
const { data, loading, error, refetch } = useQuery(
  UserService,
  'getUsers',
  [],
  { cache: 60000 }
);
```

### Mutation

```typescript
const { mutate, loading } = useMutation(
  UserService,
  'createUser',
  {
    onSuccess: (data) => console.log('Created!', data),
    onError: (error) => console.error('Failed!', error)
  }
);
```

### Store

```typescript
@Injectable()
export class UserStore extends NetronStore<IUserService> {
  users = signal<User[]>([]);
  async loadUsers() {
    const data = await this.query('getUsers', [], { cache: 60000 });
    this.users.set(data);
  }
}
```

### Multi-Backend

```typescript
@Backend('main')
export class UserService extends NetronService<IUserService> {}
```

---

**Happy coding!** 🚀
