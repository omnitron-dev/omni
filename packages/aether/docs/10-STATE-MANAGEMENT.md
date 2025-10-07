# 10. State Management

> **Status**: Complete Specification
> **Last Updated**: 2025-10-07
> **Part of**: Aether Frontend Framework

---

## Table of Contents

1. [Overview](#overview)
2. [Core Primitives](#core-primitives)
3. [Store Pattern](#store-pattern)
4. [Server Integration](#server-integration)
5. [Real-Time Synchronization](#real-time-synchronization)
6. [Module Integration](#module-integration)
7. [Best Practices](#best-practices)
8. [Examples](#examples)

---

## Overview

State management in Aether is built on **fine-grained reactivity** using signals, providing surgical updates without virtual DOM overhead. The framework provides a minimal set of primitives that developers compose explicitly.

### Philosophy

Aether follows a **minimalist, explicit approach** to state management:

- ✅ **Reactive Primitives** - `signal()`, `computed()`, `effect()`, `resource()`
- ✅ **Explicit Control** - Developer manages state flow
- ✅ **Type Safety** - Full TypeScript inference
- ✅ **No Magic** - Clear, predictable behavior
- ✅ **Composable** - Build complex patterns from simple primitives

### Not Included

Aether intentionally does NOT provide:

- ❌ Magic decorators that hide complexity
- ❌ Automatic cache management (you control caching)
- ❌ Implicit state synchronization (you write sync logic)
- ❌ Framework-specific abstractions (use standard patterns)

**Why?** Because explicit code is easier to understand, debug, and maintain. Aether gives you the primitives; you build the patterns that fit your needs.

---

## Core Primitives

### signal()

A **signal** is a reactive container for a single value.

```typescript
import { signal } from 'aether';

// Create signal
const count = signal(0);

// Read value
console.log(count()); // 0

// Write value
count.set(5);
count.set(prev => prev + 1); // 6

// Update (shorthand)
count.update(n => n + 1); // 7
```

**See [02-REACTIVITY.md](./02-REACTIVITY.md) for full signal() API.**

### computed()

A **computed** is a derived value that automatically updates.

```typescript
import { signal, computed } from 'aether';

const firstName = signal('John');
const lastName = signal('Doe');

const fullName = computed(() =>
  `${firstName()} ${lastName()}`
);

console.log(fullName()); // "John Doe"
firstName.set('Jane');
console.log(fullName()); // "Jane Doe"
```

### effect()

An **effect** is a side effect that runs when dependencies change.

```typescript
import { signal, effect } from 'aether';

const count = signal(0);

effect(() => {
  console.log(`Count is ${count()}`);
});
// Logs: "Count is 0"

count.set(1);
// Logs: "Count is 1"
```

### resource()

A **resource** handles async data with loading/error states.

```typescript
import { signal, resource } from 'aether';

const userId = signal(1);

const user = resource(() =>
  fetch(`/api/users/${userId()}`).then(r => r.json())
);

// Check states
if (user.loading()) {
  console.log('Loading...');
} else if (user.error()) {
  console.log('Error:', user.error());
} else {
  console.log('User:', user());
}
```

**See [02-REACTIVITY.md](./02-REACTIVITY.md) for full resource() API.**

---

## Store Pattern

A **store** is a class that encapsulates related state and logic using reactive primitives.

### Basic Store

```typescript
import { Injectable, signal, computed } from 'aether';

@Injectable()
export class CounterStore {
  // State
  private count = signal(0);

  // Computed
  doubled = computed(() => this.count() * 2);

  // Getters
  getCount() {
    return this.count;
  }

  // Actions
  increment() {
    this.count.set(c => c + 1);
  }

  decrement() {
    this.count.set(c => c - 1);
  }

  reset() {
    this.count.set(0);
  }
}
```

### Using Stores in Components

```typescript
import { defineComponent, inject, onMount } from 'aether';
import { CounterStore } from './counter.store';

export const Counter = defineComponent(() => {
  const store = inject(CounterStore);
  const count = store.getCount();

  return () => (
    <div>
      <p>Count: {count()}</p>
      <p>Doubled: {store.doubled()}</p>
      <button onClick={() => store.increment()}>+</button>
      <button onClick={() => store.decrement()}>-</button>
      <button onClick={() => store.reset()}>Reset</button>
    </div>
  );
});
```

### Store with Async Data

```typescript
import { Injectable, signal, computed, resource } from 'aether';

interface User {
  id: number;
  name: string;
  email: string;
}

@Injectable()
export class UserStore {
  // State
  private users = signal<User[]>([]);
  private loading = signal(false);
  private error = signal<Error | null>(null);

  // Computed
  userCount = computed(() => this.users().length);
  activeUsers = computed(() =>
    this.users().filter(u => u.active)
  );

  // Getters
  getUsers() {
    return this.users;
  }

  isLoading() {
    return this.loading;
  }

  getError() {
    return this.error;
  }

  // Actions
  async loadUsers() {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await fetch('/api/users');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      this.users.set(data);
    } catch (err) {
      this.error.set(err as Error);
    } finally {
      this.loading.set(false);
    }
  }

  addUser(user: User) {
    this.users.set([...this.users(), user]);
  }

  updateUser(id: number, updates: Partial<User>) {
    this.users.set(users =>
      users.map(u => u.id === id ? { ...u, ...updates } : u)
    );
  }

  removeUser(id: number) {
    this.users.set(users => users.filter(u => u.id !== id));
  }
}
```

### Store with resource()

For simpler async handling, use `resource()`:

```typescript
import { Injectable, signal, resource } from 'aether';

@Injectable()
export class UserStore {
  // Source signal
  private userId = signal(1);

  // Resource automatically tracks userId
  user = resource(() =>
    fetch(`/api/users/${this.userId()}`).then(r => r.json())
  );

  // Actions
  loadUser(id: number) {
    this.userId.set(id); // Triggers automatic refetch
  }
}
```

**Use in component:**

```typescript
const UserProfile = defineComponent(() => {
  const store = inject(UserStore);

  return () => (
    <div>
      {#if store.user.loading()}
        <Spinner />
      {:else if store.user.error()}
        <Error message={store.user.error().message} />
      {:else}
        <div>
          <h1>{store.user().name}</h1>
          <p>{store.user().email}</p>
        </div>
      {/if}
    </div>
  );
});
```

---

## Server Integration

Stores communicate with backend services via **Netron RPC** fluent API.

### Type-Safe RPC Calls

```typescript
import { Injectable, signal } from 'aether';
import { NetronClient } from 'aether/netron';

// Define service interface (shared with backend)
interface IUserService {
  getUsers(filters?: UserFilters): Promise<User[]>;
  getUser(id: number): Promise<User>;
  createUser(data: CreateUserDto): Promise<User>;
  updateUser(id: number, data: UpdateUserDto): Promise<User>;
  deleteUser(id: number): Promise<void>;
}

@Injectable()
export class UserStore {
  private users = signal<User[]>([]);
  private loading = signal(false);

  constructor(private netron: NetronClient) {}

  async loadUsers(filters?: UserFilters) {
    this.loading.set(true);
    try {
      // Get type-safe service proxy
      const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');

      // Call method - fully type-checked!
      const users = await service.getUsers(filters);

      this.users.set(users);
    } finally {
      this.loading.set(false);
    }
  }

  async createUser(data: CreateUserDto) {
    const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
    const user = await service.createUser(data);

    // Update local state
    this.users.set([...this.users(), user]);

    return user;
  }

  async updateUser(id: number, data: UpdateUserDto) {
    const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
    const updated = await service.updateUser(id, data);

    // Update local state
    this.users.set(users =>
      users.map(u => u.id === id ? updated : u)
    );

    return updated;
  }

  async deleteUser(id: number) {
    const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
    await service.deleteUser(id);

    // Update local state
    this.users.set(users => users.filter(u => u.id !== id));
  }

  getUsers() {
    return this.users;
  }

  isLoading() {
    return this.loading;
  }
}
```

**Key Points:**

1. **Explicit Service Calls** - Developer calls Netron API directly
2. **Type Safety** - TypeScript interfaces ensure compile-time checking
3. **Manual State Updates** - Developer updates local state explicitly
4. **Full Control** - No magic, clear flow

### Optimistic Updates

Implement optimistic updates explicitly:

```typescript
@Injectable()
export class TodoStore {
  private todos = signal<Todo[]>([]);

  constructor(private netron: NetronClient) {}

  async toggleTodo(id: number) {
    // Save current state for rollback
    const previousTodos = this.todos();

    // Optimistic update
    this.todos.set(todos =>
      todos.map(t => t.id === id ? { ...t, done: !t.done } : t)
    );

    try {
      // Call server
      const service = await this.netron.queryInterface<ITodoService>('TodoService@1.0.0');
      await service.toggleTodo(id);
    } catch (error) {
      // Rollback on error
      this.todos.set(previousTodos);
      throw error;
    }
  }
}
```

### Caching Pattern

Implement caching explicitly:

```typescript
@Injectable()
export class UserStore {
  private users = signal<User[]>([]);
  private cache = new Map<string, { data: User[]; timestamp: number }>();
  private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private netron: NetronClient) {}

  async loadUsers(filters?: UserFilters) {
    const cacheKey = JSON.stringify(filters || {});
    const cached = this.cache.get(cacheKey);

    // Return cached if fresh
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.users.set(cached.data);
      return cached.data;
    }

    // Fetch from server
    const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
    const users = await service.getUsers(filters);

    // Update cache
    this.cache.set(cacheKey, {
      data: users,
      timestamp: Date.now()
    });

    this.users.set(users);
    return users;
  }

  invalidateCache() {
    this.cache.clear();
  }
}
```

---

## Real-Time Synchronization

Subscribe to server events using Netron's subscription API.

### WebSocket Subscriptions

```typescript
import { Injectable, signal } from 'aether';
import { NetronClient } from 'aether/netron';

@Injectable()
export class UserStore {
  private users = signal<User[]>([]);

  constructor(private netron: NetronClient) {
    this.setupSubscriptions();
  }

  private setupSubscriptions() {
    // Subscribe to user created event
    this.netron.subscribe('user.created', (user: User) => {
      this.users.set([...this.users(), user]);
    });

    // Subscribe to user updated event
    this.netron.subscribe('user.updated', (user: User) => {
      this.users.set(users =>
        users.map(u => u.id === user.id ? user : u)
      );
    });

    // Subscribe to user deleted event
    this.netron.subscribe('user.deleted', (userId: number) => {
      this.users.set(users =>
        users.filter(u => u.id !== userId)
      );
    });
  }

  getUsers() {
    return this.users;
  }
}
```

### Cleanup

```typescript
@Injectable()
export class UserStore {
  private users = signal<User[]>([]);
  private unsubscribers: Array<() => void> = [];

  constructor(private netron: NetronClient) {
    this.setupSubscriptions();
  }

  private setupSubscriptions() {
    // Store unsubscribe functions
    this.unsubscribers.push(
      this.netron.subscribe('user.created', this.handleUserCreated.bind(this))
    );

    this.unsubscribers.push(
      this.netron.subscribe('user.updated', this.handleUserUpdated.bind(this))
    );
  }

  private handleUserCreated(user: User) {
    this.users.set([...this.users(), user]);
  }

  private handleUserUpdated(user: User) {
    this.users.set(users =>
      users.map(u => u.id === user.id ? user : u)
    );
  }

  destroy() {
    // Cleanup subscriptions
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
  }
}
```

---

## Module Integration

Stores are registered in modules and available via dependency injection.

### Register Store in Module

```typescript
import { defineModule } from 'aether/module';
import { UserStore } from './user.store';
import { UserListComponent } from './user-list.component';

export const UserModule = defineModule({
  id: 'user',
  providers: [UserStore],
  components: [UserListComponent]
});
```

### Inject Store in Component

```typescript
import { defineComponent, inject } from 'aether';
import { UserStore } from './user.store';

export const UserList = defineComponent(() => {
  const store = inject(UserStore);

  onMount(() => {
    store.loadUsers();
  });

  return () => (
    <div>
      {#if store.isLoading()}
        <Spinner />
      {:else}
        <For each={store.getUsers()}>
          {user => <UserCard user={user} />}
        </For>
      {/if}
    </div>
  );
});
```

### Cross-Module Store Access

```typescript
// Export store from module
export const UserModule = defineModule({
  id: 'user',
  providers: [UserStore],
  exports: [UserStore], // Export for other modules
  components: [UserListComponent]
});

// Import in another module
export const OrderModule = defineModule({
  id: 'order',
  imports: [UserModule], // Import UserModule
  providers: [OrderStore],
  components: [OrderListComponent]
});

// Use in OrderStore
@Injectable()
export class OrderStore {
  constructor(
    private userStore: UserStore // Injected from UserModule
  ) {}

  async createOrder(data: CreateOrderDto) {
    const user = this.userStore.getUsers()[0];
    // ...
  }
}
```

---

## Best Practices

### 1. Keep Stores Focused

Each store should manage a single domain:

```typescript
// ✅ Good - focused store
@Injectable()
export class UserStore {
  // Only user-related state and logic
}

// ❌ Bad - mixed concerns
@Injectable()
export class AppStore {
  // Users, orders, settings, notifications...
}
```

### 2. Use Signals for Local State

```typescript
// ✅ Good - signals for reactive state
@Injectable()
export class UserStore {
  private users = signal<User[]>([]);
  private selectedId = signal<number | null>(null);
}

// ❌ Avoid - plain variables (not reactive)
@Injectable()
export class UserStore {
  private users: User[] = [];  // Not reactive!
}
```

### 3. Computed for Derived State

```typescript
// ✅ Good - computed for derived values
@Injectable()
export class UserStore {
  private users = signal<User[]>([]);

  activeUsers = computed(() =>
    this.users().filter(u => u.active)
  );
}

// ❌ Avoid - manual synchronization
@Injectable()
export class UserStore {
  private users = signal<User[]>([]);
  private activeUsers = signal<User[]>([]);

  addUser(user: User) {
    this.users.set([...this.users(), user]);
    // Easy to forget to update activeUsers!
  }
}
```

### 4. Explicit Error Handling

```typescript
// ✅ Good - explicit error handling
@Injectable()
export class UserStore {
  private users = signal<User[]>([]);
  private error = signal<Error | null>(null);

  async loadUsers() {
    this.error.set(null);
    try {
      const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
      const users = await service.getUsers();
      this.users.set(users);
    } catch (err) {
      this.error.set(err as Error);
      throw err; // Re-throw for component handling
    }
  }
}
```

### 5. Type-Safe Service Interfaces

```typescript
// ✅ Good - shared interface
// shared/interfaces/user.service.ts
export interface IUserService {
  getUsers(): Promise<User[]>;
  createUser(data: CreateUserDto): Promise<User>;
}

// store
const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
const users = await service.getUsers(); // Type-safe!

// ❌ Avoid - string-based calls (no type safety)
const service = await this.netron.queryInterface('UserService@1.0.0');
const users = await (service as any).getUsers(); // Unsafe!
```

### 6. Cleanup Subscriptions

```typescript
// ✅ Good - cleanup subscriptions
@Injectable()
export class UserStore implements OnDestroy {
  private unsubscribers: Array<() => void> = [];

  constructor(private netron: NetronClient) {
    this.unsubscribers.push(
      this.netron.subscribe('user.created', this.handleUserCreated.bind(this))
    );
  }

  onDestroy() {
    this.unsubscribers.forEach(fn => fn());
  }
}
```

---

## Examples

### Complete User Management Store

```typescript
import { Injectable, signal, computed } from 'aether';
import { NetronClient } from 'aether/netron';

interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

interface UserFilters {
  active?: boolean;
  search?: string;
}

interface CreateUserDto {
  name: string;
  email: string;
}

interface UpdateUserDto {
  name?: string;
  email?: string;
  active?: boolean;
}

interface IUserService {
  getUsers(filters?: UserFilters): Promise<User[]>;
  getUser(id: number): Promise<User>;
  createUser(data: CreateUserDto): Promise<User>;
  updateUser(id: number, data: UpdateUserDto): Promise<User>;
  deleteUser(id: number): Promise<void>;
}

@Injectable()
export class UserStore {
  // State
  private users = signal<User[]>([]);
  private selectedUserId = signal<number | null>(null);
  private loading = signal(false);
  private error = signal<Error | null>(null);

  // Computed
  activeUsers = computed(() =>
    this.users().filter(u => u.active)
  );

  inactiveUsers = computed(() =>
    this.users().filter(u => !u.active)
  );

  selectedUser = computed(() => {
    const id = this.selectedUserId();
    return id ? this.users().find(u => u.id === id) : null;
  });

  userCount = computed(() => this.users().length);

  // Subscriptions
  private unsubscribers: Array<() => void> = [];

  constructor(private netron: NetronClient) {
    this.setupSubscriptions();
  }

  // Getters
  getUsers() {
    return this.users;
  }

  isLoading() {
    return this.loading;
  }

  getError() {
    return this.error;
  }

  // Actions
  async loadUsers(filters?: UserFilters) {
    this.loading.set(true);
    this.error.set(null);

    try {
      const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
      const users = await service.getUsers(filters);
      this.users.set(users);
    } catch (err) {
      this.error.set(err as Error);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async loadUser(id: number) {
    this.loading.set(true);
    this.error.set(null);

    try {
      const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
      const user = await service.getUser(id);

      // Update users list
      this.users.set(users => {
        const index = users.findIndex(u => u.id === id);
        if (index >= 0) {
          const newUsers = [...users];
          newUsers[index] = user;
          return newUsers;
        }
        return [...users, user];
      });

      return user;
    } catch (err) {
      this.error.set(err as Error);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async createUser(data: CreateUserDto) {
    const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
    const user = await service.createUser(data);

    this.users.set([...this.users(), user]);
    return user;
  }

  async updateUser(id: number, data: UpdateUserDto) {
    // Optimistic update
    const previousUsers = this.users();
    this.users.set(users =>
      users.map(u => u.id === id ? { ...u, ...data } : u)
    );

    try {
      const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
      const updated = await service.updateUser(id, data);

      // Update with server response
      this.users.set(users =>
        users.map(u => u.id === id ? updated : u)
      );

      return updated;
    } catch (err) {
      // Rollback on error
      this.users.set(previousUsers);
      throw err;
    }
  }

  async deleteUser(id: number) {
    // Optimistic delete
    const previousUsers = this.users();
    this.users.set(users => users.filter(u => u.id !== id));

    try {
      const service = await this.netron.queryInterface<IUserService>('UserService@1.0.0');
      await service.deleteUser(id);
    } catch (err) {
      // Rollback on error
      this.users.set(previousUsers);
      throw err;
    }
  }

  selectUser(id: number | null) {
    this.selectedUserId.set(id);
  }

  // Real-time sync
  private setupSubscriptions() {
    this.unsubscribers.push(
      this.netron.subscribe('user.created', (user: User) => {
        this.users.set([...this.users(), user]);
      })
    );

    this.unsubscribers.push(
      this.netron.subscribe('user.updated', (user: User) => {
        this.users.set(users =>
          users.map(u => u.id === user.id ? user : u)
        );
      })
    );

    this.unsubscribers.push(
      this.netron.subscribe('user.deleted', (userId: number) => {
        this.users.set(users =>
          users.filter(u => u.id !== userId)
        );

        // Clear selection if deleted user was selected
        if (this.selectedUserId() === userId) {
          this.selectedUserId.set(null);
        }
      })
    );
  }

  // Cleanup
  onDestroy() {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
  }
}
```

### Component Usage

```typescript
import { defineComponent, inject, onMount, For, Show } from 'aether';
import { UserStore } from './user.store';

export const UserManagement = defineComponent(() => {
  const store = inject(UserStore);

  onMount(() => {
    store.loadUsers();
  });

  const handleCreateUser = async () => {
    try {
      await store.createUser({
        name: 'New User',
        email: 'user@example.com'
      });
    } catch (error) {
      console.error('Failed to create user:', error);
    }
  };

  return () => (
    <div>
      <h1>User Management</h1>

      <Show when={store.isLoading()}>
        <Spinner />
      </Show>

      <Show when={store.getError()}>
        <ErrorMessage error={store.getError()!} />
      </Show>

      <div>
        <p>Total Users: {store.userCount()}</p>
        <p>Active: {store.activeUsers().length}</p>
        <p>Inactive: {store.inactiveUsers().length}</p>
      </div>

      <button onClick={handleCreateUser}>Create User</button>

      <For each={store.getUsers()}>
        {user => (
          <UserCard
            user={user}
            onSelect={() => store.selectUser(user.id)}
            onUpdate={(data) => store.updateUser(user.id, data)}
            onDelete={() => store.deleteUser(user.id)}
          />
        )}
      </For>
    </div>
  );
});
```

---

## Summary

Aether's state management is built on **explicit, composable primitives**:

1. **Signals** - Reactive state containers
2. **Computed** - Derived values
3. **Effects** - Side effects
4. **Resources** - Async data handling
5. **Stores** - Domain-specific state + logic
6. **Netron** - Type-safe RPC for server communication

**Key Principles:**

- ✅ **Explicit over Implicit** - Clear, predictable code
- ✅ **Composable Primitives** - Build complex patterns from simple parts
- ✅ **Type Safety** - Full TypeScript support
- ✅ **Developer Control** - You manage the flow
- ✅ **No Magic** - Understand what happens

For more details:
- **Reactivity**: See [02-REACTIVITY.md](./02-REACTIVITY.md)
- **Netron RPC**: See [20-NETRON-RPC.md](./20-NETRON-RPC.md)
- **Titan Integration**: See [19-TITAN-INTEGRATION.md](./19-TITAN-INTEGRATION.md)
- **Modules**: See [06-MODULES.md](./06-MODULES.md)
- **DI System**: See [07-DEPENDENCY-INJECTION.md](./07-DEPENDENCY-INJECTION.md)
