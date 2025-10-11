### Dialog

A modal dialog that overlays the page content.

#### Features

- Focus trapping
- Body scroll locking
- Esc to close
- Click outside to close (optional)
- Focus restoration on close
- Nested dialog support
- Animated enter/exit
- Portal rendering (escape DOM hierarchy)

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Dialog } from 'aether/primitives';

export const ProfileDialog = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <Dialog bind:open={isOpen}>
      <Dialog.Trigger>Open Dialog</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <Dialog.Content class="dialog-content">
          <Dialog.Title class="dialog-title">
            Edit Profile
          </Dialog.Title>
          <Dialog.Description class="dialog-description">
            Make changes to your profile here. Click save when you're done.
          </Dialog.Description>

          <form class="dialog-form">
            <label>
              Name
              <input type="text" value="John Doe" />
            </label>
            <label>
              Email
              <input type="email" value="john@example.com" />
            </label>
          </form>

          <div class="dialog-actions">
            <Dialog.Close class="btn-secondary">Cancel</Dialog.Close>
            <button class="btn-primary" on:click={() => save()}>
              Save Changes
            </button>
          </div>

          <Dialog.Close class="dialog-close-icon" aria-label="Close">
            <XIcon />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
});
```

#### Controlled vs Uncontrolled

```typescript
// Uncontrolled (Dialog manages state internally)
<Dialog>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>...</Dialog.Content>
</Dialog>

// Controlled (You manage state externally)
const isOpen = signal(false);

<Dialog bind:open={isOpen}>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>...</Dialog.Content>
</Dialog>

// Programmatic control
<button on:click={() => isOpen(true)}>Open from outside</button>
```

#### Styling Example

```css
/* Overlay (backdrop) */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: var(--z-modal);

  /* Animation */
  animation: fadeIn 200ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Content */
.dialog-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  width: 90vw;
  max-width: 450px;
  max-height: 85vh;
  overflow: auto;

  background: var(--color-background-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: var(--spacing-6);

  z-index: calc(var(--z-modal) + 1);

  /* Animation */
  animation: slideIn 200ms ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translate(-50%, -48%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

/* Title */
.dialog-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
}

/* Description */
.dialog-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
}

/* Close icon button */
.dialog-close-icon {
  position: absolute;
  top: var(--spacing-4);
  right: var(--spacing-4);

  display: flex;
  align-items: center;
  justify-content: center;

  width: 32px;
  height: 32px;

  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;

  color: var(--color-text-secondary);

  transition: background-color var(--transition-fast);
}

.dialog-close-icon:hover {
  background: var(--color-background-secondary);
}
```

#### API Reference

**`<Dialog>`** - Root component

Props:
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial open state (uncontrolled)
- `onOpenChange?: (open: boolean) => void` - Callback when open state changes
- `modal?: boolean` - Whether to render as modal (default: true)

**`<Dialog.Trigger>`** - Opens the dialog

Props:
- `asChild?: boolean` - Merge props into child instead of wrapping

**`<Dialog.Portal>`** - Portal for rendering outside DOM hierarchy

Props:
- `container?: HTMLElement` - Custom container (default: document.body)

**`<Dialog.Overlay>`** - Backdrop overlay

**`<Dialog.Content>`** - Main dialog content

Props:
- `onEscapeKeyDown?: (event: KeyboardEvent) => void` - Handle Esc key
- `onPointerDownOutside?: (event: PointerEvent) => void` - Handle click outside
- `onInteractOutside?: (event: Event) => void` - Handle any interaction outside
- `forceMount?: boolean` - Force mount even when closed (for animations)
- `trapFocus?: boolean` - Trap focus within dialog (default: true)
- `closeOnEscape?: boolean` - Close on Esc key (default: true)
- `closeOnOutsideClick?: boolean` - Close on outside click (default: true)

**`<Dialog.Title>`** - Dialog title (required for accessibility)

**`<Dialog.Description>`** - Dialog description (required for accessibility)

**`<Dialog.Close>`** - Closes the dialog

#### Advanced: Nested Dialogs

```html
<Dialog>
  <Dialog.Trigger>Open Outer</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>Outer Dialog</Dialog.Title>

    <!-- Nested dialog -->
    <Dialog>
      <Dialog.Trigger>Open Inner</Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Title>Inner Dialog</Dialog.Title>
        <p>This is a nested dialog</p>
        <Dialog.Close>Close Inner</Dialog.Close>
      </Dialog.Content>
    </Dialog>

    <Dialog.Close>Close Outer</Dialog.Close>
  </Dialog.Content>
</Dialog>
```

Focus management automatically handles nested dialogs:
- Focus trap applies to the topmost dialog
- Esc closes only the topmost dialog
- Closing inner dialog restores focus to outer dialog

#### Advanced: Custom Close Behavior

```typescript
import { defineComponent, signal } from 'aether';
import { Dialog } from 'aether/primitives';

export const UnsavedChangesDialog = defineComponent(() => {
  const isOpen = signal(false);
  const hasUnsavedChanges = signal(false);

  const handleOpenChange = (open: boolean) => {
    if (!open && hasUnsavedChanges()) {
      // Prevent closing if there are unsaved changes
      if (!confirm('You have unsaved changes. Close anyway?')) {
        return; // Don't close
      }
    }
    isOpen(open);
  };

  return () => (
    <Dialog bind:open={isOpen} onOpenChange={handleOpenChange}>
      {/* ... */}
    </Dialog>
  );
});
```

#### Advanced: Animation with `forceMount`

```typescript
import { defineComponent, signal } from 'aether';
import { Dialog } from 'aether/primitives';
import { presence } from 'aether/primitives/animation';

export const AnimatedDialog = defineComponent(() => {
  const isOpen = signal(false);
  const overlayPresence = presence(() => isOpen());
  const contentPresence = presence(() => isOpen());

  return () => (
    <Dialog bind:open={isOpen}>
      <Dialog.Trigger>Open</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          forceMount
          data-state={overlayPresence.state()}
          class="dialog-overlay"
        />
        <Dialog.Content
          forceMount
          data-state={contentPresence.state()}
          class="dialog-content"
        >
          {/* Content */}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
});
```

```css
/* Animate based on data-state */
.dialog-overlay[data-state="open"] {
  animation: fadeIn 200ms;
}

.dialog-overlay[data-state="closed"] {
  animation: fadeOut 200ms;
}

.dialog-content[data-state="open"] {
  animation: slideIn 200ms;
}

.dialog-content[data-state="closed"] {
  animation: slideOut 200ms;
}
```

---

