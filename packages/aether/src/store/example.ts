/**
 * Example Store Implementation
 *
 * This file demonstrates how to use the store pattern.
 * It's not part of the build, just for reference.
 */

import { defineStore } from './defineStore.js';
import { signal } from '../core/reactivity/signal.js';
import { computed } from '../core/reactivity/computed.js';
import { readonly } from './composition.js';
import { persist } from './persist.js';
import { optimistic } from './optimistic.js';
import { onStoreInit, onStoreDestroy } from './lifecycle.js';

// Example types
interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

interface IUserService {
  getUsers(): Promise<User[]>;
  createUser(user: Omit<User, 'id'>): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

/**
 * User Store Example
 *
 * Demonstrates all store pattern features:
 * - Signal state
 * - Computed values
 * - Netron integration
 * - Optimistic updates
 * - Persistence
 * - Lifecycle hooks
 */
export const useUserStore = defineStore('user', (netron) => {
  // Reactive state
  const users = signal<User[]>([]);
  const loading = signal(false);
  const error = signal<Error | undefined>(undefined);

  // Computed values
  const activeUsers = computed(() => users().filter((u) => u.active));
  const userCount = computed(() => users().length);

  // Lifecycle hooks
  onStoreInit(async () => {
    console.log('User store initialized');
    await loadUsers();
  });

  onStoreDestroy(() => {
    console.log('User store destroyed');
  });

  // Actions
  const loadUsers = async () => {
    loading.set(true);
    error.set(undefined);

    try {
      const service = await netron.service<IUserService>('users');
      const data = await service.getUsers();
      users.set(data);
    } catch (err) {
      error.set(err as Error);
      throw err;
    } finally {
      loading.set(false);
    }
  };

  const createUser = async (userData: Omit<User, 'id'>) => {
    const service = await netron.service<IUserService>('users');
    const newUser = await service.createUser(userData);
    users.set([...users(), newUser]);
    return newUser;
  };

  // Optimistic update example
  const updateUser = optimistic(
    async (id: string, data: Partial<User>) => {
      const service = await netron.service<IUserService>('users');
      return await service.updateUser(id, data);
    },
    {
      update: (id, data) => {
        users.set(users().map((u) => (u.id === id ? { ...u, ...data } : u)));
      },
      rollback: (snapshot) => {
        users.set(snapshot);
      },
      snapshot: () => users.peek(),
      onSuccess: (result) => {
        console.log('User updated successfully:', result);
      },
      onError: (err, snapshot) => {
        console.error('User update failed, rolling back:', err);
      },
      retry: {
        attempts: 3,
        delay: (attempt) => attempt * 1000,
      },
    }
  );

  const deleteUser = optimistic(
    async (id: string) => {
      const service = await netron.service<IUserService>('users');
      await service.deleteUser(id);
    },
    {
      update: (id) => {
        users.set(users().filter((u) => u.id !== id));
      },
      rollback: (snapshot) => {
        users.set(snapshot);
      },
      snapshot: () => users.peek(),
    }
  );

  // Persistence
  persist(users, {
    key: 'user-store',
    storage: 'local',
    exclude: ['loading', 'error'],
    debounce: 500,
  });

  // Return public API (readonly state, actions)
  return {
    // State (readonly)
    users: readonly(users),
    loading: readonly(loading),
    error: readonly(error),

    // Computed
    activeUsers,
    userCount,

    // Actions
    loadUsers,
    createUser,
    updateUser,
    deleteUser,
  };
});

/**
 * Settings Store Example
 *
 * Demonstrates simpler store with persistence
 */
export const useSettingsStore = defineStore('settings', () => {
  const theme = signal<'light' | 'dark'>('light');
  const language = signal<'en' | 'es' | 'fr'>('en');
  const notifications = signal(true);

  // Persist settings
  persist(theme, { key: 'app-theme', storage: 'local' });
  persist(language, { key: 'app-language', storage: 'local' });
  persist(notifications, { key: 'app-notifications', storage: 'local' });

  const setTheme = (newTheme: 'light' | 'dark') => {
    theme.set(newTheme);
  };

  const setLanguage = (lang: 'en' | 'es' | 'fr') => {
    language.set(lang);
  };

  const toggleNotifications = () => {
    notifications.set(!notifications.peek());
  };

  return {
    theme: readonly(theme),
    language: readonly(language),
    notifications: readonly(notifications),
    setTheme,
    setLanguage,
    toggleNotifications,
  };
});

// Usage in component:
/*
import { defineComponent } from '@omnitron-dev/aether';
import { useUserStore } from './stores/user.store';

const UserList = defineComponent(() => {
  const userStore = useUserStore();

  onMount(() => {
    userStore.loadUsers();
  });

  return () => (
    <div>
      <h1>Users ({userStore.userCount()})</h1>
      {userStore.loading() ? (
        <div>Loading...</div>
      ) : (
        <ul>
          {userStore.activeUsers().map(user => (
            <li key={user.id}>
              {user.name} ({user.email})
              <button onClick={() => userStore.updateUser(user.id, { active: false })}>
                Deactivate
              </button>
              <button onClick={() => userStore.deleteUser(user.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
*/
