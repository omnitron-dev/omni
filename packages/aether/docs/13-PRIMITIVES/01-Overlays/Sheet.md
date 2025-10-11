### Sheet

A sliding panel from edge of screen (drawer/slide-over).

#### Features

- Slide from top/right/bottom/left
- Overlay backdrop
- Focus trap
- Esc to close
- Click outside to close
- Responsive sizing

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Sheet } from 'aether/primitives';

export const SettingsSheet = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <Sheet bind:open={isOpen}>
      <Sheet.Trigger class="btn">
        Open Sheet
      </Sheet.Trigger>

      <Sheet.Portal>
        <Sheet.Overlay class="sheet-overlay" />
        <Sheet.Content side="right" class="sheet-content">
          <Sheet.Title class="sheet-title">
            Settings
          </Sheet.Title>
          <Sheet.Description class="sheet-description">
            Manage your account settings
          </Sheet.Description>

          <div class="sheet-body">
            <form>
              <label>
                Username
                <input type="text" value="john_doe" />
              </label>
              <label>
                Email
                <input type="email" value="john@example.com" />
              </label>
            </form>
          </div>

          <div class="sheet-footer">
            <Sheet.Close class="btn btn-secondary">
              Cancel
            </Sheet.Close>
            <button class="btn btn-primary">
              Save Changes
            </button>
          </div>

          <Sheet.Close class="sheet-close-icon" aria-label="Close">
            <XIcon />
          </Sheet.Close>
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet>
  );
});
```

#### Styling Example

```css
.sheet-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: var(--z-modal);
  animation: fadeIn 200ms ease-out;
}

.sheet-content {
  position: fixed;
  z-index: calc(var(--z-modal) + 1);

  background: var(--color-background-primary);
  box-shadow: var(--shadow-xl);

  display: flex;
  flex-direction: column;

  padding: var(--spacing-6);
}

/* Side: right (default) */
.sheet-content[data-side="right"] {
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  max-width: 100vw;
  animation: slideInRight 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

/* Side: left */
.sheet-content[data-side="left"] {
  top: 0;
  left: 0;
  bottom: 0;
  width: 400px;
  animation: slideInLeft 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes slideInLeft {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}

/* Side: top */
.sheet-content[data-side="top"] {
  top: 0;
  left: 0;
  right: 0;
  height: 400px;
  animation: slideInTop 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes slideInTop {
  from {
    transform: translateY(-100%);
  }
  to {
    transform: translateY(0);
  }
}

/* Side: bottom */
.sheet-content[data-side="bottom"] {
  bottom: 0;
  left: 0;
  right: 0;
  height: 400px;
  animation: slideInBottom 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes slideInBottom {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.sheet-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
}

.sheet-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
}

.sheet-body {
  flex: 1;
  overflow-y: auto;
  margin-bottom: var(--spacing-4);
}

.sheet-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
  padding-top: var(--spacing-4);
  border-top: 1px solid var(--color-border);
}

.sheet-close-icon {
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

  color: var(--color-text-secondary);
  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.sheet-close-icon:hover {
  background: var(--color-background-secondary);
}
```

#### API Reference

**`<Sheet>`** - Root component

Props: Same as Dialog

**`<Sheet.Trigger>`** - Opens the sheet

**`<Sheet.Portal>`** - Portal for rendering

**`<Sheet.Overlay>`** - Backdrop overlay

**`<Sheet.Content>`** - Sheet content

Props:
- `side?: 'top' | 'right' | 'bottom' | 'left'` - Which edge to slide from (default: 'right')
- `onEscapeKeyDown?: (event: KeyboardEvent) => void`
- `onPointerDownOutside?: (event: PointerEvent) => void`
- `forceMount?: boolean`

**`<Sheet.Title>`** - Sheet title (required)

**`<Sheet.Description>`** - Sheet description (required)

**`<Sheet.Close>`** - Closes the sheet

---

