### Combobox

A searchable select with autocomplete.

#### Features

- Text input with dropdown
- Filtering/autocomplete
- Keyboard navigation
- Custom filtering logic
- Async data loading
- Virtualization

#### Basic Usage

```typescript
import { defineComponent, signal, computed } from 'aether';
import { Combobox } from 'aether/primitives';

export const FrameworkCombobox = defineComponent(() => {
  const frameworks = [
    { value: 'react', label: 'React' },
    { value: 'vue', label: 'Vue' },
    { value: 'angular', label: 'Angular' },
    { value: 'svelte', label: 'Svelte' },
    { value: 'solid', label: 'SolidJS' }
  ];

  const selectedFramework = signal<string | null>(null);
  const searchQuery = signal('');

  // Filter options based on search
  const filteredFrameworks = computed(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return frameworks;
    return frameworks.filter(f =>
      f.label.toLowerCase().includes(query)
    );
  });

  return () => (
    <Combobox bind:value={selectedFramework}>
      <Combobox.Trigger class="combobox-trigger">
        <Combobox.Input
          class="combobox-input"
          placeholder="Search framework..."
          bind:value={searchQuery}
        />
        <Combobox.Icon>
          <ChevronDownIcon />
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Content class="combobox-content">
        <Combobox.Viewport>
          {filteredFrameworks().length > 0 ? (
            <>
              {filteredFrameworks().map(framework => (
                <Combobox.Item value={framework.value} class="combobox-item">
                  <CheckIcon class="combobox-check" />
                  {framework.label}
                </Combobox.Item>
              ))}
            </>
          ) : (
            <Combobox.Empty class="combobox-empty">
              No framework found
            </Combobox.Empty>
          )}
        </Combobox.Viewport>
      </Combobox.Content>
    </Combobox>
  );
});
```

#### With Async Data

```typescript
import { defineComponent, signal, effect } from 'aether';
import { Combobox } from 'aether/primitives';
import { debounce } from 'aether/utils';

interface User {
  id: string;
  name: string;
  email: string;
}

export const UserSearchCombobox = defineComponent(() => {
  const selectedUser = signal<string | null>(null);
  const searchQuery = signal('');
  const users = signal<User[]>([]);
  const isLoading = signal(false);

  // Debounced search
  const debouncedSearch = debounce(async (query: string) => {
    if (!query) {
      users([]);
      return;
    }

    isLoading(true);
    try {
      const response = await fetch(`/api/users/search?q=${query}`);
      const data = await response.json();
      users(data);
    } finally {
      isLoading(false);
    }
  }, 300);

  // Trigger search on query change
  effect(() => {
    debouncedSearch(searchQuery());
  });

  return () => (
    <Combobox bind:value={selectedUser}>
      <Combobox.Trigger class="combobox-trigger">
        <Combobox.Input
          placeholder="Search users..."
          bind:value={searchQuery}
        />
        <Combobox.Icon>
          {isLoading() ? <SpinnerIcon /> : <SearchIcon />}
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Content>
        <Combobox.Viewport>
          {isLoading() ? (
            <div class="combobox-loading">Loading...</div>
          ) : users().length > 0 ? (
            <>
              {users().map(user => (
                <Combobox.Item value={user.id} class="combobox-item">
                  <div class="user-result">
                    <div class="user-name">{user.name}</div>
                    <div class="user-email">{user.email}</div>
                  </div>
                </Combobox.Item>
              ))}
            </>
          ) : searchQuery() ? (
            <Combobox.Empty>No users found</Combobox.Empty>
          ) : null}
        </Combobox.Viewport>
      </Combobox.Content>
    </Combobox>
  );
});
```

#### API Reference

**`<Combobox>`** - Root component

Props: Same as Select

**`<Combobox.Trigger>`** - Trigger container

**`<Combobox.Input>`** - Text input for search

Props:
- `value?: Signal<string>` - Search query
- `placeholder?: string`
- Standard input props

**`<Combobox.Icon>`** - Icon (search/chevron)

**`<Combobox.Content>`** - Dropdown content

**`<Combobox.Viewport>`** - Scrollable viewport

**`<Combobox.Item>`** - Selectable option

**`<Combobox.Empty>`** - Shown when no results

---

