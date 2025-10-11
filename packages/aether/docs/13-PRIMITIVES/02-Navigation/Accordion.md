### Accordion

Vertically stacked set of interactive headings that expand/collapse content panels.

#### Features

- Single or multiple items open
- Keyboard navigation
- Smooth animations
- Disabled items
- Controlled/uncontrolled

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Accordion } from 'aether/primitives';

export const FAQAccordion = defineComponent(() => {
  return () => (
    <Accordion type="single" collapsible class="accordion-root">
      <Accordion.Item value="item-1" class="accordion-item">
        <Accordion.Trigger class="accordion-trigger">
          What is Aether?
          <ChevronDownIcon class="accordion-chevron" />
        </Accordion.Trigger>
        <Accordion.Content class="accordion-content">
          Aether is a minimalist frontend framework that combines the best
          ideas from React, Vue, Svelte, and SolidJS into a cohesive,
          developer-friendly package.
        </Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="item-2" class="accordion-item">
        <Accordion.Trigger class="accordion-trigger">
          How does reactivity work?
          <ChevronDownIcon class="accordion-chevron" />
        </Accordion.Trigger>
        <Accordion.Content class="accordion-content">
          Aether uses fine-grained reactivity based on signals, similar to
          SolidJS. This allows surgical DOM updates without a Virtual DOM.
        </Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="item-3" class="accordion-item">
        <Accordion.Trigger class="accordion-trigger">
          Is it production ready?
          <ChevronDownIcon class="accordion-chevron" />
        </Accordion.Trigger>
        <Accordion.Content class="accordion-content">
          Yes! Aether is used in production by several companies and has
          excellent test coverage.
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
});
```

#### Multiple Items Open

```typescript
import { defineComponent, signal } from 'aether';
import { Accordion } from 'aether/primitives';

export const MultiAccordion = defineComponent(() => {
  const openItems = signal(['item-1', 'item-3']);

  return () => (
    <Accordion type="multiple" bind:value={openItems}>
      <Accordion.Item value="item-1">
        <Accordion.Trigger>Item 1</Accordion.Trigger>
        <Accordion.Content>Content 1</Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="item-2">
        <Accordion.Trigger>Item 2</Accordion.Trigger>
        <Accordion.Content>Content 2</Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="item-3">
        <Accordion.Trigger>Item 3</Accordion.Trigger>
        <Accordion.Content>Content 3</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
});
```

#### Styling Example

```css
.accordion-root {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.accordion-item {
  border-bottom: 1px solid var(--color-border);
}

.accordion-item:last-child {
  border-bottom: none;
}

.accordion-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;

  width: 100%;
  padding: var(--spacing-4);

  background: transparent;
  border: none;

  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  text-align: left;

  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.accordion-trigger:hover {
  background: var(--color-background-secondary);
}

.accordion-trigger:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-primary-500);
}

.accordion-trigger[data-disabled] {
  color: var(--color-text-disabled);
  pointer-events: none;
}

.accordion-chevron {
  transition: transform var(--transition-normal);
}

.accordion-trigger[data-state="open"] .accordion-chevron {
  transform: rotate(180deg);
}

.accordion-content {
  overflow: hidden;

  /* Animation */
  data-state: closed;
}

.accordion-content[data-state="open"] {
  animation: slideDown 300ms cubic-bezier(0.87, 0, 0.13, 1);
}

.accordion-content[data-state="closed"] {
  animation: slideUp 300ms cubic-bezier(0.87, 0, 0.13, 1);
}

@keyframes slideDown {
  from {
    height: 0;
    opacity: 0;
  }
  to {
    height: var(--radix-accordion-content-height);
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    height: var(--radix-accordion-content-height);
    opacity: 1;
  }
  to {
    height: 0;
    opacity: 0;
  }
}

.accordion-content > div {
  padding: var(--spacing-4);
  padding-top: 0;
}
```

#### API Reference

**`<Accordion>`** - Root component

Props:
- `type: 'single' | 'multiple'` - Single or multiple items open
- `value?: Signal<string> | Signal<string[]>` - Controlled open items
- `defaultValue?: string | string[]` - Initial open items
- `onValueChange?: (value: string | string[]) => void`
- `collapsible?: boolean` - Allow all items to close (type="single" only, default: false)
- `disabled?: boolean` - Disable all items
- `orientation?: 'horizontal' | 'vertical'` - For keyboard navigation (default: 'vertical')

**`<Accordion.Item>`** - Accordion item

Props:
- `value: string` - Item identifier
- `disabled?: boolean`

**`<Accordion.Trigger>`** - Expand/collapse button

**`<Accordion.Content>`** - Expandable content

Props:
- `forceMount?: boolean` - Keep mounted when closed (for animations)

---

