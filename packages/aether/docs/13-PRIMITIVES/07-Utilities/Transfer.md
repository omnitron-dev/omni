### Transfer

**Dual-list component for transferring items between source and target lists with selection and filtering.**

**Features:**
- Source and target list management
- Item selection in both lists
- Bidirectional transfer controls
- Search/filter functionality
- Bulk operations (select all, clear)
- Custom item rendering
- Controlled and uncontrolled modes
- Keyboard navigation support
- ARIA accessibility attributes

**Basic Usage:**

```typescript
import { defineComponent, signal } from 'aether';
import { Transfer } from 'aether/primitives';

const Example001 = defineComponent(() => {
  const dataSource = [
    { key: '1', title: 'Option 1' },
    { key: '2', title: 'Option 2' },
    { key: '3', title: 'Option 3' },
    { key: '4', title: 'Option 4' },
    { key: '5', title: 'Option 5' }
  ];

  const targetKeys = signal<string[]>(['2']);

  return () => (
    <Transfer
      dataSource={dataSource}
      targetKeys={targetKeys()}
      onTargetKeysChange={targetKeys.set}
    >
      <div class="transfer-container">
        <div class="transfer-panel">
          <h3>Available Items</h3>
          <Transfer.List type="source" />
        </div>

        <Transfer.Controls />

        <div class="transfer-panel">
          <h3>Selected Items</h3>
          <Transfer.List type="target" />
        </div>
      </div>
    </Transfer>
  );
});
```

**Uncontrolled Mode:**

```typescript
const Example002 = defineComponent(() => {
  const dataSource = [
    { key: '1', title: 'Item 1' },
    { key: '2', title: 'Item 2' },
    { key: '3', title: 'Item 3' }
  ];

  return () => (
    <Transfer
      dataSource={dataSource}
      defaultTargetKeys={['2']}
      onTargetKeysChange={(keys) => console.log('Target keys:', keys)}
    >
      <div class="transfer-container">
        <Transfer.List type="source" />
        <Transfer.Controls />
        <Transfer.List type="target" />
      </div>
    </Transfer>
  );
});
```

**User Permissions Example:**

```typescript
const Example003 = defineComponent(() => {
  interface Permission {
    key: string;
    title: string;
    disabled?: boolean;
    description?: string;
    category?: string;
  }

  const permissions: Permission[] = [
    { key: 'users:read', title: 'View Users', description: 'View user profiles', category: 'Users' },
    { key: 'users:write', title: 'Edit Users', description: 'Create and edit users', category: 'Users' },
    { key: 'users:delete', title: 'Delete Users', description: 'Delete user accounts', category: 'Users', disabled: true },
    { key: 'posts:read', title: 'View Posts', description: 'View all posts', category: 'Content' },
    { key: 'posts:write', title: 'Edit Posts', description: 'Create and edit posts', category: 'Content' },
    { key: 'posts:delete', title: 'Delete Posts', description: 'Delete posts', category: 'Content' },
    { key: 'settings:read', title: 'View Settings', description: 'View system settings', category: 'System' },
    { key: 'settings:write', title: 'Edit Settings', description: 'Modify system settings', category: 'System' }
  ];

  const userPermissions = signal<string[]>([]);
  const searchSource = signal('');
  const searchTarget = signal('');

  const filteredDataSource = computed(() => {
    if (!searchSource()) return permissions;
    const query = searchSource().toLowerCase();
    return permissions.filter(p =>
      p.title.toLowerCase().includes(query) ||
      p.description?.toLowerCase().includes(query)
    );
  });

  return () => (
    <div class="permissions-transfer">
      <h2>Assign User Permissions</h2>

      <Transfer
        dataSource={filteredDataSource()}
        targetKeys={userPermissions()}
        onTargetKeysChange={userPermissions.set}
      >
        <div class="transfer-container">
          {/* Source panel */}
          <div class="transfer-panel">
            <div class="panel-header">
              <h3>Available Permissions</h3>
              <span class="count">{context.sourceItems().length} items</span>
            </div>

            <input
              type="search"
              placeholder="Search available permissions..."
              value={searchSource()}
              onInput={(e) => searchSource.set(e.target.value)}
              class="transfer-search"
            />

            <div class="transfer-actions">
              <button
                onClick={() => {
                  const sourceKeys = context.sourceItems()
                    .filter(item => !item.disabled)
                    .map(item => item.key);
                  userPermissions.set([...userPermissions(), ...sourceKeys]);
                }}
                disabled={context.sourceItems().length === 0}
                class="btn-text"
              >
                Select All
              </button>
            </div>

            <Transfer.List type="source">
              {#let items}
                <div class="transfer-list">
                  {#each items as permission}
                    <div
                      class="transfer-item"
                      class:selected={context.selectedSource().includes(permission.key)}
                      class:disabled={permission.disabled}
                      onClick={() => context.toggleSourceSelection(permission.key)}
                      role="option"
                      aria-selected={context.selectedSource().includes(permission.key)}
                      aria-disabled={permission.disabled}
                    >
                      <div class="item-checkbox">
                        <input
                          type="checkbox"
                          checked={context.selectedSource().includes(permission.key)}
                          disabled={permission.disabled}
                        />
                      </div>
                      <div class="item-content">
                        <div class="item-title">{permission.title}</div>
                        {#if permission.description}
                          <div class="item-description">{permission.description}</div>
                        {/if}
                        {#if permission.category}
                          <div class="item-category">{permission.category}</div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/let}
            </Transfer.List>
          </div>

          {/* Transfer controls */}
          <Transfer.Controls>
            <div class="transfer-controls">
              <button
                onClick={context.transferToTarget}
                disabled={context.selectedSource().length === 0}
                class="btn-icon"
                aria-label="Transfer selected items to target"
                title="Move to selected"
              >
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <path d="M5 3l6 5-6 5V3z" fill="currentColor" />
                </svg>
              </button>
              <button
                onClick={context.transferToSource}
                disabled={context.selectedTarget().length === 0}
                class="btn-icon"
                aria-label="Transfer selected items to source"
                title="Remove from selected"
              >
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <path d="M11 3L5 8l6 5V3z" fill="currentColor" />
                </svg>
              </button>
            </div>
          </Transfer.Controls>

          {/* Target panel */}
          <div class="transfer-panel">
            <div class="panel-header">
              <h3>Assigned Permissions</h3>
              <span class="count">{userPermissions().length} items</span>
            </div>

            <input
              type="search"
              placeholder="Search assigned permissions..."
              value={searchTarget()}
              onInput={(e) => searchTarget.set(e.target.value)}
              class="transfer-search"
            />

            <div class="transfer-actions">
              <button
                onClick={() => userPermissions.set([])}
                disabled={userPermissions().length === 0}
                class="btn-text"
              >
                Clear All
              </button>
            </div>

            <Transfer.List type="target">
              {#let items}
                <div class="transfer-list">
                  {#each items as permission}
                    <div
                      class="transfer-item"
                      class:selected={context.selectedTarget().includes(permission.key)}
                      onClick={() => context.toggleTargetSelection(permission.key)}
                      role="option"
                      aria-selected={context.selectedTarget().includes(permission.key)}
                    >
                      <div class="item-checkbox">
                        <input
                          type="checkbox"
                          checked={context.selectedTarget().includes(permission.key)}
                        />
                      </div>
                      <div class="item-content">
                        <div class="item-title">{permission.title}</div>
                        {#if permission.description}
                          <div class="item-description">{permission.description}</div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/let}
            </Transfer.List>
          </div>
        </div>
      </Transfer>
    </div>
  );
});
```

**Role Assignment Example:**

```typescript
const Example004 = defineComponent(() => {
  interface User {
    key: string;
    title: string;
    email?: string;
    avatar?: string;
    disabled?: boolean;
  }

  const allUsers: User[] = [
    { key: '1', title: 'Alice Johnson', email: 'alice@example.com' },
    { key: '2', title: 'Bob Smith', email: 'bob@example.com' },
    { key: '3', title: 'Charlie Brown', email: 'charlie@example.com' },
    { key: '4', title: 'Diana Prince', email: 'diana@example.com' },
    { key: '5', title: 'Eve Davis', email: 'eve@example.com' }
  ];

  const adminUsers = signal<string[]>(['1']);

  return () => (
    <div class="role-assignment">
      <h2>Admin Role Assignment</h2>
      <p class="description">Select users who should have admin privileges</p>

      <Transfer
        dataSource={allUsers}
        targetKeys={adminUsers()}
        onTargetKeysChange={adminUsers.set}
        render={(user) => (
          <div class="user-item">
            <div class="user-avatar">
              {user.avatar ? (
                <img src={user.avatar} alt={user.title} />
              ) : (
                <div class="avatar-placeholder">
                  {user.title.charAt(0)}
                </div>
              )}
            </div>
            <div class="user-info">
              <div class="user-name">{user.title}</div>
              {#if user.email}
                <div class="user-email">{user.email}</div>
              {/if}
            </div>
          </div>
        )}
      >
        <div class="transfer-wrapper">
          <div class="transfer-side">
            <h3>All Users</h3>
            <Transfer.List type="source" />
          </div>

          <Transfer.Controls />

          <div class="transfer-side">
            <h3>Admin Users</h3>
            <Transfer.List type="target" />
          </div>
        </div>
      </Transfer>
    </div>
  );
});
```

**Tag Selection Example:**

```typescript
const Example005 = defineComponent(() => {
  interface Tag {
    key: string;
    title: string;
    color?: string;
    disabled?: boolean;
  }

  const availableTags: Tag[] = [
    { key: 'urgent', title: 'Urgent', color: 'red' },
    { key: 'important', title: 'Important', color: 'orange' },
    { key: 'bug', title: 'Bug', color: 'red' },
    { key: 'feature', title: 'Feature', color: 'blue' },
    { key: 'enhancement', title: 'Enhancement', color: 'green' },
    { key: 'documentation', title: 'Documentation', color: 'purple' },
    { key: 'question', title: 'Question', color: 'gray' },
    { key: 'wontfix', title: 'Won\'t Fix', color: 'black', disabled: true }
  ];

  const selectedTags = signal<string[]>(['bug', 'important']);

  return () => (
    <Transfer
      dataSource={availableTags}
      targetKeys={selectedTags()}
      onTargetKeysChange={selectedTags.set}
      render={(tag) => (
        <div class="tag-item">
          <span class="tag-dot" style={`background: ${tag.color}`}></span>
          <span class="tag-title">{tag.title}</span>
        </div>
      )}
    >
      <div class="tags-transfer">
        <Transfer.List type="source" />
        <Transfer.Controls />
        <Transfer.List type="target" />
      </div>
    </Transfer>
  );
});
```

**Category Organization Example:**

```typescript
const Example006 = defineComponent(() => {
  interface Category {
    key: string;
    title: string;
    itemCount?: number;
    disabled?: boolean;
  }

  const categories: Category[] = [
    { key: 'electronics', title: 'Electronics', itemCount: 245 },
    { key: 'clothing', title: 'Clothing', itemCount: 189 },
    { key: 'books', title: 'Books', itemCount: 512 },
    { key: 'sports', title: 'Sports', itemCount: 87 },
    { key: 'home', title: 'Home & Garden', itemCount: 156 },
    { key: 'toys', title: 'Toys', itemCount: 93 },
    { key: 'food', title: 'Food & Beverage', itemCount: 67 }
  ];

  const featuredCategories = signal<string[]>(['electronics', 'books']);
  const draggedItem = signal<string | null>(null);

  return () => (
    <Transfer
      dataSource={categories}
      targetKeys={featuredCategories()}
      onTargetKeysChange={featuredCategories.set}
    >
      <div class="categories-transfer">
        <div class="transfer-column">
          <div class="column-header">
            <h3>All Categories</h3>
            <span class="item-count">
              {context.sourceItems().length} categories
            </span>
          </div>

          <Transfer.List type="source">
            {#let items}
              <div class="category-list" role="listbox">
                {#each items as category}
                  <div
                    class="category-item"
                    class:selected={context.selectedSource().includes(category.key)}
                    class:disabled={category.disabled}
                    draggable={!category.disabled}
                    onDragStart={() => draggedItem.set(category.key)}
                    onDragEnd={() => draggedItem.set(null)}
                    onClick={() => context.toggleSourceSelection(category.key)}
                    role="option"
                    aria-selected={context.selectedSource().includes(category.key)}
                  >
                    <div class="category-info">
                      <span class="category-name">{category.title}</span>
                      {#if category.itemCount}
                        <span class="category-count">
                          {category.itemCount} items
                        </span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/let}
          </Transfer.List>
        </div>

        <Transfer.Controls>
          <div class="custom-controls">
            <button
              onClick={context.transferToTarget}
              disabled={context.selectedSource().length === 0}
              class="transfer-btn"
            >
              Add to Featured →
            </button>
            <button
              onClick={context.transferToSource}
              disabled={context.selectedTarget().length === 0}
              class="transfer-btn"
            >
              ← Remove from Featured
            </button>
          </div>
        </Transfer.Controls>

        <div class="transfer-column">
          <div class="column-header">
            <h3>Featured Categories</h3>
            <span class="item-count">
              {featuredCategories().length} categories
            </span>
          </div>

          <Transfer.List type="target">
            {#let items}
              <div
                class="category-list featured"
                role="listbox"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedItem()) {
                    const keys = [...featuredCategories(), draggedItem()!];
                    featuredCategories.set(keys);
                    draggedItem.set(null);
                  }
                }}
              >
                {#if items.length === 0}
                  <div class="empty-state">
                    Drag categories here to feature them
                  </div>
                {/if}

                {#each items as category}
                  <div
                    class="category-item featured"
                    class:selected={context.selectedTarget().includes(category.key)}
                    onClick={() => context.toggleTargetSelection(category.key)}
                    role="option"
                    aria-selected={context.selectedTarget().includes(category.key)}
                  >
                    <div class="category-info">
                      <span class="category-name">{category.title}</span>
                      {#if category.itemCount}
                        <span class="category-count">
                          {category.itemCount} items
                        </span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/let}
          </Transfer.List>
        </div>
      </div>
    </Transfer>
  );
});
```

**Styling Example:**

```css
.transfer-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
  padding: var(--spacing-4);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.transfer-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  min-width: 250px;
  max-width: 400px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--spacing-2);
  border-bottom: 1px solid var(--color-border);
}

.panel-header h3 {
  margin: 0;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.panel-header .count {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.transfer-search {
  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);
  background: var(--color-background-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  transition: border-color var(--transition-fast);
}

.transfer-search:focus {
  outline: none;
  border-color: var(--color-primary);
}

.transfer-actions {
  display: flex;
  gap: var(--spacing-2);
}

.transfer-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  max-height: 400px;
  overflow-y: auto;
  padding: var(--spacing-2);
  background: var(--color-background-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.transfer-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  background: var(--color-background);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.transfer-item:hover:not(.disabled) {
  background: var(--color-background-tertiary);
  border-color: var(--color-border);
}

.transfer-item.selected {
  background: var(--color-primary-50);
  border-color: var(--color-primary);
}

.transfer-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.item-checkbox {
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-description {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-top: var(--spacing-1);
}

.item-category {
  display: inline-block;
  margin-top: var(--spacing-1);
  padding: var(--spacing-1) var(--spacing-2);
  background: var(--color-background-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.transfer-controls {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  align-self: center;
}

.transfer-controls button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.transfer-controls button:hover:not(:disabled) {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.transfer-controls button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* User item styles */
.user-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--color-primary);
  color: white;
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.user-email {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

/* Tag item styles */
.tag-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.tag-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tag-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

/* Category item styles */
.category-item {
  padding: var(--spacing-3);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.category-item:hover:not(.disabled) {
  border-color: var(--color-primary);
  transform: translateY(-1px);
}

.category-item.selected {
  background: var(--color-primary-50);
  border-color: var(--color-primary);
}

.category-item.featured {
  border-left: 3px solid var(--color-primary);
}

.category-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.category-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.category-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  padding: var(--spacing-1) var(--spacing-2);
  background: var(--color-background-tertiary);
  border-radius: var(--radius-sm);
}

.empty-state {
  padding: var(--spacing-8);
  text-align: center;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
```

**API Reference:**

**`<Transfer>`** - Root transfer component

Props:
- `dataSource: TransferItem[]` - All available items (required)
- `targetKeys?: string[]` - Controlled target keys
- `onTargetKeysChange?: (keys: string[]) => void` - Target keys change callback
- `defaultTargetKeys?: string[]` - Default target keys (uncontrolled)
- `render?: (item: TransferItem) => any` - Custom item renderer
- `disabled?: boolean` - Disable all interactions

Context Value (accessible in children):
- `sourceItems: Signal<TransferItem[]>` - Items in source list
- `targetItems: Signal<TransferItem[]>` - Items in target list
- `selectedSource: Signal<string[]>` - Selected keys in source
- `selectedTarget: Signal<string[]>` - Selected keys in target
- `transferToTarget: () => void` - Transfer selected items to target
- `transferToSource: () => void` - Transfer selected items to source
- `toggleSourceSelection: (key: string) => void` - Toggle source item selection
- `toggleTargetSelection: (key: string) => void` - Toggle target item selection

**`<Transfer.List>`** - List container for source or target items

Props:
- `type: 'source' | 'target'` - List type (required)

**`<Transfer.Controls>`** - Transfer control buttons

Provides default buttons for transferring items between lists. Can be customized by providing children.

**Data Structure:**

```typescript
interface TransferItem {
  key: string;           // Unique identifier (required)
  title: string;         // Display title (required)
  disabled?: boolean;    // Disable item selection
}
```

**Accessibility:**

The Transfer component includes comprehensive accessibility features:

**ARIA Attributes:**
- `role="listbox"` on list containers
- `role="option"` on items
- `aria-selected` indicates selected items
- `aria-disabled` for disabled items
- `aria-label` on control buttons
- `aria-live` regions for status updates

**Keyboard Navigation:**
- `↑/↓` - Navigate between items in focused list
- `Space` - Toggle item selection
- `Enter` - Transfer selected items
- `Ctrl/Cmd + A` - Select all items in focused list
- `Escape` - Clear selection
- `Tab` - Move between lists and controls

**Screen Reader Support:**
- Announces item selection changes
- Announces transfer operations
- Provides count information
- Describes disabled states

**Focus Management:**
- Visible focus indicators
- Focus trap within component
- Focus returns after transfer operations
- Keyboard-only operation support

**Common Patterns:**

**1. Permission Management:**
```typescript
// Assign permissions to roles
const rolePermissions = signal<string[]>([]);

<Transfer
  dataSource={permissions}
  targetKeys={rolePermissions()}
  onTargetKeysChange={rolePermissions.set}
/>
```

**2. User Assignment:**
```typescript
// Assign users to projects/teams
const teamMembers = signal<string[]>([]);

<Transfer
  dataSource={allUsers}
  targetKeys={teamMembers()}
  onTargetKeysChange={teamMembers.set}
  render={(user) => <UserCard user={user} />}
/>
```

**3. Tag Selection:**
```typescript
// Select tags for items
const itemTags = signal<string[]>([]);

<Transfer
  dataSource={availableTags}
  targetKeys={itemTags()}
  onTargetKeysChange={itemTags.set}
/>
```

**4. Category Organization:**
```typescript
// Organize items into categories
const featuredCategories = signal<string[]>([]);

<Transfer
  dataSource={categories}
  targetKeys={featuredCategories()}
  onTargetKeysChange={featuredCategories.set}
/>
```

**Performance Considerations:**

**Virtual Scrolling:**
For large datasets (1000+ items), implement virtual scrolling:

```typescript
import { VirtualList } from 'aether/primitives';

<Transfer.List type="source">
  {#let items}
    <VirtualList
      items={items}
      itemHeight={48}
      height={400}
    >
      {#let item}
        <TransferItem item={item} />
      {/let}
    </VirtualList>
  {/let}
</Transfer.List>
```

**Search Optimization:**
For large datasets, debounce search input:

```typescript
const searchQuery = signal('');
const debouncedSearch = debounce(searchQuery.set, 300);

const filteredItems = computed(() => {
  const query = searchQuery().toLowerCase();
  if (!query) return allItems;
  return allItems.filter(item =>
    item.title.toLowerCase().includes(query)
  );
});
```

**Memoization:**
Cache computed values to avoid unnecessary recalculations:

```typescript
const sourceItems = computed(() => {
  const targetKeys = currentTargetKeys();
  return dataSource.filter(item => !targetKeys.includes(item.key));
}, { equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]) });
```

**Best Practices:**

1. **Use Controlled Mode for Form Integration:**
   ```typescript
   const [formData, setFormData] = createSignal({ permissions: [] });

   <Transfer
     targetKeys={formData().permissions}
     onTargetKeysChange={(keys) => setFormData({ ...formData(), permissions: keys })}
   />
   ```

2. **Provide Clear Labels:**
   ```typescript
   <div class="transfer-panel">
     <h3>Available Items</h3>
     <span class="count">{sourceItems().length} available</span>
     <Transfer.List type="source" />
   </div>
   ```

3. **Handle Empty States:**
   ```typescript
   {#if targetItems().length === 0}
     <div class="empty-state">
       No items selected. Choose items from the left panel.
     </div>
   {/if}
   ```

4. **Show Selection Counts:**
   ```typescript
   <button disabled={selectedSource().length === 0}>
     Transfer ({selectedSource().length})
   </button>
   ```

5. **Implement Search/Filter:**
   ```typescript
   const searchQuery = signal('');
   const filteredItems = computed(() =>
     dataSource.filter(item =>
       item.title.toLowerCase().includes(searchQuery().toLowerCase())
     )
   );
   ```

6. **Provide Visual Feedback:**
   ```typescript
   <div
     class="transfer-item"
     class:selected={isSelected}
     class:disabled={item.disabled}
   >
     {item.title}
   </div>
   ```

7. **Support Bulk Operations:**
   ```typescript
   <button onClick={selectAll}>Select All</button>
   <button onClick={clearAll}>Clear Selection</button>
   ```

8. **Handle Disabled Items:**
   ```typescript
   <Transfer
     dataSource={items.map(item => ({
       ...item,
       disabled: !hasPermission(item.key)
     }))}
   />
   ```

---
