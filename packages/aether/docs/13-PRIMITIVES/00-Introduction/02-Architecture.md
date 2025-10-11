## Architecture

### Component Structure

Every primitive follows a consistent pattern:

```typescript
// 1. Root Component (Context Provider)
<Primitive>
  {/* Manages state, keyboard navigation, focus management */}

  // 2. Trigger/Button (Opens/activates the primitive)
  <Primitive.Trigger>...</Primitive.Trigger>

  // 3. Content (The main interactive area)
  <Primitive.Content>
    {/* 4. Sub-components (Title, Description, etc.) */}
    <Primitive.Title>...</Primitive.Title>
    <Primitive.Description>...</Primitive.Description>
  </Primitive.Content>

  // 5. Close/Cancel (Dismisses the primitive)
  <Primitive.Close>...</Primitive.Close>
</Primitive>
```

### State Management

Each primitive uses **signals** for reactive state:

```typescript
// Internal implementation (simplified)
export const Dialog = defineComponent(() => {
  // Fine-grained reactive state
  const isOpen = signal(false);
  const triggerRef = signal<HTMLElement | null>(null);
  const contentRef = signal<HTMLElement | null>(null);

  // Computed values
  const shouldRenderContent = computed(() => isOpen());

  // Effects for side effects
  effect(() => {
    if (isOpen()) {
      // Trap focus, disable body scroll
      disableBodyScroll(contentRef());
      trapFocus(contentRef());
    } else {
      // Restore on close
      enableBodyScroll();
      restoreFocus(triggerRef());
    }
  });

  // Provide context to children
  provideContext(DialogContext, {
    isOpen,
    open: () => isOpen(true),
    close: () => isOpen(false),
    toggle: () => isOpen(!isOpen())
  });

  return () => <slot />;
});
```

### Context System

Primitives use Aether context for component communication:

```typescript
// DialogContext.ts
export interface DialogContextValue {
  isOpen: Signal<boolean>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  titleId: string;
  descriptionId: string;
}

export const DialogContext = createContext<DialogContextValue>('Dialog');

// Usage in sub-components
export const DialogTrigger = defineComponent((props) => {
  const ctx = injectContext(DialogContext);

  return () => (
    <button
      id={ctx.triggerId}
      aria-haspopup="dialog"
      aria-expanded={ctx.isOpen()}
      aria-controls={ctx.contentId}
      on:click={ctx.toggle}
      {...props}
    >
      <slot />
    </button>
  );
});
```

### Accessibility Architecture

Every primitive implements WAI-ARIA patterns:

1. **Semantic HTML**: Use native elements when possible
2. **ARIA Attributes**: Proper roles, states, properties
3. **Keyboard Navigation**: Full keyboard support
4. **Focus Management**: Logical tab order, focus trapping
5. **Screen Reader Support**: Announcements, labels, descriptions

```typescript
// Example: Accessible Dialog
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  aria-describedby={descriptionId}
  tabindex="-1"
>
  <h2 id={titleId}>Dialog Title</h2>
  <p id={descriptionId}>Dialog description for screen readers</p>
  {/* Content */}
</div>
```

---

