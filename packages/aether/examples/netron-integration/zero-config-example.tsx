/**
 * Zero-Config Netron Integration Example
 *
 * This example demonstrates the complete zero-config Netron integration
 * with Aether's DI system and reactive signals.
 *
 * Features demonstrated:
 * - Zero-config module setup
 * - Auto-configured service classes
 * - Reactive hooks (useQuery, useMutation)
 * - Optimistic updates
 * - Cache invalidation
 * - Type-safe RPC calls
 */

import { defineComponent, signal, computed, onMount } from '@omnitron-dev/aether';
import { Injectable, Module, bootstrapModule } from '@omnitron-dev/aether/di';
import { NetronModule, NetronService, useQuery, useMutation, Backend, Service } from '@omnitron-dev/aether/netron';

// ============================================================================
// SHARED CONTRACTS (Shared between Aether and Titan)
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: Date;
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
  getUsers(): Promise<User[]>;
  getUser(id: string): Promise<User>;
  createUser(data: CreateUserDto): Promise<User>;
  updateUser(id: string, data: UpdateUserDto): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

// ============================================================================
// SERVICES (Zero boilerplate!)
// ============================================================================

/**
 * UserService - Auto-configured with NetronModule
 *
 * No need to:
 * - Create HttpRemotePeer
 * - Configure cache manager
 * - Configure retry manager
 * - Implement any methods
 *
 * Everything is handled automatically by NetronService base class!
 */
@Injectable()
@Service('users@1.0.0') // Optional: Explicit service name
export class UserService extends NetronService<IUserService> {
  // That's it! All methods from IUserService are auto-available

  // Optional: Add convenience methods if needed
  async getActiveUsers(): Promise<User[]> {
    const users = await this.query('getUsers', [], {
      cache: { maxAge: 60000, tags: ['users', 'active-users'] },
    });
    return users.filter((u) => u.active);
  }
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * UserList Component - Demonstrates useQuery hook
 */
const UserList = defineComponent(() => {
  // useQuery returns reactive signals - NO external state management needed!
  const {
    data: users, // Signal<User[] | undefined>
    loading, // Signal<boolean>
    error, // Signal<Error | undefined>
    refetch, // () => Promise<void>
    isStale, // Signal<boolean>
  } = useQuery(UserService, 'getUsers', [], {
    cache: 60000, // Cache for 60 seconds
    refetchOnMount: true, // Refetch when component mounts
    refetchOnFocus: true, // Refetch when window gains focus
    // refetchInterval: 30000,       // Poll every 30 seconds (optional)
  });

  // Computed values work seamlessly with query data
  const activeUserCount = computed(() => {
    const userList = users();
    return userList ? userList.filter((u) => u.active).length : 0;
  });

  return () => (
    <div class="user-list">
      <div class="header">
        <h2>Users ({activeUserCount()} active)</h2>
        <button onClick={refetch} disabled={loading()}>
          {loading() ? 'Refreshing...' : 'Refresh'}
        </button>
        {isStale() && <span class="badge">Stale</span>}
      </div>

      {loading() && <div class="spinner">Loading users...</div>}

      {error() && (
        <div class="error">
          <strong>Error:</strong> {error()!.message}
        </div>
      )}

      {users() && (
        <ul class="list">
          {users()!.map((user) => (
            <li key={user.id} class={user.active ? 'active' : 'inactive'}>
              <span class="name">{user.name}</span>
              <span class="email">{user.email}</span>
              {user.active && <span class="badge">Active</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

/**
 * CreateUserForm - Demonstrates useMutation hook
 */
const CreateUserForm = defineComponent(() => {
  const name = signal('');
  const email = signal('');

  // useMutation with optimistic updates and cache invalidation
  const {
    mutate,
    loading,
    error,
    data: createdUser,
  } = useMutation(UserService, 'createUser', {
    // Success callback
    onSuccess: (newUser) => {
      console.log('User created:', newUser);
      // Clear form
      name.set('');
      email.set('');
    },
    // Error callback
    onError: (err) => {
      console.error('Failed to create user:', err);
    },
    // Invalidate related queries
    invalidate: ['users'],
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (name() && email()) {
      await mutate({
        name: name(),
        email: email(),
      });
    }
  };

  return () => (
    <form onSubmit={handleSubmit} class="create-form">
      <h3>Create New User</h3>

      <div class="form-group">
        <label>Name:</label>
        <input
          type="text"
          value={name()}
          onInput={(e) => name.set((e.target as HTMLInputElement).value)}
          disabled={loading()}
          required
        />
      </div>

      <div class="form-group">
        <label>Email:</label>
        <input
          type="email"
          value={email()}
          onInput={(e) => email.set((e.target as HTMLInputElement).value)}
          disabled={loading()}
          required
        />
      </div>

      {error() && (
        <div class="error">
          <strong>Error:</strong> {error()!.message}
        </div>
      )}

      {createdUser() && <div class="success">Successfully created user: {createdUser()!.name}</div>}

      <button type="submit" disabled={loading()}>
        {loading() ? 'Creating...' : 'Create User'}
      </button>
    </form>
  );
});

/**
 * EditUserForm - Demonstrates optimistic updates
 */
const EditUserForm = defineComponent<{ userId: string }>((props) => {
  // Query for user data
  const { data: user, loading: userLoading } = useQuery(UserService, 'getUser', [props.userId], { cache: 30000 });

  // Local form state
  const name = signal('');
  const email = signal('');

  // Update form when user data loads
  onMount(() => {
    if (user()) {
      name.set(user()!.name);
      email.set(user()!.email);
    }
  });

  // Mutation with optimistic updates
  const { mutate, loading: saving } = useMutation(UserService, 'updateUser', {
    // Optimistic update - UI updates IMMEDIATELY
    optimistic: (id: string, data: UpdateUserDto) => ({
      id,
      ...data,
    }),
    // Auto-invalidate related queries
    invalidate: ['users', `user:${props.userId}`],
    // Callbacks
    onSuccess: () => console.log('User updated!'),
    onError: () => console.error('Failed to update, rolling back...'),
  });

  const handleUpdate = async () => {
    await mutate(props.userId, {
      name: name(),
      email: email(),
    });
  };

  return () => (
    <div class="edit-form">
      <h3>Edit User</h3>

      {userLoading() && <div>Loading user data...</div>}

      {user() && (
        <>
          <div class="form-group">
            <label>Name:</label>
            <input
              type="text"
              value={name()}
              onInput={(e) => name.set((e.target as HTMLInputElement).value)}
              disabled={saving()}
            />
          </div>

          <div class="form-group">
            <label>Email:</label>
            <input
              type="email"
              value={email()}
              onInput={(e) => email.set((e.target as HTMLInputElement).value)}
              disabled={saving()}
            />
          </div>

          <button onClick={handleUpdate} disabled={saving()}>
            {saving() ? 'Saving...' : 'Update User'}
          </button>

          <p class="note">
            Note: UI updates immediately with optimistic update. If the server request fails, changes are automatically
            rolled back.
          </p>
        </>
      )}
    </div>
  );
});

/**
 * App Component - Puts it all together
 */
const App = defineComponent(() => {
  const selectedUserId = signal<string | null>(null);

  return () => (
    <div class="app">
      <header>
        <h1>Aether-Netron Zero-Config Example</h1>
        <p>This example demonstrates zero-config Netron integration with:</p>
        <ul>
          <li>✅ Auto-configured services (no boilerplate)</li>
          <li>✅ Reactive queries with caching</li>
          <li>✅ Mutations with optimistic updates</li>
          <li>✅ Automatic cache invalidation</li>
          <li>✅ Full type safety</li>
        </ul>
      </header>

      <main>
        <div class="sidebar">
          <UserList />
        </div>

        <div class="content">
          <CreateUserForm />

          {selectedUserId() && <EditUserForm userId={selectedUserId()!} />}
        </div>
      </main>
    </div>
  );
});

// ============================================================================
// MODULE SETUP (Zero Config!)
// ============================================================================

/**
 * Root Application Module
 *
 * This is ALL the configuration you need!
 */
@Module({
  imports: [
    // Zero-config Netron integration - just provide your API URL
    NetronModule.forRoot({
      baseUrl: 'https://api.example.com',
      // Optional: Configure caching
      cache: {
        maxEntries: 1000,
        defaultMaxAge: 60000,
        debug: false, // Set to true for cache debugging
      },
      // Optional: Configure retry behavior
      retry: {
        attempts: 3,
        backoff: 'exponential',
        initialDelay: 1000,
        maxDelay: 30000,
      },
    }),
  ],
  providers: [UserService],
  bootstrap: App,
})
export class AppModule {}

// ============================================================================
// BOOTSTRAP
// ============================================================================

/**
 * Start the application
 */
export async function startApp() {
  const { container, component } = bootstrapModule(AppModule);

  // Mount the app
  const root = document.getElementById('root');
  if (root && component) {
    // Render component (simplified - actual rendering depends on Aether's render system)
    console.log('App started with zero-config Netron integration!');
    console.log('Services are auto-configured and ready to use.');
    console.log('Cache manager and retry manager are shared across all services.');
  }

  return { container, component };
}

// Auto-start in browser
if (typeof window !== 'undefined') {
  startApp().catch(console.error);
}

/**
 * COMPARISON: What you DON'T need to do anymore!
 *
 * ❌ Before (Manual Setup):
 * ```typescript
 * @Injectable()
 * class UserService {
 *   private peer: HttpRemotePeer;
 *
 *   constructor() {
 *     // 10+ lines of manual configuration
 *     this.peer = new HttpRemotePeer('https://api.example.com');
 *     this.peer.setCacheManager(new HttpCacheManager({
 *       maxEntries: 1000,
 *       defaultMaxAge: 60000,
 *     }));
 *     this.peer.setRetryManager(new RetryManager({
 *       defaultOptions: {
 *         attempts: 3,
 *         backoff: 'exponential',
 *       }
 *     }));
 *   }
 *
 *   async getUsers() {
 *     const service = await this.peer.queryFluentInterface<IUserService>('users');
 *     return await service.getUsers();
 *   }
 *
 *   // ... repeat for every method
 * }
 * ```
 *
 * ✅ After (Zero Config):
 * ```typescript
 * @Injectable()
 * class UserService extends NetronService<IUserService> {
 *   // That's it! Everything is auto-configured!
 * }
 * ```
 *
 * RESULT: 90% reduction in boilerplate (50 lines → 5 lines)
 */
