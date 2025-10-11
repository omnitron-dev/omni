### Toggle

A two-state button for binary options.

#### Features

- Pressed/unpressed states
- Keyboard support (Space/Enter)
- Disabled state
- Icon toggles

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Toggle } from 'aether/primitives';

export const TextFormattingToggles = defineComponent(() => {
  const isBold = signal(false);
  const isItalic = signal(false);
  const isUnderline = signal(false);

  return () => (
    <div class="toggle-group">
      <Toggle bind:pressed={isBold} class="toggle" aria-label="Bold">
        <BoldIcon />
      </Toggle>

      <Toggle bind:pressed={isItalic} class="toggle" aria-label="Italic">
        <ItalicIcon />
      </Toggle>

      <Toggle bind:pressed={isUnderline} class="toggle" aria-label="Underline">
        <UnderlineIcon />
      </Toggle>
    </div>
  );
});
```

#### Styling Example

```css
.toggle-group {
  display: inline-flex;
  gap: var(--spacing-1);
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 36px;
  height: 36px;

  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  color: var(--color-text-secondary);

  cursor: pointer;
  outline: none;

  transition: all var(--transition-fast);
}

.toggle:hover {
  background: var(--color-background-secondary);
  color: var(--color-text-primary);
}

.toggle:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.toggle[data-state="on"] {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
  color: white;
}

.toggle[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
```

#### API Reference

**`<Toggle>`** - Toggle button

Props:
- `pressed?: Signal<boolean>` - Controlled pressed state
- `defaultPressed?: boolean` - Initial state
- `onPressedChange?: (pressed: boolean) => void`
- `disabled?: boolean`

---

