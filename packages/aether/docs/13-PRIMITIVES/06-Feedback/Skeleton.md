### Skeleton

Loading placeholders with shimmer animation.

#### Features

- Configurable width, height, border radius
- Optional shimmer animation
- ARIA busy state for screen readers
- Simple and lightweight
- Customizable via CSS

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Skeleton } from 'aether/primitives';

// Text skeleton
export const TextSkeleton = defineComponent(() => {
  return () => (
    <div class="text-skeleton-container">
      <Skeleton width="100%" height="20px" class="skeleton" />
      <Skeleton width="80%" height="20px" class="skeleton" />
      <Skeleton width="60%" height="20px" class="skeleton" />
    </div>
  );
});

// Avatar skeleton
export const AvatarSkeleton = defineComponent(() => {
  return () => (
    <Skeleton width="40px" height="40px" radius="50%" class="skeleton" />
  );
});

// Card skeleton
export const CardSkeleton = defineComponent(() => {
  return () => (
    <div class="card-skeleton">
      <Skeleton width="100%" height="200px" radius="8px" class="skeleton" />
      <Skeleton width="100%" height="24px" class="skeleton" />
      <Skeleton width="100%" height="16px" class="skeleton" />
      <Skeleton width="70%" height="16px" class="skeleton" />
    </div>
  );
});

// Disable animation
export const StaticSkeleton = defineComponent(() => {
  return () => (
    <Skeleton width="100%" height="100px" animate={false} class="skeleton" />
  );
});
```

#### Styling Example

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-background-secondary) 0%,
    var(--color-background-tertiary) 50%,
    var(--color-background-secondary) 100%
  );
  background-size: 200% 100%;
}

.skeleton[data-animate] {
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.text-skeleton-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
```

#### API Reference

**`<Skeleton>`** - Skeleton loader

Props:
- `width?: string | number` - Width (CSS value or number in px)
- `height?: string | number` - Height (CSS value or number in px)
- `radius?: string | number` - Border radius (CSS value or number in px, default: '4px')
- `animate?: boolean` - Enable shimmer animation (default: true)
- `...HTMLAttributes` - Standard div props

---

