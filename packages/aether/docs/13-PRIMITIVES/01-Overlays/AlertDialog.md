### Alert Dialog

A modal dialog that interrupts the user for important information or actions.

#### Features

- Focus trap
- No click-outside to close (must use button)
- Esc key disabled by default (customizable)
- Cancel and action buttons
- Destructive action styling

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { AlertDialog } from 'aether/primitives';

export const DeleteAccountAlert = defineComponent(() => {
  const isOpen = signal(false);

  const handleDelete = () => {
    // Perform destructive action
    console.log('Deleted!');
    isOpen(false);
  };

  return () => (
    <AlertDialog bind:open={isOpen}>
      <AlertDialog.Trigger class="btn btn-destructive">
        Delete Account
      </AlertDialog.Trigger>

      <AlertDialog.Portal>
        <AlertDialog.Overlay class="dialog-overlay" />
        <AlertDialog.Content class="alert-dialog-content">
          <AlertDialog.Title class="alert-dialog-title">
            Are you absolutely sure?
          </AlertDialog.Title>
          <AlertDialog.Description class="alert-dialog-description">
            This action cannot be undone. This will permanently delete your
            account and remove your data from our servers.
          </AlertDialog.Description>

          <div class="alert-dialog-actions">
            <AlertDialog.Cancel class="btn btn-secondary">
              Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
              class="btn btn-destructive"
              on:click={handleDelete}
            >
              Yes, delete my account
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
});
```

#### Styling Example

```css
.alert-dialog-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  width: 90vw;
  max-width: 500px;

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: var(--spacing-6);

  z-index: calc(var(--z-modal) + 1);

  animation: slideIn 200ms ease-out;
}

.alert-dialog-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
}

.alert-dialog-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-bottom: var(--spacing-6);
}

.alert-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
}
```

#### API Reference

**`<AlertDialog>`** - Root component

Props:
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial state
- `onOpenChange?: (open: boolean) => void`

**`<AlertDialog.Trigger>`** - Opens the dialog

**`<AlertDialog.Portal>`** - Portal for rendering

**`<AlertDialog.Overlay>`** - Backdrop overlay

**`<AlertDialog.Content>`** - Dialog content

Props:
- `onEscapeKeyDown?: (event: KeyboardEvent) => void` - Esc disabled by default
- `onPointerDownOutside?: (event: PointerEvent) => void` - Outside click disabled
- `forceMount?: boolean`

**`<AlertDialog.Title>`** - Dialog title (required)

**`<AlertDialog.Description>`** - Dialog description (required)

**`<AlertDialog.Cancel>`** - Cancel button (closes dialog)

**`<AlertDialog.Action>`** - Action button (does not auto-close, you must close manually)

---

