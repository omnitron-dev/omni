# Prism client state

`@omnitron-dev/prism/state` contains Zustand store factories, shared UI stores, and persisted-settings migration helpers. Use selectors to subscribe to the values a component renders.

```tsx
import { createUIStore } from '@omnitron-dev/prism/state';

interface CounterState {
  count: number;
  increment(): void;
}

export const useCounter = createUIStore<CounterState>(
  (set) => ({
    count: 0,
    increment: () => set((state) => { state.count += 1; }),
  }),
  'counter',
);
```

[Store factories](create-store.ts) provide Immer updates and optional persistence and DevTools integration. `createUIStore` is non-persistent; `createPersistedStore` exposes the persistence lifecycle, including hydration.

[Shared stores](stores/index.ts) cover theme, authentication UI state, layout, and settings. Authentication UI state is not server authorization. Resolve server data and permissions through the application's service client.

[Settings versioning](settings-version.ts) provides migrations, validation, import/export, and storage helpers. Define migration behavior when changing persisted fields and account for hydration before rendering preference-dependent UI. For SSR theme selection, use the controlled mode on `PrismProvider` rather than mutating a shared store per request.

See [the public exports](index.ts) for available hooks, store objects, and migration types.
