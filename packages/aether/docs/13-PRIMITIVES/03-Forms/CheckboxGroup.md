### Checkbox Group

A set of checkboxes for multi-selection.

#### Features

- Individual checkboxes
- Select all functionality
- Indeterminate state
- Form integration
- Disabled options

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Checkbox } from 'aether/primitives';

export const BasicCheckboxes = defineComponent(() => {
  const agreedToTerms = signal(false);
  const subscribedToNewsletter = signal(true);

  return () => (
    <div class="checkbox-group">
      <div class="checkbox-wrapper">
        <Checkbox bind:checked={agreedToTerms} id="terms" class="checkbox">
          <Checkbox.Indicator class="checkbox-indicator">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox>
        <label for="terms" class="checkbox-label">
          I agree to the terms and conditions
        </label>
      </div>

      <div class="checkbox-wrapper">
        <Checkbox
          bind:checked={subscribedToNewsletter}
          id="newsletter"
          class="checkbox"
        >
          <Checkbox.Indicator class="checkbox-indicator">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox>
        <label for="newsletter" class="checkbox-label">
          Subscribe to newsletter
        </label>
      </div>
    </div>
  );
});
```

#### Select All with Indeterminate

```typescript
import { defineComponent, signal, computed } from 'aether';
import { Checkbox } from 'aether/primitives';

export const SelectAllCheckboxes = defineComponent(() => {
  const items = ['item1', 'item2', 'item3'];
  const selectedItems = signal<string[]>(['item1']);

  // Select all checkbox state
  const allSelected = computed(() => selectedItems().length === items.length);
  const someSelected = computed(() =>
    selectedItems().length > 0 && selectedItems().length < items.length
  );
  const selectAllState = computed<boolean | 'indeterminate'>(() => {
    if (allSelected()) return true;
    if (someSelected()) return 'indeterminate';
    return false;
  });

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      selectedItems(items);
    } else {
      selectedItems([]);
    }
  };

  const handleItemChange = (item: string, checked: boolean) => {
    if (checked) {
      selectedItems([...selectedItems(), item]);
    } else {
      selectedItems(selectedItems().filter(i => i !== item));
    }
  };

  return () => (
    <div class="checkbox-group">
      {/* Select all */}
      <div class="checkbox-wrapper">
        <Checkbox
          checked={selectAllState()}
          onCheckedChange={handleSelectAll}
          id="select-all"
          class="checkbox"
        >
          <Checkbox.Indicator class="checkbox-indicator">
            {selectAllState() === 'indeterminate' ? <MinusIcon /> : <CheckIcon />}
          </Checkbox.Indicator>
        </Checkbox>
        <label for="select-all" class="checkbox-label">
          <strong>Select All</strong>
        </label>
      </div>

      {/* Individual items */}
      {items.map(item => (
        <div class="checkbox-wrapper checkbox-wrapper-indent">
          <Checkbox
            checked={selectedItems().includes(item)}
            onCheckedChange={(checked) => handleItemChange(item, checked)}
            id={item}
            class="checkbox"
          >
            <Checkbox.Indicator class="checkbox-indicator">
              <CheckIcon />
            </Checkbox.Indicator>
          </Checkbox>
          <label for={item} class="checkbox-label">
            {item}
          </label>
        </div>
      ))}
    </div>
  );
});
```

#### Styling Example

```css
.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.checkbox-wrapper-indent {
  padding-left: var(--spacing-4);
}

.checkbox {
  width: 20px;
  height: 20px;

  display: flex;
  align-items: center;
  justify-content: center;

  background: var(--color-background-primary);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);

  cursor: pointer;
  outline: none;

  transition: all var(--transition-fast);
}

.checkbox:hover {
  border-color: var(--color-primary-500);
}

.checkbox:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.checkbox[data-state="checked"],
.checkbox[data-state="indeterminate"] {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
}

.checkbox[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.checkbox-indicator {
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
}

.checkbox-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  user-select: none;
}
```

#### API Reference

**`<Checkbox>`** - Checkbox component

Props:
- `checked?: Signal<boolean | 'indeterminate'>` - Controlled checked state
- `defaultChecked?: boolean` - Initial state
- `onCheckedChange?: (checked: boolean | 'indeterminate') => void`
- `disabled?: boolean`
- `required?: boolean`
- `name?: string` - Form field name
- `value?: string` - Form field value

**`<Checkbox.Indicator>`** - Checked/indeterminate indicator

---

