### Popconfirm

Confirmation dialog displayed in a popover, lightweight alternative to AlertDialog.

#### Features

- Lightweight confirmation pattern
- Popover-based UI
- Confirm/cancel callbacks
- Icon and description support
- Keyboard accessible
- Auto-positioning
- Cancel on outside click

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Popconfirm } from 'aether/primitives';

const Example235 = defineComponent(() => {
  const handleConfirm = async () => {
    await deleteItem();
    notify.success('Item deleted');
  };

  return () => (
    <Popconfirm
      title="Delete this item?"
      description="This action cannot be undone."
      onConfirm={handleConfirm}
    >
      <button class="btn-danger">Delete</button>
    </Popconfirm>
  );
});
```

#### Advanced Usage

```typescript
// Custom confirmation with async handling
const Example236 = defineComponent(() => {
  const loading = signal(false);

  const handleConfirm = async () => {
    loading.set(true);
    try {
      await api.deleteUser(userId);
      notify.success('User deleted successfully');
    } catch (error) {
      notify.error('Failed to delete user');
    } finally {
      loading.set(false);
    }
  };

  const handleCancel = () => {
    console.log('Deletion cancelled');
  };

  return () => (
    <Popconfirm
      title="Delete user account?"
      description="This will permanently delete the user and all associated data."
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      confirmText={loading() ? 'Deleting...' : 'Delete'}
      cancelText="Cancel"
      icon={<WarningIcon />}
    >
      <button class="btn-danger" disabled={loading()}>
        Delete User
      </button>
    </Popconfirm>
  );
});
```

**API:**

**`<Popconfirm>`** - Root container
- `title: string` - Confirmation title
- `description?: string` - Additional description
- `onConfirm?: () => void | Promise<void>` - Confirm callback
- `onCancel?: () => void` - Cancel callback
- `confirmText?: string` - Confirm button text (default: 'Confirm')
- `cancelText?: string` - Cancel button text (default: 'Cancel')
- `icon?: any` - Custom icon

**`<Popconfirm.Trigger>`** - Trigger element

**`<Popconfirm.Title>`** - Confirmation title

**`<Popconfirm.Actions>`** - Action buttons container

---

