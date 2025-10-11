### ToggleGroup

A group of toggle buttons with single or multiple selection support, perfect for formatting toolbars or filter controls.

#### Features

- Single and multiple selection modes
- Keyboard navigation (arrows, Home, End)
- Horizontal and vertical orientation
- Loop navigation support
- Disabled state handling
- ARIA toolbar/radiogroup pattern
- Controlled and uncontrolled modes

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { ToggleGroup } from 'aether/primitives';

const Example = defineComponent(() => {
  const alignment = signal('left');

  return () => (
    <ToggleGroup
      type="single"
      value={alignment()}
      onValueChange={alignment}
      class="toggle-group"
    >
      <ToggleGroup.Item value="left" class="toggle-item">
        Left
      </ToggleGroup.Item>
      <ToggleGroup.Item value="center" class="toggle-item">
        Center
      </ToggleGroup.Item>
      <ToggleGroup.Item value="right" class="toggle-item">
        Right
      </ToggleGroup.Item>
    </ToggleGroup>
  );
});
```

#### With Multiple Selection

```typescript
const Example = defineComponent(() => {
  const styles = signal<string[]>(['bold']);

  return () => (
    <ToggleGroup
      type="multiple"
      value={styles()}
      onValueChange={styles}
    >
      <ToggleGroup.Item value="bold">
        <BoldIcon />
      </ToggleGroup.Item>
      <ToggleGroup.Item value="italic">
        <ItalicIcon />
      </ToggleGroup.Item>
      <ToggleGroup.Item value="underline">
        <UnderlineIcon />
      </ToggleGroup.Item>
    </ToggleGroup>
  );
});
```

#### API

**`<ToggleGroup>`** - Root component
- `value?: string | string[]` - Controlled value (string for single, array for multiple)
- `onValueChange?: (value: string | string[]) => void` - Value change callback
- `defaultValue?: string | string[]` - Default value (uncontrolled)
- `type?: 'single' | 'multiple'` - Selection type (default: 'single')
- `orientation?: 'horizontal' | 'vertical'` - Orientation (default: 'horizontal')
- `disabled?: boolean` - Whether the group is disabled
- `loop?: boolean` - Loop keyboard navigation (default: true)
- `required?: boolean` - Selection required in single mode (default: false)

**`<ToggleGroup.Item>`** - Individual toggle item
- `value: string` - Unique value for this item
- `disabled?: boolean` - Whether this item is disabled

---

