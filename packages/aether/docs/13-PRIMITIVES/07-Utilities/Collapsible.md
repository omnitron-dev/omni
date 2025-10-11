### Collapsible

Collapsible content regions (single-item accordion).

#### Features

- Controlled and uncontrolled modes
- Smooth height animations
- Disabled state
- forceMount support for animations
- Keyboard accessible (Space/Enter to toggle)

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Collapsible } from 'aether/primitives';

// Uncontrolled
export const SimpleCollapsible = defineComponent(() => {
  return () => (
    <Collapsible defaultOpen={false} class="collapsible">
      <Collapsible.Trigger class="collapsible-trigger">
        Show More
      </Collapsible.Trigger>
      <Collapsible.Content class="collapsible-content">
        <p>Additional content that can be collapsed...</p>
      </Collapsible.Content>
    </Collapsible>
  );
});

// Controlled
export const ControlledCollapsible = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <>
      <button on:click={() => isOpen(!isOpen())}>
        {isOpen() ? 'Hide' : 'Show'} Details
      </button>

      <Collapsible bind:open={isOpen} class="collapsible">
        <Collapsible.Content class="collapsible-content">
          <p>Controlled content...</p>
        </Collapsible.Content>
      </Collapsible>
    </>
  );
});
```

#### Styling Example

```css
.collapsible {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.collapsible-trigger {
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: none;
  text-align: left;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.collapsible-trigger:hover {
  background: var(--color-background-secondary);
}

.collapsible-trigger::after {
  content: '▼';
  transition: transform 200ms ease;
}

.collapsible[data-state="open"] .collapsible-trigger::after {
  transform: rotate(-180deg);
}

.collapsible-content {
  overflow: hidden;
  padding: 0 16px;
  transition: height 200ms ease;
}

.collapsible[data-state="open"] .collapsible-content {
  padding: 16px;
}
```

#### API Reference

**`<Collapsible>`** - Collapsible container

Props:
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial state (uncontrolled)
- `onOpenChange?: (open: boolean) => void` - Open change callback
- `disabled?: boolean` - Disable interaction
- `...HTMLAttributes` - Standard div props

**`<Collapsible.Trigger>`** - Toggle button

Props:
- `...HTMLAttributes` - Standard button props

**`<Collapsible.Content>`** - Collapsible content

Props:
- `forceMount?: boolean` - Always mount (for animations)
- `...HTMLAttributes` - Standard div props

---

