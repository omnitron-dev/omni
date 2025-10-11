## Animation System

### Using `data-state` for Animations

All primitives expose `data-state` attributes for animation:

```css
/* Fade in/out */
.dialog-overlay {
  animation-duration: 200ms;
  animation-timing-function: ease-out;
}

.dialog-overlay[data-state="open"] {
  animation-name: fadeIn;
}

.dialog-overlay[data-state="closed"] {
  animation-name: fadeOut;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* Slide in/out */
.dialog-content[data-state="open"] {
  animation-name: slideIn;
}

.dialog-content[data-state="closed"] {
  animation-name: slideOut;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translate(-50%, -48%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes slideOut {
  from {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  to {
    opacity: 0;
    transform: translate(-50%, -48%) scale(0.96);
  }
}
```

### Animation Helpers

```typescript
// utils/animations.ts
export const presence = (isPresent: () => boolean) => {
  const state = signal<'open' | 'closed'>('closed');
  const isAnimating = signal(false);

  effect(() => {
    if (isPresent()) {
      state('open');
    } else {
      isAnimating(true);
      state('closed');

      // Wait for animation to complete
      setTimeout(() => {
        isAnimating(false);
      }, 200); // Match animation duration
    }
  });

  return {
    state,
    shouldMount: computed(() => isPresent() || isAnimating())
  };
};
```

Usage:

```typescript
import { defineComponent, signal } from 'aether';
const Example285 = defineComponent(() => {
  const isOpen = signal(false);
  const dialogPresence = presence(() => isOpen());

  return () => (
    {#if dialogPresence.shouldMount()}
      <Dialog.Overlay data-state={dialogPresence.state()} />
      <Dialog.Content data-state={dialogPresence.state()}>
        <!-- ... -->
      </Dialog.Content>
    {/if}
  );
});
```

---

