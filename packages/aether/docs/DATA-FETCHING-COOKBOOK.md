# Data Fetching Cookbook

**Status**: Guide & Examples
**Last Updated**: 2025-10-13
**Part of**: Aether Frontend Framework

---

## Table of Contents

1. [Simple Examples](#simple-examples)
2. [Intermediate Patterns](#intermediate-patterns)
3. [Advanced Patterns](#advanced-patterns)
4. [Real-World Scenarios](#real-world-scenarios)
5. [Performance Optimization](#performance-optimization)
6. [Testing Patterns](#testing-patterns)

---

## Simple Examples

### Example 1: Display User List

**Scenario**: Fetch and display a list of users

```typescript
import { defineComponent, resource } from 'aether';

const UserList = defineComponent(() => {
  // Simple resource - automatically handles loading/error
  const users = resource(() =>
    fetch('/api/users').then(r => r.json())
  );

  return () => (
    <div>
      <h1>Users</h1>

      {#if users.loading()}
        <p>Loading users...</p>
      {:else if users.error()}
        <div class="error">
          <p>Failed to load users: {users.error().message}</p>
          <button on:click={() => users.refetch()}>Retry</button>
        </div>
      {:else if users()}
        <ul>
          {#each users() as user}
            <li>{user.name} - {user.email}</li>
          {/each}
        </ul>
      {:else}
        <p>No users found</p>
      {/if}
    </div>
  );
});
```

**Key Points**:
- Zero configuration needed
- Automatic loading/error states
- Manual refetch with `users.refetch()`

### Example 2: User Detail with URL Parameter

**Scenario**: Load user based on URL parameter

```typescript
import { defineComponent, resource } from 'aether';
import { useParams } from 'aether/router';

const UserProfile = defineComponent(() => {
  const params = useParams<{ id: string }>();

  // Automatically refetches when params.id changes!
  const user = resource(() =>
    fetch(`/api/users/${params.id}`).then(r => r.json())
  );

  return () => (
    <div>
      {#if user.loading()}
        <Skeleton />
      {:else if user()}
        <div>
          <h1>{user().name}</h1>
          <p>{user().email}</p>
          <p>Joined: {new Date(user().createdAt).toLocaleDateString()}</p>
        </div>
      {/if}
    </div>
  );
});
```

**Key Points**:
- Automatically tracks `params.id` dependency
- Refetches when URL changes
- No manual effect or dependency array

### Example 3: Search with Debouncing

**Scenario**: Search users as you type

```typescript
import { defineComponent, signal, resource } from 'aether';

const UserSearch = defineComponent(() => {
  const query = signal('');
  const debouncedQuery = signal('');

  // Debounce search input
  let timeoutId: number;
  effect(() => {
    clearTimeout(timeoutId);
    const currentQuery = query();
    timeoutId = setTimeout(() => {
      debouncedQuery.set(currentQuery);
    }, 300);
  });

  // Search results automatically refetch when debouncedQuery changes
  const results = resource(() => {
    const q = debouncedQuery();
    if (!q) return Promise.resolve([]);

    return fetch(`/api/users/search?q=${encodeURIComponent(q)}`)
      .then(r => r.json());
  });

  return () => (
    <div>
      <input
        type="search"
        value={query()}
        on:input={(e) => query.set(e.target.value)}
        placeholder="Search users..."
      />

      {#if results.loading()}
        <p>Searching...</p>
      {:else if results() && results().length > 0}
        <ul>
          {#each results() as user}
            <li>{user.name}</li>
          {/each}
        </ul>
      {:else if debouncedQuery()}
        <p>No results found</p>
      {/if}
    </div>
  );
});
```

**Key Points**:
- Debounce with signals and effects
- Conditional fetching (only if query exists)
- Automatic refetch on debounced query change

---

## Intermediate Patterns

### Example 4: Type-Safe RPC with Netron

**Scenario**: Call backend service with full type safety

```typescript
// shared/contracts/user.contract.ts
export interface IUserService {
  getUsers(filters?: { active?: boolean }): Promise<User[]>;
  getUser(id: string): Promise<User>;
  updateUser(id: string, data: UpdateUserDto): Promise<User>;
}

// frontend/pages/users.tsx
import { defineComponent, resource, inject } from 'aether';
import { NetronClient } from 'aether/netron';
import { IUserService } from '@/shared/contracts/user.contract';

const UsersPage = defineComponent(() => {
  const netron = inject(NetronClient);
  const showActive = signal(true);

  // Type-safe RPC call
  const users = resource(async () => {
    const service = await netron.queryInterface<IUserService>('users@1.0.0');
    return service.getUsers({ active: showActive() });
  });

  return () => (
    <div>
      <label>
        <input
          type="checkbox"
          checked={showActive()}
          on:change={(e) => showActive.set(e.target.checked)}
        />
        Show active only
      </label>

      {#if users()}
        <ul>
          {#each users() as user}
            <li>{user.name}</li>
          {/each}
        </ul>
      {/if}
    </div>
  );
});
```

**Key Points**:
- Full TypeScript type safety via interface
- Automatic refetch when `showActive` changes
- No manual API routes needed

### Example 5: Optimistic Update

**Scenario**: Like a post with instant feedback

```typescript
import { defineComponent, signal, resource, inject } from 'aether';
import { NetronClient } from 'aether/netron';
import { IPostService } from '@/shared/contracts/post.contract';

const PostCard = defineComponent<{ postId: string }>((props) => {
  const netron = inject(NetronClient);

  const post = resource(async () => {
    const service = await netron.queryInterface<IPostService>('posts@1.0.0');
    return service.getPost(props.postId);
  });

  const isLiking = signal(false);

  const handleLike = async () => {
    if (isLiking()) return;

    isLiking.set(true);
    const previous = post();

    // Optimistic update - instant UI feedback!
    post.mutate({
      ...previous,
      liked: true,
      likes: previous.likes + 1
    });

    try {
      const service = await netron.queryInterface<IPostService>('posts@1.0.0');
      const updated = await service.likePost(props.postId);

      // Update with server response
      post.mutate(updated);
    } catch (err) {
      // Rollback on error
      post.mutate(previous);
      toast.error('Failed to like post');
    } finally {
      isLiking.set(false);
    }
  };

  return () => (
    <div class="post-card">
      {#if post()}
        <h3>{post().title}</h3>
        <p>{post().content}</p>

        <button
          on:click={handleLike}
          disabled={isLiking()}
          class:liked={post().liked}
        >
          ❤️ {post().likes}
        </button>
      {/if}
    </div>
  );
});
```

**Key Points**:
- Optimistic UI update with `post.mutate()`
- Rollback on error
- Proper loading state management

### Example 6: Pagination

**Scenario**: Paginated list with page state

```typescript
import { defineComponent, signal, resource, computed } from 'aether';

const PaginatedUsers = defineComponent(() => {
  const page = signal(1);
  const pageSize = 10;

  const users = resource(() =>
    fetch(`/api/users?page=${page()}&limit=${pageSize}`)
      .then(r => r.json())
  );

  const totalPages = computed(() =>
    users() ? Math.ceil(users().total / pageSize) : 0
  );

  const hasPrevious = computed(() => page() > 1);
  const hasNext = computed(() => page() < totalPages());

  return () => (
    <div>
      {#if users()}
        <ul>
          {#each users().data as user}
            <li>{user.name}</li>
          {/each}
        </ul>

        <div class="pagination">
          <button
            on:click={() => page.set(page() - 1)}
            disabled={!hasPrevious()}
          >
            Previous
          </button>

          <span>Page {page()} of {totalPages()}</span>

          <button
            on:click={() => page.set(page() + 1)}
            disabled={!hasNext()}
          >
            Next
          </button>
        </div>
      {/if}
    </div>
  );
});
```

**Key Points**:
- Automatic refetch when `page` changes
- Computed values for pagination logic
- Disabled states for boundary conditions

---

## Advanced Patterns

### Example 7: Store with Real-Time Sync

**Scenario**: Shopping cart with real-time updates from server

```typescript
import { Injectable, signal, computed, inject } from 'aether';
import { NetronClient } from 'aether/netron';
import { ICartService } from '@/shared/contracts/cart.contract';

interface CartItem {
  productId: string;
  quantity: number;
  price: number;
}

@Injectable()
export class CartStore {
  private items = signal<CartItem[]>([]);
  private loading = signal(false);
  private error = signal<Error | null>(null);

  // Computed values
  total = computed(() =>
    this.items().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );

  itemCount = computed(() =>
    this.items().reduce((sum, item) => sum + item.quantity, 0)
  );

  constructor(private netron: NetronClient) {
    // Real-time sync from server
    this.netron.subscribe('cart.updated', this.handleCartUpdated.bind(this));
    this.netron.subscribe('cart.item.added', this.handleItemAdded.bind(this));
    this.netron.subscribe('cart.item.removed', this.handleItemRemoved.bind(this));
  }

  async loadCart() {
    this.loading.set(true);
    this.error.set(null);

    try {
      const service = await this.netron.queryInterface<ICartService>('cart@1.0.0');
      const cart = await service.getCart();
      this.items.set(cart.items);
    } catch (err) {
      this.error.set(err as Error);
    } finally {
      this.loading.set(false);
    }
  }

  async addItem(productId: string, quantity: number = 1) {
    // Optimistic update
    const existingItem = this.items().find(i => i.productId === productId);

    if (existingItem) {
      this.items.set(
        this.items().map(item =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      );
    } else {
      // Need to fetch product price
      const service = await this.netron.queryInterface<ICartService>('cart@1.0.0');
      const product = await service.getProduct(productId);

      this.items.set([
        ...this.items(),
        { productId, quantity, price: product.price }
      ]);
    }

    // Sync with server
    try {
      const service = await this.netron.queryInterface<ICartService>('cart@1.0.0');
      await service.addToCart(productId, quantity);
    } catch (err) {
      // Server will send cart.updated event to sync state
      console.error('Failed to add item:', err);
    }
  }

  async removeItem(productId: string) {
    // Optimistic update
    const previous = this.items();
    this.items.set(this.items().filter(i => i.productId !== productId));

    try {
      const service = await this.netron.queryInterface<ICartService>('cart@1.0.0');
      await service.removeFromCart(productId);
    } catch (err) {
      // Rollback
      this.items.set(previous);
      throw err;
    }
  }

  async updateQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      return this.removeItem(productId);
    }

    // Optimistic update
    const previous = this.items();
    this.items.set(
      this.items().map(item =>
        item.productId === productId ? { ...item, quantity } : item
      )
    );

    try {
      const service = await this.netron.queryInterface<ICartService>('cart@1.0.0');
      await service.updateQuantity(productId, quantity);
    } catch (err) {
      // Rollback
      this.items.set(previous);
      throw err;
    }
  }

  // Getters
  getItems() {
    return this.items;
  }

  isLoading() {
    return this.loading;
  }

  getError() {
    return this.error;
  }

  // Real-time event handlers
  private handleCartUpdated(cart: { items: CartItem[] }) {
    this.items.set(cart.items);
  }

  private handleItemAdded(item: CartItem) {
    const existingItem = this.items().find(i => i.productId === item.productId);

    if (existingItem) {
      this.items.set(
        this.items().map(i =>
          i.productId === item.productId
            ? { ...i, quantity: i.quantity + item.quantity }
            : i
        )
      );
    } else {
      this.items.set([...this.items(), item]);
    }
  }

  private handleItemRemoved(productId: string) {
    this.items.set(this.items().filter(i => i.productId !== productId));
  }
}
```

**Key Points**:
- Centralized state management
- Real-time WebSocket subscriptions
- Optimistic updates with rollback
- Computed derived values
- Clean separation of concerns

### Example 8: Infinite Scroll

**Scenario**: Load more items as user scrolls

```typescript
import { defineComponent, signal, onMount, onCleanup } from 'aether';

const InfiniteList = defineComponent(() => {
  const items = signal<Item[]>([]);
  const page = signal(1);
  const loading = signal(false);
  const hasMore = signal(true);

  const loadMore = async () => {
    if (loading() || !hasMore()) return;

    loading.set(true);

    try {
      const response = await fetch(`/api/items?page=${page()}`);
      const data = await response.json();

      items.set([...items(), ...data.items]);
      hasMore.set(data.hasMore);
      page.set(page() + 1);
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      loading.set(false);
    }
  };

  // Initial load
  onMount(() => {
    loadMore();
  });

  // Intersection observer for infinite scroll
  let observer: IntersectionObserver;
  let sentinelRef: HTMLElement;

  onMount(() => {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 1.0 }
    );

    if (sentinelRef) {
      observer.observe(sentinelRef);
    }
  });

  onCleanup(() => {
    observer?.disconnect();
  });

  return () => (
    <div>
      <ul>
        {#each items() as item}
          <li>{item.name}</li>
        {/each}
      </ul>

      {#if hasMore()}
        <div ref={sentinelRef} class="sentinel">
          {#if loading()}
            <Spinner />
          {/if}
        </div>
      {:else}
        <p>No more items</p>
      {/if}
    </div>
  );
});
```

**Key Points**:
- Manual state management for complex UI
- Intersection Observer for scroll detection
- Proper cleanup with `onCleanup`
- Append-only updates for performance

### Example 9: Parallel Requests

**Scenario**: Load multiple related resources in parallel

```typescript
import { defineComponent, resource } from 'aether';

const UserDashboard = defineComponent<{ userId: string }>((props) => {
  // All three load in parallel!
  const user = resource(() =>
    fetch(`/api/users/${props.userId}`).then(r => r.json())
  );

  const posts = resource(() =>
    fetch(`/api/users/${props.userId}/posts`).then(r => r.json())
  );

  const stats = resource(() =>
    fetch(`/api/users/${props.userId}/stats`).then(r => r.json())
  );

  const allLoaded = computed(() =>
    !user.loading() && !posts.loading() && !stats.loading()
  );

  const anyError = computed(() =>
    user.error() || posts.error() || stats.error()
  );

  return () => (
    <div>
      {#if anyError()}
        <Error error={anyError()} />
      {:else if !allLoaded()}
        <Spinner />
      {:else}
        <div>
          <UserProfile user={user()} />
          <UserStats stats={stats()} />
          <PostList posts={posts()} />
        </div>
      {/if}
    </div>
  );
});
```

**Key Points**:
- Multiple resources load in parallel automatically
- Computed helpers for aggregate states
- Wait for all before rendering

---

## Real-World Scenarios

### Example 10: Multi-Step Form with Auto-Save

**Scenario**: Form that saves progress automatically

```typescript
import { defineComponent, signal, effect, inject } from 'aether';
import { NetronClient } from 'aether/netron';
import { IFormService } from '@/shared/contracts/form.contract';

const MultiStepForm = defineComponent(() => {
  const netron = inject(NetronClient);

  const formData = signal({
    step1: { name: '', email: '' },
    step2: { address: '', city: '' },
    step3: { preferences: [] }
  });

  const currentStep = signal(1);
  const saving = signal(false);
  const lastSaved = signal<Date | null>(null);

  // Auto-save with debouncing
  let saveTimeoutId: number;
  effect(() => {
    const data = formData(); // Track changes

    clearTimeout(saveTimeoutId);
    saveTimeoutId = setTimeout(async () => {
      await saveProgress(data);
    }, 2000); // Debounce 2 seconds
  });

  const saveProgress = async (data: typeof formData.value) => {
    saving.set(true);

    try {
      const service = await netron.queryInterface<IFormService>('forms@1.0.0');
      await service.saveProgress(data);
      lastSaved.set(new Date());
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      saving.set(false);
    }
  };

  const updateField = (step: number, field: string, value: any) => {
    formData.set({
      ...formData(),
      [`step${step}`]: {
        ...formData()[`step${step}`],
        [field]: value
      }
    });
  };

  return () => (
    <div>
      <div class="save-indicator">
        {#if saving()}
          <span>Saving...</span>
        {:else if lastSaved()}
          <span>Last saved: {lastSaved().toLocaleTimeString()}</span>
        {/if}
      </div>

      {#if currentStep() === 1}
        <Step1
          data={formData().step1}
          onUpdate={(field, value) => updateField(1, field, value)}
        />
      {:else if currentStep() === 2}
        <Step2
          data={formData().step2}
          onUpdate={(field, value) => updateField(2, field, value)}
        />
      {:else}
        <Step3
          data={formData().step3}
          onUpdate={(field, value) => updateField(3, field, value)}
        />
      {/if}

      <div class="navigation">
        <button
          on:click={() => currentStep.set(currentStep() - 1)}
          disabled={currentStep() === 1}
        >
          Previous
        </button>

        <button
          on:click={() => currentStep.set(currentStep() + 1)}
          disabled={currentStep() === 3}
        >
          Next
        </button>
      </div>
    </div>
  );
});
```

**Key Points**:
- Auto-save with debouncing via effects
- Optimistic UI updates
- Save indicator feedback
- Multi-step navigation

### Example 11: Real-Time Collaborative List

**Scenario**: Todo list synced across multiple users

```typescript
import { Injectable, signal, inject } from 'aether';
import { NetronClient } from 'aether/netron';
import { ITodoService } from '@/shared/contracts/todo.contract';

interface Todo {
  id: string;
  text: string;
  done: boolean;
  userId: string;
  createdAt: Date;
}

@Injectable()
export class TodoStore {
  private todos = signal<Todo[]>([]);
  private loading = signal(false);

  constructor(private netron: NetronClient) {
    // Real-time sync
    this.netron.subscribe('todo.created', this.handleTodoCreated.bind(this));
    this.netron.subscribe('todo.updated', this.handleTodoUpdated.bind(this));
    this.netron.subscribe('todo.deleted', this.handleTodoDeleted.bind(this));
  }

  async loadTodos() {
    this.loading.set(true);

    try {
      const service = await this.netron.queryInterface<ITodoService>('todos@1.0.0');
      const todos = await service.getTodos();
      this.todos.set(todos);
    } finally {
      this.loading.set(false);
    }
  }

  async createTodo(text: string) {
    // Optimistic ID (replaced when server responds)
    const tempId = `temp-${Date.now()}`;

    const newTodo: Todo = {
      id: tempId,
      text,
      done: false,
      userId: 'current-user',
      createdAt: new Date()
    };

    // Optimistic update
    this.todos.set([...this.todos(), newTodo]);

    try {
      const service = await this.netron.queryInterface<ITodoService>('todos@1.0.0');
      const created = await service.createTodo(text);

      // Replace temp with real
      this.todos.set(
        this.todos().map(t => t.id === tempId ? created : t)
      );
    } catch (err) {
      // Remove failed todo
      this.todos.set(this.todos().filter(t => t.id !== tempId));
      throw err;
    }
  }

  async toggleTodo(id: string) {
    // Optimistic update
    this.todos.set(
      this.todos().map(t =>
        t.id === id ? { ...t, done: !t.done } : t
      )
    );

    try {
      const service = await this.netron.queryInterface<ITodoService>('todos@1.0.0');
      await service.toggleTodo(id);
    } catch (err) {
      // Server will send todo.updated to fix state
      console.error('Failed to toggle:', err);
    }
  }

  async deleteTodo(id: string) {
    // Optimistic delete
    const previous = this.todos();
    this.todos.set(this.todos().filter(t => t.id !== id));

    try {
      const service = await this.netron.queryInterface<ITodoService>('todos@1.0.0');
      await service.deleteTodo(id);
    } catch (err) {
      // Rollback
      this.todos.set(previous);
      throw err;
    }
  }

  getTodos() {
    return this.todos;
  }

  isLoading() {
    return this.loading;
  }

  // Real-time handlers
  private handleTodoCreated(todo: Todo) {
    // Avoid duplicates (might be our own creation)
    if (this.todos().some(t => t.id === todo.id)) return;
    this.todos.set([...this.todos(), todo]);
  }

  private handleTodoUpdated(todo: Todo) {
    this.todos.set(
      this.todos().map(t => t.id === todo.id ? todo : t)
    );
  }

  private handleTodoDeleted(todoId: string) {
    this.todos.set(this.todos().filter(t => t.id !== todoId));
  }
}
```

**Key Points**:
- Real-time collaboration via WebSocket events
- Optimistic updates with temporary IDs
- Conflict resolution (server wins)
- Duplicate prevention

---

## Performance Optimization

### Example 12: Caching with TTL

**Scenario**: Cache expensive API calls for 5 minutes

```typescript
import { resource } from 'aether';

// Simple cache implementation
const cache = new Map<string, { data: any; expiresAt: number }>();

const cachedFetch = (url: string, ttl: number = 5 * 60 * 1000) => {
  const cached = cache.get(url);

  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }

  return fetch(url)
    .then(r => r.json())
    .then(data => {
      cache.set(url, {
        data,
        expiresAt: Date.now() + ttl
      });
      return data;
    });
};

// Usage
const ProductPage = defineComponent(() => {
  const products = resource(() => cachedFetch('/api/products'));

  return () => (
    <div>
      {products() && products().map(p => <ProductCard product={p} />)}
    </div>
  );
});
```

**Key Points**:
- Simple Map-based cache
- TTL-based expiration
- Transparent caching

### Example 13: Request Deduplication

**Scenario**: Prevent duplicate requests for same data

```typescript
// Prevent duplicate in-flight requests
const pendingRequests = new Map<string, Promise<any>>();

const deduplicatedFetch = <T>(url: string): Promise<T> => {
  const pending = pendingRequests.get(url);
  if (pending) {
    return pending;
  }

  const request = fetch(url)
    .then(r => r.json())
    .finally(() => {
      pendingRequests.delete(url);
    });

  pendingRequests.set(url, request);
  return request;
};

// Usage - multiple calls only result in one request
const user1 = resource(() => deduplicatedFetch('/api/user/1'));
const user2 = resource(() => deduplicatedFetch('/api/user/1')); // Reuses same request!
```

**Key Points**:
- Deduplicates concurrent requests
- Automatic cleanup after resolution
- Transparent to consumers

### Example 14: Virtual Scrolling for Large Lists

**Scenario**: Efficiently render 10,000+ items

```typescript
import { defineComponent, signal, computed, onMount } from 'aether';

const VirtualList = defineComponent<{ items: any[] }>((props) => {
  const containerHeight = 600;
  const itemHeight = 50;
  const visibleCount = Math.ceil(containerHeight / itemHeight);

  const scrollTop = signal(0);

  const startIndex = computed(() =>
    Math.floor(scrollTop() / itemHeight)
  );

  const endIndex = computed(() =>
    Math.min(startIndex() + visibleCount + 1, props.items.length)
  );

  const visibleItems = computed(() =>
    props.items.slice(startIndex(), endIndex())
  );

  const totalHeight = computed(() =>
    props.items.length * itemHeight
  );

  const offsetY = computed(() =>
    startIndex() * itemHeight
  );

  const handleScroll = (e: Event) => {
    scrollTop.set((e.target as HTMLElement).scrollTop);
  };

  return () => (
    <div
      class="virtual-list"
      style={{ height: `${containerHeight}px`, overflow: 'auto' }}
      on:scroll={handleScroll}
    >
      <div style={{ height: `${totalHeight()}px`, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${offsetY()}px)`,
            position: 'absolute',
            width: '100%'
          }}
        >
          {#each visibleItems() as item, index}
            <div
              style={{ height: `${itemHeight}px` }}
              key={startIndex() + index}
            >
              {item.name}
            </div>
          {/each}
        </div>
      </div>
    </div>
  );
});
```

**Key Points**:
- Only render visible items
- Computed values for derived state
- Smooth scrolling with transforms

---

## Testing Patterns

### Example 15: Testing Resources

**Scenario**: Unit test component with resource

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@aether/testing';
import { UserList } from './UserList';

describe('UserList', () => {
  it('loads and displays users', async () => {
    // Mock fetch
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve([
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' }
        ])
      })
    );

    const { getByText, queryByText } = render(<UserList />);

    // Loading state
    expect(getByText('Loading users...')).toBeInTheDocument();

    // Wait for data
    await waitFor(() => {
      expect(queryByText('Loading users...')).not.toBeInTheDocument();
    });

    // Data displayed
    expect(getByText('Alice')).toBeInTheDocument();
    expect(getByText('Bob')).toBeInTheDocument();
  });

  it('handles errors', async () => {
    // Mock fetch error
    global.fetch = vi.fn(() =>
      Promise.reject(new Error('Network error'))
    );

    const { getByText } = render(<UserList />);

    await waitFor(() => {
      expect(getByText(/Failed to load users/)).toBeInTheDocument();
    });
  });
});
```

**Key Points**:
- Mock fetch for isolated tests
- Test loading/error/success states
- Use `waitFor` for async updates

### Example 16: Testing Stores

**Scenario**: Unit test store with mocked Netron

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CartStore } from './cart.store';

describe('CartStore', () => {
  it('adds item to cart', async () => {
    // Mock Netron client
    const mockNetron = {
      queryInterface: vi.fn(() =>
        Promise.resolve({
          addToCart: vi.fn(() => Promise.resolve()),
          getProduct: vi.fn(() =>
            Promise.resolve({ id: 'p1', price: 10 })
          )
        })
      ),
      subscribe: vi.fn()
    };

    const store = new CartStore(mockNetron as any);

    // Add item
    await store.addItem('p1', 2);

    // Check state
    const items = store.getItems()();
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      productId: 'p1',
      quantity: 2,
      price: 10
    });

    // Check RPC called
    expect(mockNetron.queryInterface).toHaveBeenCalledWith('cart@1.0.0');
  });

  it('handles optimistic update rollback', async () => {
    const mockNetron = {
      queryInterface: vi.fn(() =>
        Promise.resolve({
          removeFromCart: vi.fn(() => Promise.reject(new Error('Server error')))
        })
      ),
      subscribe: vi.fn()
    };

    const store = new CartStore(mockNetron as any);

    // Setup initial state
    store.getItems().set([
      { productId: 'p1', quantity: 1, price: 10 }
    ]);

    // Try to remove (will fail)
    await expect(store.removeItem('p1')).rejects.toThrow();

    // Check rollback
    expect(store.getItems()()).toHaveLength(1);
  });
});
```

**Key Points**:
- Mock external dependencies (Netron)
- Test optimistic update rollback
- Verify RPC calls

---

## Conclusion

This cookbook demonstrates Aether's data fetching patterns from simple to complex:

1. **Simple cases are simple** - `resource()` with zero config
2. **Progressive enhancement** - Add features as needed
3. **Type safety** - Full TypeScript inference with Netron
4. **Explicit control** - No magic, predictable behavior
5. **Performance** - Efficient patterns for production

The key insight: **start simple, add complexity only when needed**. Most use cases (80%+) can be solved with basic `resource()`, and advanced patterns are available when required.
