### Popover

Non-modal floating element positioned relative to a trigger.

#### Features

- Smart positioning (auto-flip, auto-shift)
- Arrow pointing to trigger
- Click outside to close
- Esc to close
- Focus management (optional trap)
- Collision detection
- Virtual element support

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Popover } from 'aether/primitives';

export const NotificationsPopover = defineComponent(() => {
  return () => (
    <Popover>
      <Popover.Trigger class="btn">
        Open Popover
      </Popover.Trigger>

      <Popover.Content class="popover-content">
        <Popover.Arrow class="popover-arrow" />

        <div class="popover-header">
          <h3>Notifications</h3>
          <Popover.Close class="popover-close">
            <XIcon />
          </Popover.Close>
        </div>

        <div class="popover-body">
          <p>You have 3 new notifications</p>
          <ul>
            <li>Message from Alice</li>
            <li>New follower</li>
            <li>Comment on your post</li>
          </ul>
        </div>
      </Popover.Content>
    </Popover>
  );
});
```

#### Positioning

```typescript
import { defineComponent } from 'aether';
import { Popover } from 'aether/primitives';

export const PositionedPopover = defineComponent(() => {
  return () => (
    <>
      {/* Side options: top, right, bottom, left */}
      {/* Align options: start, center, end */}
      <Popover>
        <Popover.Trigger>Open</Popover.Trigger>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          alignOffset={0}
        >
          Positioned at bottom-start with 8px offset
        </Popover.Content>
      </Popover>

      {/* Auto-positioning (flips if no space) */}
      <Popover>
        <Popover.Trigger>Open</Popover.Trigger>
        <Popover.Content
          side="top"
          avoidCollisions={true}
          collisionPadding={16}
        >
          Will flip to bottom if not enough space at top
        </Popover.Content>
      </Popover>
    </>
  );
});
```

#### Styling Example

```css
.popover-content {
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-4);

  max-width: 300px;

  z-index: var(--z-popover);

  /* Animation */
  animation: scaleIn 150ms ease-out;
  transform-origin: var(--radix-popover-content-transform-origin);
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.popover-arrow {
  fill: var(--color-background-primary);
  stroke: var(--color-border);
  stroke-width: 1px;
}
```

#### API Reference

**`<Popover>`** - Root component

Props:
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial open state
- `onOpenChange?: (open: boolean) => void` - Callback
- `modal?: boolean` - Modal behavior (default: false)

**`<Popover.Trigger>`** - Opens the popover

**`<Popover.Anchor>`** - Optional anchor element (different from trigger)

**`<Popover.Content>`** - Popover content

Props:
- `side?: 'top' | 'right' | 'bottom' | 'left'` - Preferred side (default: 'bottom')
- `align?: 'start' | 'center' | 'end'` - Alignment (default: 'center')
- `sideOffset?: number` - Offset from anchor (default: 0)
- `alignOffset?: number` - Offset along alignment axis (default: 0)
- `avoidCollisions?: boolean` - Auto-flip/shift to avoid viewport edges (default: true)
- `collisionPadding?: number | { top, right, bottom, left }` - Padding from edges (default: 10)
- `sticky?: 'partial' | 'always'` - Keep in viewport when scrolling
- `hideWhenDetached?: boolean` - Hide when anchor is fully clipped (default: false)
- `onEscapeKeyDown?: (event: KeyboardEvent) => void`
- `onPointerDownOutside?: (event: PointerEvent) => void`

**`<Popover.Arrow>`** - Arrow pointing to trigger

Props:
- `width?: number` - Arrow width (default: 10)
- `height?: number` - Arrow height (default: 5)

**`<Popover.Close>`** - Closes the popover

#### Advanced: Tooltip Behavior

```typescript
import { defineComponent, signal } from 'aether';
import { Popover } from 'aether/primitives';

export const TooltipBehaviorPopover = defineComponent(() => {
  const delayOpen = 700; // ms
  const delayClose = 300;
  const isOpen = signal(false);

  const handleMouseEnter = () => {
    setTimeout(() => isOpen(true), delayOpen);
  };

  const handleMouseLeave = () => {
    setTimeout(() => isOpen(false), delayClose);
  };

  return () => (
    <Popover bind:open={isOpen}>
      <Popover.Trigger
        on:mouseenter={handleMouseEnter}
        on:mouseleave={handleMouseLeave}
      >
        Hover me
      </Popover.Trigger>

      <Popover.Content
        side="top"
        onPointerDownOutside={(e) => e.preventDefault()} {/* Don't close on outside click */}
      >
        Tooltip content
      </Popover.Content>
    </Popover>
  );
});
```

---

