## Advanced Patterns

### Custom Primitives

Build your own primitives following the same patterns:

```typescript
// components/primitives/Rating.tsx
import { defineComponent, signal, injectContext, provideContext } from 'aether';

interface RatingContextValue {
  value: Signal<number>;
  max: number;
  readonly: boolean;
  setValue: (value: number) => void;
}

const RatingContext = createContext<RatingContextValue>('Rating');

export const Rating = defineComponent((props) => {
  const value = signal(props.defaultValue || 0);
  const max = props.max || 5;
  const readonly = props.readonly || false;

  const setValue = (newValue: number) => {
    if (!readonly) {
      value(newValue);
      props.onValueChange?.(newValue);
    }
  };

  provideContext(RatingContext, {
    value,
    max,
    readonly,
    setValue
  });

  return () => (
    <div role="group" aria-label="Rating" {...props}>
      <slot />
    </div>
  );
});

export const RatingItem = defineComponent((props) => {
  const ctx = injectContext(RatingContext);
  const itemValue = props.value;

  const isActive = computed(() => itemValue <= ctx.value());

  const handleClick = () => {
    ctx.value.set(itemValue);
  };

  return () => (
    <button
      role="radio"
      aria-checked={isActive()}
      aria-label={`${itemValue} stars`}
      data-active={isActive()}
      on:click={handleClick}
      disabled={ctx.readonly}
      {...props}
    >
      <slot />
    </button>
  );
});
```

Usage:

```typescript
import { defineComponent, signal } from 'aether';
const Example324 = defineComponent(() => {
  const rating = signal(3);

  return () => (
    <Rating bind:value={rating} max={5}>
      {#each Array(5) as _, i}
        <RatingItem value={i + 1} class="rating-star">
          <StarIcon />
        </RatingItem>
      {/each}
    </Rating>
  );
});
```

### Polymorphic Components (`asChild`)

Allow components to merge props into children:

```typescript
// Implementation
export const Button = defineComponent((props) => {
  if (props.asChild) {
    // Merge props into child element
    return () => (
      <slot {...omit(props, ['asChild'])} />
    );
  }

  return () => (
    <button {...props}>
      <slot />
    </button>
  );
});
```

Usage:

```html
<!-- Renders a button -->
<Button class="my-btn">Click me</Button>

<!-- Renders an anchor with button props -->
<Button asChild>
  <a href="/profile" class="my-btn">Profile</a>
</Button>
```

---

