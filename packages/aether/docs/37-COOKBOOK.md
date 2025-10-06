# 37. Cookbook - Recipes and Patterns

## Table of Contents
- [Overview](#overview)
- [Authentication Patterns](#authentication-patterns)
- [Data Loading Patterns](#data-loading-patterns)
- [Form Patterns](#form-patterns)
- [State Management Patterns](#state-management-patterns)
- [Performance Patterns](#performance-patterns)
- [Layout Patterns](#layout-patterns)
- [Modal and Dialog Patterns](#modal-and-dialog-patterns)
- [List and Table Patterns](#list-and-table-patterns)
- [Search and Filter Patterns](#search-and-filter-patterns)
- [File Upload Patterns](#file-upload-patterns)
- [Real-time Patterns](#real-time-patterns)
- [Error Handling Patterns](#error-handling-patterns)
- [Testing Patterns](#testing-patterns)
- [Deployment Patterns](#deployment-patterns)

## Overview

Common patterns and solutions for building Aether applications.

### Recipe Format

```typescript
/**
 * Each recipe includes:
 *
 * 1. Problem: What issue does it solve?
 * 2. Solution: Complete working code
 * 3. Explanation: How it works
 * 4. Variations: Alternative approaches
 * 5. Gotchas: Common pitfalls
 */
```

## Authentication Patterns

### Protected Routes

**Problem**: Restrict access to authenticated users only.

**Solution**:

```typescript
// auth/ProtectedRoute.tsx
import { defineComponent, Show } from '@aether/core';
import { useAuth } from './useAuth';
import { Navigate } from '@aether/router';

export const ProtectedRoute = defineComponent((props: {
  children: JSX.Element;
  fallback?: string;
}) => {
  const { user, loading } = useAuth();

  return () => (
    <Show
      when={!loading()}
      fallback={<div>Loading...</div>}
    >
      <Show
        when={user()}
        fallback={<Navigate href={props.fallback || '/login'} />}
      >
        {props.children}
      </Show>
    </Show>
  );
});

// Usage
<ProtectedRoute>
  <Dashboard />
</ProtectedRoute>
```

### JWT Authentication

**Problem**: Manage JWT tokens and refresh flow.

**Solution**:

```typescript
// auth/useAuth.ts
import { signal, createEffect, onCleanup, onMount } from '@aether/core';

export const useAuth = () => {
  const user = signal<User | null>(null);
  const token = signal<string | null>(null);
  const loading = signal(true);

  // Load token from localStorage
  onMount(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      token.set(savedToken);
      verifyToken(savedToken);
    } else {
      loading.set(false);
    }
  });

  // Verify token
  const verifyToken = async (token: string) => {
    try {
      const response = await fetch('/api/auth/verify', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const user = await response.json();
        user.set(user);
      } else {
        logout();
      }
    } catch (error) {
      logout();
    } finally {
      loading.set(false);
    }
  };

  // Login
  const login = async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const { token, user } = await response.json();
    localStorage.setItem('token', token);
    token.set(token);
    user.set(user);
  };

  // Logout
  const logout = () => {
    localStorage.removeItem('token');
    token.set(null);
    user.set(null);
  };

  // Refresh token
  const refreshToken = async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token()}` }
    });

    if (response.ok) {
      const { token: newToken } = await response.json();
      localStorage.setItem('token', newToken);
      token.set(newToken);
    } else {
      logout();
    }
  };

  // Auto-refresh token
  createEffect(() => {
    if (token()) {
      // Refresh token every 14 minutes (if expires in 15)
      const interval = setInterval(() => {
        refreshToken();
      }, 14 * 60 * 1000);

      onCleanup(() => clearInterval(interval));
    }
  });

  return {
    user,
    token,
    loading,
    login,
    logout
  };
};
```

### Role-Based Access Control

**Problem**: Restrict features based on user roles.

**Solution**:

```typescript
// auth/usePermissions.ts
import { computed } from '@aether/core';
import { useAuth } from './useAuth';

export enum Permission {
  READ_USERS = 'read:users',
  WRITE_USERS = 'write:users',
  DELETE_USERS = 'delete:users',
  ADMIN = 'admin'
}

export const usePermissions = () => {
  const { user } = useAuth();

  const hasPermission = (permission: Permission) => {
    return computed(() => {
      const currentUser = user();
      if (!currentUser) return false;
      return currentUser.permissions?.includes(permission) || false;
    });
  };

  const hasAnyPermission = (...permissions: Permission[]) => {
    return computed(() => {
      const currentUser = user();
      if (!currentUser) return false;
      return permissions.some(p => currentUser.permissions?.includes(p));
    });
  };

  const hasAllPermissions = (...permissions: Permission[]) => {
    return computed(() => {
      const currentUser = user();
      if (!currentUser) return false;
      return permissions.every(p => currentUser.permissions?.includes(p));
    });
  };

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions
  };
};

// Usage
export const UserManagement = defineComponent(() => {
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission(Permission.DELETE_USERS);

  return () => (
    <div>
      <h1>Users</h1>
      <Show when={canDelete()}>
        <button onClick={deleteUser}>Delete</button>
      </Show>
    </div>
  );
});
```

## Data Loading Patterns

### Infinite Scroll

**Problem**: Load data incrementally as user scrolls.

**Solution**:

```typescript
import { signal, createEffect, onCleanup, onMount } from '@aether/core';

export const useInfiniteScroll = <T>(
  fetchFn: (page: number) => Promise<T[]>,
  options: { threshold?: number } = {}
) => {
  const items = signal<T[]>([]);
  const page = signal(1);
  const loading = signal(false);
  const hasMore = signal(true);

  // Load more items
  const loadMore = async () => {
    if (loading() || !hasMore()) return;

    loading.set(true);
    try {
      const newItems = await fetchFn(page());

      if (newItems.length === 0) {
        hasMore.set(false);
      } else {
        items.set([...items(), ...newItems]);
        page.set(page() + 1);
      }
    } catch (error) {
      console.error('Failed to load more:', error);
    } finally {
      loading.set(false);
    }
  };

  // Intersection observer for auto-loading
  const observerRef = (element: HTMLElement) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: options.threshold || 0.1 }
    );

    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };

  // Load initial page
  onMount(() => {
    loadMore();
  });

  return {
    items,
    loading,
    hasMore,
    loadMore,
    observerRef
  };
};

// Usage
export const InfiniteList = defineComponent(() => {
  const { items, loading, hasMore, observerRef } = useInfiniteScroll(
    (page) => fetch(`/api/items?page=${page}`).then(r => r.json())
  );

  return () => (
    <div>
      <For each={items()}>
        {(item) => <ItemCard item={item} />}
      </For>

      <Show when={hasMore()}>
        <div ref={observerRef} class="loader">
          {loading() ? 'Loading...' : 'Load more'}
        </div>
      </Show>
    </div>
  );
});
```

### Optimistic Updates

**Problem**: Update UI immediately before server confirms.

**Solution**:

```typescript
export const useTodoList = () => {
  const todos = signal<Todo[]>([]);

  const addTodo = async (text: string) => {
    // Optimistic update
    const optimisticTodo: Todo = {
      id: `temp-${Date.now()}`,
      text,
      done: false,
      optimistic: true
    };
    todos.set([...todos(), optimisticTodo]);

    try {
      // Server request
      const newTodo = await fetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify({ text })
      }).then(r => r.json());

      // Replace optimistic with real
      todos.set(todos().map(t =>
        t.id === optimisticTodo.id ? newTodo : t
      ));
    } catch (error) {
      // Rollback on error
      todos.set(todos().filter(t => t.id !== optimisticTodo.id));
      throw error;
    }
  };

  const toggleTodo = async (id: string) => {
    // Save current state
    const previousTodos = [...todos()];

    // Optimistic update
    todos.set(todos().map(t =>
      t.id === id ? { ...t, done: !t.done } : t
    ));

    try {
      await fetch(`/api/todos/${id}/toggle`, { method: 'POST' });
    } catch (error) {
      // Rollback on error
      todos.set(previousTodos);
      throw error;
    }
  };

  return { todos, addTodo, toggleTodo };
};
```

### Polling

**Problem**: Fetch fresh data at regular intervals.

**Solution**:

```typescript
export const usePolling = <T>(
  fetchFn: () => Promise<T>,
  interval: number = 5000
) => {
  const data = signal<T | null>(null);
  const error = signal<Error | null>(null);

  const poll = async () => {
    try {
      const result = await fetchFn();
      data.set(result);
      error.set(null);
    } catch (err) {
      error.set(err as Error);
    }
  };

  onMount(() => {
    // Initial fetch
    poll();

    // Start polling
    const intervalId = setInterval(poll, interval);

    onCleanup(() => clearInterval(intervalId));
  });

  return { data, error };
};

// Usage
export const LiveStats = defineComponent(() => {
  const { data: stats } = usePolling(
    () => fetch('/api/stats').then(r => r.json()),
    10000 // Poll every 10 seconds
  );

  return () => (
    <div>
      <Show when={stats()}>
        <div>Active Users: {stats()!.activeUsers}</div>
      </Show>
    </div>
  );
});
```

## Form Patterns

### Multi-Step Form

**Problem**: Guide users through complex forms.

**Solution**:

```typescript
export const useMultiStepForm = (steps: number) => {
  const currentStep = signal(0);
  const [formData, setFormData] = createStore<any>({});

  const isFirstStep = computed(() => currentStep() === 0);
  const isLastStep = computed(() => currentStep() === steps - 1);

  const nextStep = () => {
    if (!isLastStep()) {
      currentStep.set(currentStep() + 1);
    }
  };

  const prevStep = () => {
    if (!isFirstStep()) {
      currentStep.set(currentStep() - 1);
    }
  };

  const updateFormData = (data: any) => {
    setFormData(data);
  };

  return {
    currentStep,
    formData,
    isFirstStep,
    isLastStep,
    nextStep,
    prevStep,
    updateFormData
  };
};

// Usage
export const RegistrationForm = defineComponent(() => {
  const { currentStep, formData, isFirstStep, isLastStep, nextStep, prevStep, updateFormData } =
    useMultiStepForm(3);

  const handleSubmit = async () => {
    await fetch('/api/register', {
      method: 'POST',
      body: JSON.stringify(formData)
    });
  };

  return () => (
    <div>
      <div class="progress-bar">
        Step {currentStep() + 1} of 3
      </div>

      <Switch>
        <Match when={currentStep() === 0}>
          <PersonalInfoStep data={formData} onChange={updateFormData} />
        </Match>
        <Match when={currentStep() === 1}>
          <AccountInfoStep data={formData} onChange={updateFormData} />
        </Match>
        <Match when={currentStep() === 2}>
          <ReviewStep data={formData} />
        </Match>
      </Switch>

      <div class="actions">
        <Show when={!isFirstStep()}>
          <button onClick={prevStep}>Back</button>
        </Show>
        <Show when={!isLastStep()}>
          <button onClick={nextStep}>Next</button>
        </Show>
        <Show when={isLastStep()}>
          <button onClick={handleSubmit}>Submit</button>
        </Show>
      </div>
    </div>
  );
});
```

### Dynamic Field Array

**Problem**: Add/remove form fields dynamically.

**Solution**:

```typescript
export const DynamicFieldArray = defineComponent(() => {
  const fields = signal<Array<{ id: string; value: string }>>([
    { id: '1', value: '' }
  ]);

  const addField = () => {
    fields.set([...fields(), { id: Date.now().toString(), value: '' }]);
  };

  const removeField = (id: string) => {
    fields.set(fields().filter(f => f.id !== id));
  };

  const updateField = (id: string, value: string) => {
    fields.set(fields().map(f => f.id === id ? { ...f, value } : f));
  };

  return () => (
    <div>
      <For each={fields()}>
        {(field) => (
          <div class="field-row">
            <input
              value={field.value}
              onInput={(e) => updateField(field.id, e.currentTarget.value)}
            />
            <Show when={fields().length > 1}>
              <button onClick={() => removeField(field.id)}>Remove</button>
            </Show>
          </div>
        )}
      </For>
      <button onClick={addField}>Add Field</button>
    </div>
  );
});
```

## State Management Patterns

### Global Store

**Problem**: Share state across components.

**Solution**:

```typescript
// store/app.ts
import { createStore } from '@aether/core';

export const [appState, setAppState] = createStore({
  user: null as User | null,
  theme: 'light' as 'light' | 'dark',
  notifications: [] as Notification[],
  sidebarOpen: false
});

export const appActions = {
  setUser: (user: User | null) => {
    setAppState('user', user);
  },

  toggleTheme: () => {
    setAppState('theme', theme => theme === 'light' ? 'dark' : 'light');
  },

  addNotification: (notification: Notification) => {
    setAppState('notifications', [...appState.notifications, notification]);
  },

  removeNotification: (id: string) => {
    setAppState('notifications', notifs => notifs.filter(n => n.id !== id));
  },

  toggleSidebar: () => {
    setAppState('sidebarOpen', open => !open);
  }
};

// Usage in component
export const Header = defineComponent(() => {
  return () => (
    <header>
      <button onClick={appActions.toggleTheme}>
        {appState.theme === 'light' ? '🌙' : '☀️'}
      </button>
      <div>Welcome, {appState.user?.name}</div>
    </header>
  );
});
```

### Local Storage Persistence

**Problem**: Persist state across page reloads.

**Solution**:

```typescript
import { createStore, createEffect } from '@aether/core';

export const createPersistedStore = <T extends object>(
  key: string,
  initialValue: T
) => {
  // Load from localStorage
  const loadState = (): T => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : initialValue;
    } catch {
      return initialValue;
    }
  };

  const [state, setState] = createStore<T>(loadState());

  // Save to localStorage on change
  createEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  });

  return [state, setState] as const;
};

// Usage
const [settings, setSettings] = createPersistedStore('app-settings', {
  theme: 'light',
  language: 'en'
});
```

## Performance Patterns

### Virtual List

**Problem**: Render large lists efficiently.

**Solution**:

```typescript
export const VirtualList = defineComponent(<T,>(props: {
  items: T[];
  itemHeight: number;
  height: number;
  renderItem: (item: T, index: number) => JSX.Element;
}) => {
  const scrollTop = signal(0);

  const visibleRange = computed(() => {
    const start = Math.floor(scrollTop() / props.itemHeight);
    const end = Math.ceil((scrollTop() + props.height) / props.itemHeight);
    return { start, end };
  });

  const visibleItems = computed(() => {
    const { start, end } = visibleRange();
    return props.items.slice(start, end + 1);
  });

  const totalHeight = computed(() => props.items.length * props.itemHeight);
  const offsetY = computed(() => visibleRange().start * props.itemHeight);

  return () => (
    <div
      class="virtual-list"
      style={{ height: `${props.height}px`, overflow: 'auto' }}
      onScroll={(e) => scrollTop.set(e.currentTarget.scrollTop)}
    >
      <div style={{ height: `${totalHeight()}px`, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY()}px)` }}>
          <For each={visibleItems()}>
            {(item, index) => (
              <div style={{ height: `${props.itemHeight}px` }}>
                {props.renderItem(item, visibleRange().start + index())}
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
});

// Usage
<VirtualList
  items={items()}
  itemHeight={50}
  height={500}
  renderItem={(item) => <div>{item.name}</div>}
/>
```

### Debounced Input

**Problem**: Reduce API calls on rapid input.

**Solution**:

```typescript
export const useDebounced = <T>(value: Accessor<T>, delay: number = 300) => {
  const debouncedValue = signal(value())

  createEffect(() => {
    const currentValue = value();
    const timeout = setTimeout(() => {
      debouncedValue.set(currentValue);
    }, delay);

    onCleanup(() => clearTimeout(timeout));
  });

  return debouncedValue;
};

// Usage
export const SearchInput = defineComponent(() => {
  const query = signal('')
  const debouncedQuery = useDebounced(query, 500);

  // Only fires 500ms after user stops typing
  createEffect(() => {
    if (debouncedQuery()) {
      searchAPI(debouncedQuery());
    }
  });

  return () => (
    <input
      value={query()}
      onInput={(e) => query.set(e.currentTarget.value)}
      placeholder="Search..."
    />
  );
});
```

## Layout Patterns

### Responsive Sidebar

**Problem**: Adaptive sidebar for mobile/desktop.

**Solution**:

```typescript
export const Layout = defineComponent(() => {
  const sidebarOpen = signal(false);
  const isMobile = signal(false);

  onMount(() => {
    const checkMobile = () => {
      isMobile.set(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    onCleanup(() => window.removeEventListener('resize', checkMobile));
  });

  return () => (
    <div class="layout">
      {/* Overlay for mobile */}
      <Show when={isMobile() && sidebarOpen()}>
        <div
          class="overlay"
          onClick={() => sidebarOpen.set(false)}
        />
      </Show>

      {/* Sidebar */}
      <aside
        class="sidebar"
        classList={{
          open: sidebarOpen(),
          mobile: isMobile()
        }}
      >
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </aside>

      {/* Main content */}
      <main class="content">
        <Show when={isMobile()}>
          <button onClick={() => sidebarOpen.set(!sidebarOpen())}>
            ☰ Menu
          </button>
        </Show>
        {props.children}
      </main>
    </div>
  );
});
```

## Modal and Dialog Patterns

### Modal with Focus Trap

**Problem**: Accessible modal with keyboard navigation.

**Solution**:

```typescript
export const Modal = defineComponent((props: {
  open: boolean;
  onClose: () => void;
  title: string;
}) => {
  let dialogRef: HTMLDialogElement;
  let previousFocus: HTMLElement | null = null;

  createEffect(() => {
    if (props.open) {
      previousFocus = document.activeElement as HTMLElement;
      dialogRef?.showModal();
    } else {
      dialogRef?.close();
      previousFocus?.focus();
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose();
    }
  };

  return () => (
    <Show when={props.open}>
      <dialog
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        onClick={(e) => {
          if (e.target === dialogRef) {
            props.onClose();
          }
        }}
      >
        <div class="modal-content">
          <h2>{props.title}</h2>
          {props.children}
          <button onClick={props.onClose}>Close</button>
        </div>
      </dialog>
    </Show>
  );
});
```

## List and Table Patterns

### Sortable Table

**Problem**: Sort table columns.

**Solution**:

```typescript
export const SortableTable = defineComponent(<T,>(props: {
  data: T[];
  columns: Array<{
    key: keyof T;
    label: string;
    sortable?: boolean;
  }>;
}) => {
  const sortKey = signal<keyof T | null>(null);
  const sortDir = signal<'asc' | 'desc'>('asc');

  const sortedData = computed(() => {
    if (!sortKey()) return props.data;

    return [...props.data].sort((a, b) => {
      const aVal = a[sortKey()!];
      const bVal = b[sortKey()!];
      const dir = sortDir() === 'asc' ? 1 : -1;

      if (aVal < bVal) return -dir;
      if (aVal > bVal) return dir;
      return 0;
    });
  });

  const handleSort = (key: keyof T) => {
    if (sortKey() === key) {
      sortDir.set(dir => dir === 'asc' ? 'desc' : 'asc');
    } else {
      sortKey.set(key);
      sortDir.set('asc');
    }
  };

  return () => (
    <table>
      <thead>
        <tr>
          <For each={props.columns}>
            {(column) => (
              <th>
                <Show
                  when={column.sortable !== false}
                  fallback={column.label}
                >
                  <button onClick={() => handleSort(column.key)}>
                    {column.label}
                    {sortKey() === column.key && (
                      <span>{sortDir() === 'asc' ? ' ↑' : ' ↓'}</span>
                    )}
                  </button>
                </Show>
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={sortedData()}>
          {(row) => (
            <tr>
              <For each={props.columns}>
                {(column) => <td>{String(row[column.key])}</td>}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
});
```

## Search and Filter Patterns

### Client-Side Search

**Problem**: Filter items based on user input.

**Solution**:

```typescript
export const useSearch = <T>(
  items: Accessor<T[]>,
  searchFn: (item: T, query: string) => boolean
) => {
  const query = signal('')

  const filteredItems = computed(() => {
    const q = query().toLowerCase();
    if (!q) return items();
    return items().filter(item => searchFn(item, q));
  });

  return {
    query,
    setQuery,
    filteredItems
  };
};

// Usage
export const UserList = defineComponent(() => {
  const [users] = resource(fetchUsers);

  const { query, setQuery, filteredItems } = useSearch(
    () => users() || [],
    (user, query) => user.name.toLowerCase().includes(query)
  );

  return () => (
    <div>
      <input
        type="search"
        value={query()}
        onInput={(e) => query.set(e.currentTarget.value)}
        placeholder="Search users..."
      />
      <For each={filteredItems()}>
        {(user) => <UserCard user={user} />}
      </For>
    </div>
  );
});
```

## File Upload Patterns

### Drag and Drop Upload

**Problem**: Upload files via drag and drop.

**Solution**:

```typescript
export const FileUpload = defineComponent(() => {
  const files = signal<File[]>([]);
  const isDragging = signal(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    isDragging.set(false);

    const droppedFiles = Array.from(e.dataTransfer?.files || []);
    files.set([...files(), ...droppedFiles]);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    isDragging.set(true);
  };

  const handleDragLeave = () => {
    isDragging.set(false);
  };

  const uploadFiles = async () => {
    for (const file of files()) {
      const formData = new FormData();
      formData.append('file', file);

      await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
    }
  };

  return () => (
    <div
      class="upload-zone"
      classList={{ dragging: isDragging() }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <p>Drag files here or click to upload</p>

      <For each={files()}>
        {(file) => <div>{file.name}</div>}
      </For>

      <Show when={files().length > 0}>
        <button onClick={uploadFiles}>Upload</button>
      </Show>
    </div>
  );
});
```

## Real-time Patterns

### WebSocket Connection

**Problem**: Real-time updates via WebSocket.

**Solution**:

```typescript
export const useWebSocket = (url: string) => {
  const status = signal<'connecting' | 'open' | 'closed'>('connecting');
  const messages = signal<any[]>([]);
  let ws: WebSocket;

  onMount(() => {
    ws = new WebSocket(url);

    ws.onopen = () => {
      status.set('open');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      messages.set([...messages(), message]);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      status.set('closed');
    };

    onCleanup(() => {
      ws.close();
    });
  });

  const send = (data: any) => {
    if (ws && status() === 'open') {
      ws.send(JSON.stringify(data));
    }
  };

  return {
    status,
    messages,
    send
  };
};

// Usage
export const Chat = defineComponent(() => {
  const { status, messages, send } = useWebSocket('ws://localhost:3000');
  const input = signal('')

  const sendMessage = () => {
    send({ type: 'message', text: input() });
    input.set('');
  };

  return () => (
    <div>
      <div>Status: {status()}</div>
      <For each={messages()}>
        {(msg) => <div>{msg.text}</div>}
      </For>
      <input
        value={input()}
        onInput={(e) => input.set(e.currentTarget.value)}
      />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
});
```

## Error Handling Patterns

### Retry with Exponential Backoff

**Problem**: Retry failed requests intelligently.

**Solution**:

```typescript
export const fetchWithRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries reached');
};

// Usage
const user = await fetchWithRetry(() =>
  fetch('/api/user').then(r => r.json())
);
```

## Testing Patterns

### Component Testing

**Problem**: Test components with dependencies.

**Solution**:

```typescript
import { render, fireEvent } from '@aether/testing';

describe('Counter', () => {
  it('increments on click', async () => {
    const { getByText } = render(() => <Counter />);

    const button = getByText('Increment');
    await fireEvent.click(button);

    expect(getByText('Count: 1')).toBeInTheDocument();
  });

  it('calls onIncrement callback', async () => {
    const onIncrement = vi.fn();
    const { getByText } = render(() => (
      <Counter onIncrement={onIncrement} />
    ));

    await fireEvent.click(getByText('Increment'));

    expect(onIncrement).toHaveBeenCalledWith(1);
  });
});
```

## Deployment Patterns

### Environment-Based Configuration

**Problem**: Different configs for dev/staging/prod.

**Solution**:

```typescript
// config.ts
const configs = {
  development: {
    apiUrl: 'http://localhost:3000',
    analyticsId: null
  },
  staging: {
    apiUrl: 'https://staging-api.example.com',
    analyticsId: 'GA-STAGING'
  },
  production: {
    apiUrl: 'https://api.example.com',
    analyticsId: 'GA-PROD'
  }
};

export const config = configs[import.meta.env.MODE as keyof typeof configs];

// Usage
fetch(`${config.apiUrl}/users`);
```

## Summary

This cookbook provides battle-tested patterns for:

1. **Authentication**: Protected routes, JWT, RBAC
2. **Data Loading**: Infinite scroll, polling, optimistic updates
3. **Forms**: Multi-step, dynamic fields
4. **State**: Global stores, persistence
5. **Performance**: Virtual lists, debouncing
6. **Layout**: Responsive patterns
7. **Modals**: Focus management
8. **Tables**: Sorting, filtering
9. **Files**: Drag and drop upload
10. **Real-time**: WebSocket integration

Use these patterns as building blocks for your Aether applications.
