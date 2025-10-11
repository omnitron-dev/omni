### Toast

Toast notifications with auto-dismiss, actions, and multiple toast support.

#### Features

- Auto-dismiss with configurable duration
- Max toasts limit (prevents screen clutter)
- Action buttons
- Different variants (default, success, warning, error)
- Keyboard hotkey support (F8 to close)
- Provider pattern with context
- Portal rendering

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Toast, ToastProvider } from 'aether/primitives';

// Wrap your app with ToastProvider
export const App = defineComponent(() => {
  return () => (
    <ToastProvider duration={5000} maxToasts={3}>
      <YourApp />
      <Toast.Viewport class="toast-viewport" />
    </ToastProvider>
  );
});

// Show toasts from anywhere
export const NotificationButton = defineComponent(() => {
  const toastContext = useContext(ToastContext);

  const showToast = () => {
    toastContext.addToast({
      title: 'Success!',
      description: 'Your changes have been saved.',
      variant: 'success',
      duration: 5000,
    });
  };

  return () => (
    <button on:click={showToast}>
      Show Notification
    </button>
  );
});

// With action
export const UndoToast = defineComponent(() => {
  const toastContext = useContext(ToastContext);

  const deleteWithUndo = () => {
    toastContext.addToast({
      title: 'Item deleted',
      description: 'The item has been removed.',
      variant: 'default',
      action: {
        label: 'Undo',
        onClick: () => {
          // Restore the item
          console.log('Undo delete');
        },
      },
    });
  };

  return () => (
    <button on:click={deleteWithUndo}>
      Delete Item
    </button>
  );
});
```

#### Styling Example

```css
.toast-viewport {
  position: fixed;
  bottom: 0;
  right: 0;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
  z-index: var(--z-toast);
}

[data-toast] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-left: 4px solid var(--color-primary-500);
}

[data-toast][data-variant="success"] {
  border-left-color: var(--color-success-500);
}

[data-toast][data-variant="warning"] {
  border-left-color: var(--color-warning-500);
}

[data-toast][data-variant="error"] {
  border-left-color: var(--color-error-500);
}

[data-toast-title] {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
}

[data-toast-description] {
  font-size: 13px;
  color: var(--color-text-secondary);
}

[data-toast-action] {
  align-self: flex-start;
  padding: 4px 12px;
  border-radius: 4px;
  background: var(--color-primary-500);
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

[data-toast-close] {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-size: 18px;
}
```

#### API Reference

**`<ToastProvider>`** - Toast provider (wrap your app)

Props:
- `duration?: number` - Default auto-dismiss duration in ms (default: 5000)
- `maxToasts?: number` - Maximum number of toasts shown at once (default: 3)
- `hotkey?: string[]` - Keyboard hotkey to close toasts (default: ['F8'])
- `children: any` - Your app content

**`<Toast.Viewport>`** - Toast container (render once)

Props:
- `...HTMLAttributes` - Standard ol (ordered list) props

**`<Toast>`** - Individual toast

Props:
- `toast: ToastData` - Toast data object
- `onDismiss?: (id: string) => void` - Dismiss callback

**ToastData** interface:
```typescript
interface ToastData {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

**Context Methods**:
- `addToast(toast: Omit<ToastData, 'id'>): string` - Add new toast, returns ID
- `removeToast(id: string): void` - Remove specific toast
- `toasts(): ToastData[]` - Get all current toasts

---

