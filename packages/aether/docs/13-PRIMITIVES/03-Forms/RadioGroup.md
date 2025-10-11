### Radio Group

A set of radio buttons where only one can be selected.

#### Features

- Keyboard navigation (Arrow keys)
- Form integration
- Disabled options
- Required validation
- Custom styling

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { RadioGroup } from 'aether/primitives';

export const PlanSelector = defineComponent(() => {
  const selectedPlan = signal('pro');

  return () => (
    <RadioGroup bind:value={selectedPlan} class="radio-group">
      <RadioGroup.Item value="free" id="free" class="radio-item">
        <RadioGroup.Indicator class="radio-indicator" />
      </RadioGroup.Item>
      <label for="free" class="radio-label">
        <div class="radio-label-title">Free</div>
        <div class="radio-label-description">
          For personal projects
        </div>
      </label>

      <RadioGroup.Item value="pro" id="pro" class="radio-item">
        <RadioGroup.Indicator class="radio-indicator" />
      </RadioGroup.Item>
      <label for="pro" class="radio-label">
        <div class="radio-label-title">Pro</div>
        <div class="radio-label-description">
          For professional use
        </div>
      </label>

      <RadioGroup.Item value="enterprise" id="enterprise" class="radio-item">
        <RadioGroup.Indicator class="radio-indicator" />
      </RadioGroup.Item>
      <label for="enterprise" class="radio-label">
        <div class="radio-label-title">Enterprise</div>
        <div class="radio-label-description">
          For large organizations
        </div>
      </label>
    </RadioGroup>
  );
});
```

#### Styling Example

```css
.radio-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.radio-item {
  width: 20px;
  height: 20px;

  background: var(--color-background-primary);
  border: 2px solid var(--color-border);
  border-radius: 50%;

  cursor: pointer;
  outline: none;

  transition: border-color var(--transition-fast);
}

.radio-item:hover {
  border-color: var(--color-primary-500);
}

.radio-item:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.radio-item[data-state="checked"] {
  border-color: var(--color-primary-500);
}

.radio-item[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.radio-indicator {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 100%;
  height: 100%;
}

.radio-indicator::after {
  content: '';
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary-500);
}

.radio-label {
  cursor: pointer;
}

.radio-label-title {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.radio-label-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
```

#### API Reference

**`<RadioGroup>`** - Root component

Props:
- `value?: Signal<string>` - Controlled selected value
- `defaultValue?: string` - Initial value
- `onValueChange?: (value: string) => void`
- `disabled?: boolean` - Disable all items
- `required?: boolean` - Required for forms
- `name?: string` - Form field name
- `orientation?: 'horizontal' | 'vertical'` - For keyboard navigation (default: 'vertical')
- `loop?: boolean` - Loop focus with arrow keys (default: true)

**`<RadioGroup.Item>`** - Radio button

Props:
- `value: string` - Item value
- `disabled?: boolean`
- `id?: string` - For label association

**`<RadioGroup.Indicator>`** - Checked indicator (only renders when checked)

---

