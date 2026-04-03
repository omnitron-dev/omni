# Prism State Management & Data Fetching

## State Management: Easy-Peasy vs Zustand Analysis

### Executive Summary

After analyzing the **@apps/portal** easy-peasy implementation, here's a synthesis comparing it with Zustand for Prism's recommended approach.

### Easy-Peasy Patterns (from Portal)

```typescript
// Portal uses a single store with multiple domain slices
export interface IStoreModel {
  auth: IAuthModel;
  currentUser: ICurrentUserModel;
  chat: IChatModel;
  appearanceSettings: AppearanceSettingsModel;
}

export const store = createStore<IStoreModel>(
  persist({ auth: authStore, currentUser: currentUserStore, ... }, {
    storage: localStorage,
    allow: ['auth', 'currentUser', ...],
  })
);

// Type-safe hooks
export const { useStoreActions, useStoreState } = createTypedHooks<IStoreModel>();
```

**Key Easy-Peasy Features Used:**
- `action()` - Synchronous state mutations
- `thunk()` - Async operations with API calls
- `computed()` - Derived state (selectors)
- `persist()` - localStorage persistence
- Cross-store communication via `helpers.getStoreActions()`

### Feature Comparison

| Feature | Easy-Peasy | Zustand | Winner |
|---------|------------|---------|--------|
| **Bundle Size** | ~15KB | ~1KB | Zustand |
| **TypeScript** | Good (requires boilerplate) | Excellent (native) | Zustand |
| **Learning Curve** | Higher (Redux-like concepts) | Lower (simple API) | Zustand |
| **Persistence** | Built-in `persist()` | Via `persist` middleware | Tie |
| **DevTools** | Redux DevTools | Redux DevTools | Tie |
| **Computed/Derived** | Built-in `computed()` | Manual with selectors | Easy-Peasy |
| **Actions/Thunks** | Separate concepts | Unified (just functions) | Zustand |
| **Cross-store Access** | Via `helpers` | Direct import | Zustand |
| **Immer Integration** | Built-in | Optional middleware | Tie |
| **React Strict Mode** | Issues reported | Fully compatible | Zustand |
| **SSR Support** | Limited | Excellent | Zustand |

### Recommendation: Zustand with Patterns from Easy-Peasy

Zustand provides better DX with smaller bundle, but we adopt the **organizational patterns** from Portal's easy-peasy:

```typescript
// Prism recommendation: Zustand with Portal's domain structure
import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// Domain store with computed-like pattern
interface AuthStore {
  // State
  status: 'loading' | 'authenticated' | 'unauthenticated';

  // Computed (as getters)
  get isAuthenticated(): boolean;
  get isLoading(): boolean;

  // Actions
  setStatus: (status: AuthStore['status']) => void;
  signIn: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      immer((set, get) => ({
        status: 'loading',

        // Computed as getters
        get isAuthenticated() { return get().status === 'authenticated'; },
        get isLoading() { return get().status === 'loading'; },

        // Actions
        setStatus: (status) => set({ status }),
        signIn: async (credentials) => {
          const token = await authService.login(credentials);
          localStorage.setItem('token', token);
          set({ status: 'authenticated' });
        },
        signOut: async () => {
          await authService.logout();
          set({ status: 'unauthenticated' });
        },
      })),
      { name: 'auth-store' }
    )
  )
);
```

### Migration Pattern: Easy-Peasy → Zustand

```typescript
// Easy-Peasy (Portal style)
const authStore: IAuthModel = {
  authStatus: 'loading',
  loading: computed((state) => state.authStatus === 'loading'),
  setStatus: action((state, value) => { state.authStatus = value; }),
  signIn: thunk(async (actions, data, helpers) => {
    const res = await api.signIn(data);
    actions.setStatus('authenticated');
    helpers.getStoreActions().currentUser.setUser(res.user);
  }),
};

// Zustand equivalent
const useAuthStore = create<AuthStore>()(
  immer((set, get) => ({
    status: 'loading',
    get isLoading() { return get().status === 'loading'; },
    setStatus: (status) => set({ status }),
    signIn: async (data) => {
      const res = await api.signIn(data);
      set({ status: 'authenticated' });
      useCurrentUserStore.getState().setUser(res.user); // Cross-store
    },
  }))
);
```

---

## Data Fetching: Netron Integration

### Why Netron over React-Query/SWR

Prism is designed for the Omnitron ecosystem with **Titan backend** and **Netron RPC**.

| Feature | React-Query/SWR | Netron-React |
|---------|-----------------|--------------|
| Backend | Agnostic HTTP | Titan-optimized RPC |
| Real-time | Polling | Native WebSocket subscriptions |
| Multi-backend | Custom routing | Built-in routing |
| Auth | Manual integration | Integrated with refresh |
| TypeScript | Manual types | Service proxies |
| Caching | Excellent | Excellent |
| Mutations | Generic | Service-method pattern |

### Netron-React Hooks for Prism

```typescript
// useQuery - Data fetching with caching
const { data, isLoading, error } = useQuery({
  queryKey: ['user', userId],
  queryFn: () => client.invoke('users', 'getUser', [userId]),
  staleTime: 5 * 60 * 1000,
});

// useService - Type-safe service access
const userService = useService<UserService>('users@1.0.0');
const { data } = userService.getUser.useQuery([userId]);

// useSubscription - Real-time events (WebSocket)
const { data: priceUpdate } = useSubscription<PriceUpdate>({
  event: 'prices:update',
  filter: (update) => update.symbol === 'BTC',
});

// useMutation - Data mutations
const mutation = useMutation({
  mutationFn: (data) => client.invoke('users', 'updateUser', [userId, data]),
  invalidateQueries: [['users']],
});
```

### Integration Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     Prism Application                          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────┐    ┌──────────────────────────────────┐ │
│  │   Zustand Store  │    │     Netron-React Client          │ │
│  │   (UI State)     │    │     (Server State)               │ │
│  ├──────────────────┤    ├──────────────────────────────────┤ │
│  │ • theme settings │    │ • useQuery (data fetching)       │ │
│  │ • UI preferences │    │ • useMutation (data updates)     │ │
│  │ • local state    │    │ • useSubscription (real-time)    │ │
│  │ • auth status    │    │ • useService (typed proxies)     │ │
│  └──────────────────┘    └──────────────────────────────────┘ │
│           │                            │                       │
│           └────────────┬───────────────┘                       │
│                        │                                       │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │                  Components                             │   │
│  │  • useAuthStore() for local auth state                 │   │
│  │  • useQuery() for server data                          │   │
│  │  • Combine: isAuthenticated && user data               │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/WebSocket
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                     Titan Backend                              │
│  • Netron RPC Server                                          │
│  • @Service('users@1.0.0'), @Service('auth@1.0.0')           │
└────────────────────────────────────────────────────────────────┘
```

### Recommended Patterns

**1. Separate Client vs Server State:**
```typescript
// UI State (Zustand) - Theme, preferences, local UI
const theme = useThemeStore((s) => s.mode);

// Server State (Netron) - User data, API responses
const { data: user } = useQuery({
  queryKey: ['user', 'me'],
  queryFn: () => userService.getCurrentUser(),
});
```

**2. Auth Bridge Pattern:**
```typescript
// Auth store manages token/status
const useAuthStore = create((set) => ({
  status: 'loading',
  token: null,
  setAuthenticated: (token) => set({ status: 'authenticated', token }),
  setUnauthenticated: () => set({ status: 'unauthenticated', token: null }),
}));

// Netron uses token from store
const client = new NetronReactClient({
  auth: {
    tokenProvider: () => useAuthStore.getState().token,
    autoRefresh: true,
  },
});
```

**3. Optimistic Updates:**
```typescript
const updateUserMutation = useMutation({
  mutationFn: (data) => userService.update(data),
  onMutate: async (newData) => {
    await client.cancelQueries(['user', userId]);
    const previous = client.getQueryData(['user', userId]);
    client.setQueryData(['user', userId], newData);
    return { previous };
  },
  onError: (err, newData, context) => {
    client.setQueryData(['user', userId], context.previous);
  },
  onSettled: () => {
    client.invalidateQueries(['user', userId]);
  },
});
```

---

## File Structure

```
src/state/
├── README.md              # This file
├── index.ts               # Main exports
├── create-store.ts        # Zustand store factory with defaults
├── middleware/
│   ├── persist.ts         # Enhanced persistence
│   └── devtools.ts        # DevTools integration
└── stores/
    ├── auth.ts            # Authentication state
    ├── theme.ts           # Theme preferences
    └── ui.ts              # UI state (sidebar, dialogs)
```

## Usage Example

```typescript
import { useAuthStore, useThemeStore } from '@omnitron/prism/state';
import { useQuery, useService } from '@omnitron-dev/netron-react';

function Dashboard() {
  // UI state from Zustand
  const { isAuthenticated } = useAuthStore();
  const { mode } = useThemeStore();

  // Server data from Netron
  const userService = useService<UserService>('users@1.0.0');
  const { data: user, isLoading } = userService.getCurrentUser.useQuery([]);

  if (!isAuthenticated) return <LoginRedirect />;
  if (isLoading) return <Skeleton />;

  return <DashboardContent user={user} theme={mode} />;
}
```
