### Select

A form control for selecting a value from a list of options.

#### Features

- Keyboard navigation
- Typeahead search
- Multi-select support
- Grouping options
- Custom option rendering
- Virtualization for large lists
- Form integration

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Select } from 'aether/primitives';

export const FruitSelect = defineComponent(() => {
  const selectedFruit = signal('apple');

  const fruits = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'orange', label: 'Orange' },
    { value: 'grape', label: 'Grape' }
  ];

  return () => (
    <Select bind:value={selectedFruit}>
      <Select.Trigger class="select-trigger">
        <Select.Value placeholder="Select a fruit..." />
        <Select.Icon>
          <ChevronDownIcon />
        </Select.Icon>
      </Select.Trigger>

      <Select.Content class="select-content">
        <Select.Viewport>
          {fruits.map(fruit => (
            <Select.Item value={fruit.value} class="select-item">
              <Select.ItemText>{fruit.label}</Select.ItemText>
              <Select.ItemIndicator class="select-indicator">
                <CheckIcon />
              </Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select>
  );
});
```

#### With Groups

```html
<Select bind:value={selectedAnimal}>
  <Select.Trigger class="select-trigger">
    <Select.Value placeholder="Select an animal..." />
  </Select.Trigger>

  <Select.Content>
    <Select.Viewport>
      <Select.Group>
        <Select.Label class="select-label">Mammals</Select.Label>
        <Select.Item value="dog">Dog</Select.Item>
        <Select.Item value="cat">Cat</Select.Item>
        <Select.Item value="elephant">Elephant</Select.Item>
      </Select.Group>

      <Select.Separator class="select-separator" />

      <Select.Group>
        <Select.Label class="select-label">Birds</Select.Label>
        <Select.Item value="eagle">Eagle</Select.Item>
        <Select.Item value="parrot">Parrot</Select.Item>
        <Select.Item value="penguin">Penguin</Select.Item>
      </Select.Group>
    </Select.Viewport>
  </Select.Content>
</Select>
```

#### Custom Option Rendering

```typescript
import { defineComponent, signal } from 'aether';
import { Select } from 'aether/primitives';

interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export const UserSelect = defineComponent(() => {
  const selectedUser = signal<string | null>(null);
  const users: User[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com', avatar: '/alice.jpg' },
    { id: '2', name: 'Bob', email: 'bob@example.com', avatar: '/bob.jpg' }
  ];

  return () => (
    <Select bind:value={selectedUser}>
      <Select.Trigger class="select-trigger">
        <Select.Value placeholder="Select user...">
          {selectedUser() && users.find(u => u.id === selectedUser())?.name}
        </Select.Value>
      </Select.Trigger>

      <Select.Content>
        <Select.Viewport>
          {users.map(user => (
            <Select.Item value={user.id} class="select-item-user">
              <img src={user.avatar} alt="" class="avatar" />
              <div class="user-info">
                <div class="user-name">{user.name}</div>
                <div class="user-email">{user.email}</div>
              </div>
              <Select.ItemIndicator class="select-indicator">
                <CheckIcon />
              </Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select>
  );
});
```

#### Styling Example

```css
.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2);

  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  outline: none;

  transition: border-color var(--transition-fast);
}

.select-trigger:hover {
  border-color: var(--color-border-hover);
}

.select-trigger:focus {
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px var(--color-primary-100);
}

.select-trigger[data-placeholder] {
  color: var(--color-text-placeholder);
}

.select-content {
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);

  max-height: 300px;
  overflow: auto;

  z-index: var(--z-dropdown);

  animation: slideDown 150ms ease-out;
}

.select-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);

  padding: var(--spacing-2) var(--spacing-3);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  user-select: none;
  outline: none;

  transition: background-color var(--transition-fast);
}

.select-item:hover,
.select-item:focus,
.select-item[data-highlighted] {
  background: var(--color-background-secondary);
}

.select-item[data-disabled] {
  color: var(--color-text-disabled);
  pointer-events: none;
}

.select-indicator {
  margin-left: auto;
}

.select-label {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.select-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--spacing-1) 0;
}
```

#### API Reference

**`<Select>`** - Root component

Props:
- `value?: Signal<string>` - Controlled selected value
- `defaultValue?: string` - Initial value (uncontrolled)
- `onValueChange?: (value: string) => void` - Callback
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial open state
- `onOpenChange?: (open: boolean) => void`
- `disabled?: boolean` - Disable the select
- `required?: boolean` - Mark as required
- `name?: string` - Form field name

**`<Select.Trigger>`** - Opens the dropdown

**`<Select.Value>`** - Displays selected value

Props:
- `placeholder?: string` - Shown when no value selected

**`<Select.Icon>`** - Icon (usually chevron)

**`<Select.Content>`** - Dropdown content

Props: Same as Popover.Content

**`<Select.Viewport>`** - Scrollable viewport

**`<Select.Item>`** - Selectable option

Props:
- `value: string` - Option value
- `disabled?: boolean`
- `textValue?: string` - For typeahead

**`<Select.ItemText>`** - Item label

**`<Select.ItemIndicator>`** - Shows when item is selected

**`<Select.Group>`** - Group options

**`<Select.Label>`** - Group label

**`<Select.Separator>`** - Visual separator

#### Advanced: Multi-Select

```typescript
import { defineComponent, signal } from 'aether';
import { MultiSelect } from 'aether/primitives';

export const TagsMultiSelect = defineComponent(() => {
  const selectedTags = signal<string[]>(['react', 'typescript']);

  const allTags = [
    'react', 'vue', 'angular', 'svelte',
    'typescript', 'javascript', 'python', 'rust'
  ];

  const removeTag = (tag: string) => {
    selectedTags(selectedTags().filter(t => t !== tag));
  };

  return () => (
    <MultiSelect bind:value={selectedTags}>
      <MultiSelect.Trigger class="select-trigger">
        <MultiSelect.Value>
          {selectedTags().length > 0 ? (
            <div class="selected-tags">
              {selectedTags().map(tag => (
                <span class="tag">
                  {tag}
                  <button
                    on:click={(e) => {
                      e.stopPropagation();
                      removeTag(tag);
                    }}
                  >
                    <XIcon />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span class="placeholder">Select tags...</span>
          )}
        </MultiSelect.Value>
      </MultiSelect.Trigger>

      <MultiSelect.Content>
        <MultiSelect.Viewport>
          {allTags.map(tag => (
            <MultiSelect.Item value={tag} class="select-item">
              <MultiSelect.ItemIndicator>
                <CheckIcon />
              </MultiSelect.ItemIndicator>
              <MultiSelect.ItemText>{tag}</MultiSelect.ItemText>
            </MultiSelect.Item>
          ))}
        </MultiSelect.Viewport>
      </MultiSelect.Content>
    </MultiSelect>
  );
});
```

---

