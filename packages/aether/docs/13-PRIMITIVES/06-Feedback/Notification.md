### Notification

Global notification system for displaying messages with auto-dismiss and stacking.

#### Features

- Global notification API
- Auto-dismiss with duration
- Stacked notifications
- Multiple placements (top-left, top-right, bottom-left, bottom-right)
- Close on click
- Max notification limit
- Custom icons and actions
- ARIA announcements

#### Basic Usage

```typescript
import { notify } from 'aether/primitives';

// Simple notification
notify({
  message: 'Operation completed successfully',
  type: 'success',
  duration: 3000
});

// With title and description
notify({
  title: 'Update Available',
  message: 'A new version of the app is available.',
  type: 'info',
  duration: 5000
});

// Error notification (no auto-dismiss)
notify({
  title: 'Error',
  message: 'Failed to save changes. Please try again.',
  type: 'error',
  duration: 0 // Won't auto-dismiss
});
```

#### Advanced Usage

```typescript
// Notification with custom actions
const Example237 = defineComponent(() => {
  const showUpdateNotification = () => {
    const id = notify({
      title: 'Update Available',
      message: 'Version 2.0 is now available. Would you like to update?',
      type: 'info',
      duration: 0,
      actions: [
        {
          label: 'Update Now',
          onClick: () => {
            window.location.reload();
          }
        },
        {
          label: 'Later',
          onClick: () => {
            closeNotification(id);
          }
        }
      ]
    });
  };

  return () => (
    <button onClick={showUpdateNotification}>
      Check for Updates
    </button>
  );
});

// Notification container with custom placement
const Example238 = defineComponent(() => {
  return () => (
    <Notification placement="top-right" maxCount={3} duration={4000} />
  );
});
```

**API:**

**`notify(options)`** - Show notification
- `message: string` - Notification message
- `title?: string` - Notification title
- `type?: 'success' | 'info' | 'warning' | 'error'` - Notification type
- `duration?: number` - Auto-dismiss duration in ms (0 = no auto-dismiss, default: 4500)
- `icon?: any` - Custom icon
- `actions?: Action[]` - Action buttons

**`closeNotification(id: string)`** - Close specific notification

**`<Notification>`** - Notification container
- `placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'` - Position (default: 'top-right')
- `maxCount?: number` - Maximum visible notifications
- `duration?: number` - Default duration

---

