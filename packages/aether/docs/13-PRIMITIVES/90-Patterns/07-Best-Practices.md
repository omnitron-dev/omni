## Best Practices

### 1. Always Provide Labels and Descriptions

```html
<!-- ✅ Good - Has title and description -->
<Dialog>
  <Dialog.Content>
    <Dialog.Title>Delete Account</Dialog.Title>
    <Dialog.Description>
      This action cannot be undone
    </Dialog.Description>
    <!-- content -->
  </Dialog.Content>
</Dialog>

<!-- ❌ Bad - Missing title/description -->
<Dialog>
  <Dialog.Content>
    <p>This action cannot be undone</p>
  </Dialog.Content>
</Dialog>
```

### 2. Use Controlled State When Needed

```typescript
// ✅ Good - Controlled when you need external state
import { defineComponent, signal } from 'aether';

const ControlledExample = defineComponent(() => {
  const isOpen = signal(false);

  // Can control from outside
  const openFromElsewhere = () => isOpen(true);

  return () => (
    <Dialog bind:open={isOpen}>
      {/* ... */}
    </Dialog>
  );
});

// ✅ Also Good - Uncontrolled when internal state is fine
const UncontrolledExample = defineComponent(() => {
  return () => (
    <Dialog>
      {/* ... */}
    </Dialog>
  );
});
```

### 3. Keyboard Navigation Must Work

Test all primitives with keyboard only:
- Tab to focus
- Enter/Space to activate
- Escape to close
- Arrow keys to navigate
- Home/End for first/last

### 4. Mobile Touch Support

```css
/* Increase touch target sizes */
.dialog-trigger,
.dialog-close {
  min-width: 44px;
  min-height: 44px;
}

/* Responsive sizing */
@media (max-width: 640px) {
  .dialog-content {
    width: 100vw;
    max-width: none;
    border-radius: 0;
  }
}
```

### 5. Avoid Nesting Modal Overlays

```html
<!-- ❌ Avoid - Confusing UX -->
<Dialog>
  <Dialog.Content>
    <Dialog>
      <Dialog.Content>
        <!-- Nested dialog -->
      </Dialog.Content>
    </Dialog>
  </Dialog.Content>
</Dialog>

<!-- ✅ Better - Use Sheet or step-based flow -->
<Dialog>
  <Dialog.Content>
    {#if step() === 1}
      <FirstStep />
    {:else}
      <SecondStep />
    {/if}
  </Dialog.Content>
</Dialog>
```

### 6. Performance - Virtual Scrolling for Large Lists

```typescript
import { defineComponent } from 'aether';
import { VirtualScroller } from 'aether/primitives';

const Example327 = defineComponent(() => {
  const items = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `Item ${i}` }));

  return () => (
    <Select>
      <Select.Content>
        <VirtualScroller items={items} itemHeight={32}>
          {#let item}
            <Select.Item value={item.id}>
              {item.name}
            </Select.Item>
          {/let}
        </VirtualScroller>
      </Select.Content>
    </Select>
  );
});
```

### 7. Error Boundaries

```typescript
import { defineComponent } from 'aether';
import { ErrorBoundary } from 'aether';

const Example884 = defineComponent(() => {

  return () => (
    <ErrorBoundary fallback={(error) => (
      <div class="error-state">
        <p>Something went wrong</p>
        <pre>{error.message}</pre>
      </div>
    )}>
      <Dialog>
        <!-- ... -->
      </Dialog>
    </ErrorBoundary>
  );
});
```

### 8. Loading States

```typescript
import { defineComponent, signal } from 'aether';
const Example914 = defineComponent(() => {
  const isLoading = signal(true);
  const data = signal(null);
  onMount(async () => {
    const result = await fetchData();
    data(result);
    isLoading(false);
  });

  return () => (
    <Select disabled={isLoading()}>
      <Select.Trigger>
        {#if isLoading()}
          Loading...
        {:else}
          <Select.Value placeholder="Select option" />
        {/if}
      </Select.Trigger>
      {#if !isLoading()}
        <Select.Content>
          <!-- options -->
        </Select.Content>
      {/if}
    </Select>
  );
});
```

---

