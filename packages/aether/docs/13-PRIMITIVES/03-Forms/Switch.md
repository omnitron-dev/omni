### Switch

An on/off control (like iOS toggle).

#### Features

- On/off states
- Keyboard support
- Disabled state
- Form integration
- Animated thumb

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Switch } from 'aether/primitives';

export const SettingsSwitches = defineComponent(() => {
  const airplaneMode = signal(false);
  const wifiEnabled = signal(true);

  return () => (
    <div class="switch-group">
      <div class="switch-wrapper">
        <Switch
          bind:checked={airplaneMode}
          id="airplane"
          class="switch"
        >
          <Switch.Thumb class="switch-thumb" />
        </Switch>
        <label for="airplane" class="switch-label">
          Airplane Mode
        </label>
      </div>

      <div class="switch-wrapper">
        <Switch
          bind:checked={wifiEnabled}
          id="wifi"
          class="switch"
        >
          <Switch.Thumb class="switch-thumb" />
        </Switch>
        <label for="wifi" class="switch-label">
          Wi-Fi
        </label>
      </div>
    </div>
  );
});
```

#### Styling Example

```css
.switch-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.switch-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.switch {
  position: relative;
  width: 44px;
  height: 24px;

  background: var(--color-background-secondary);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-full);

  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.switch:hover {
  background: var(--color-background-tertiary);
}

.switch:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.switch[data-state="checked"] {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
}

.switch[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.switch-thumb {
  display: block;
  width: 18px;
  height: 18px;

  background: white;
  border-radius: 50%;
  box-shadow: var(--shadow-sm);

  transition: transform var(--transition-fast);
  will-change: transform;
}

.switch[data-state="checked"] .switch-thumb {
  transform: translateX(20px);
}

.switch-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  user-select: none;
}
```

#### API Reference

**`<Switch>`** - Switch component

Props:
- `checked?: Signal<boolean>` - Controlled checked state
- `defaultChecked?: boolean` - Initial state
- `onCheckedChange?: (checked: boolean) => void`
- `disabled?: boolean`
- `required?: boolean`
- `name?: string` - Form field name
- `value?: string` - Form field value

**`<Switch.Thumb>`** - Moving thumb element

---

