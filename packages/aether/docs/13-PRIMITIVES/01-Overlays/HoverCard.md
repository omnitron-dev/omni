### HoverCard

A rich preview card that appears when hovering over an element. Similar to Tooltip but designed for more complex content and interactions.

#### Features

- Rich content support (images, text, buttons)
- Configurable hover delays (open/close)
- Smart positioning (auto-flip, auto-shift)
- Arrow pointing to trigger
- Mouse and keyboard interaction
- Focus management
- Collision detection
- Portal rendering

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { HoverCard } from 'aether/primitives';

export const UserHoverCard = defineComponent(() => {
  return () => (
    <HoverCard>
      <HoverCard.Trigger>
        <a href="/user/john">@john</a>
      </HoverCard.Trigger>

      <HoverCard.Content class="hover-card-content">
        <HoverCard.Arrow class="hover-card-arrow" />

        <img
          src="/avatars/john.jpg"
          alt="John's avatar"
          class="avatar"
        />
        <div class="user-info">
          <h4>John Doe</h4>
          <p class="bio">Software Engineer at Acme Corp</p>
          <div class="stats">
            <span>1.2k followers</span>
            <span>324 following</span>
          </div>
        </div>

        <button class="btn-follow">Follow</button>
      </HoverCard.Content>
    </HoverCard>
  );
});
```

#### With Custom Delays

```typescript
import { defineComponent } from 'aether';
import { HoverCard } from 'aether/primitives';

export const QuickHoverCard = defineComponent(() => {
  return () => (
    <HoverCard
      openDelay={300}   // Show after 300ms hover
      closeDelay={150}  // Hide after 150ms leave
    >
      <HoverCard.Trigger>
        <span class="term">Hover me</span>
      </HoverCard.Trigger>

      <HoverCard.Content side="top" align="center">
        <p>Quick preview card with fast delays</p>
      </HoverCard.Content>
    </HoverCard>
  );
});
```

#### Positioning

```typescript
import { defineComponent } from 'aether';
import { HoverCard } from 'aether/primitives';

export const PositionedHoverCard = defineComponent(() => {
  return () => (
    <>
      {/* Side options: top, right, bottom, left */}
      {/* Align options: start, center, end */}
      <HoverCard>
        <HoverCard.Trigger>
          <a href="#">Hover me</a>
        </HoverCard.Trigger>
        <HoverCard.Content
          side="bottom"
          align="start"
          sideOffset={12}
          alignOffset={0}
        >
          <p>Positioned at bottom-start with 12px offset</p>
        </HoverCard.Content>
      </HoverCard>

      {/* Auto-positioning (flips if no space) */}
      <HoverCard>
        <HoverCard.Trigger>
          <a href="#">Near edge</a>
        </HoverCard.Trigger>
        <HoverCard.Content
          side="top"
          avoidCollisions={true}
          collisionPadding={16}
        >
          <p>Will flip to bottom if not enough space at top</p>
        </HoverCard.Content>
      </HoverCard>

      {/* Right-aligned card */}
      <HoverCard>
        <HoverCard.Trigger>
          <a href="#">Right align</a>
        </HoverCard.Trigger>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={8}
        >
          <p>Opens to the right, aligned to start of trigger</p>
        </HoverCard.Content>
      </HoverCard>
    </>
  );
});
```

#### Rich Content Examples

```typescript
import { defineComponent } from 'aether';
import { HoverCard } from 'aether/primitives';

// Product preview card
export const ProductHoverCard = defineComponent(() => {
  return () => (
    <HoverCard openDelay={500}>
      <HoverCard.Trigger>
        <a href="/products/wireless-mouse">Wireless Mouse</a>
      </HoverCard.Trigger>

      <HoverCard.Content class="product-card">
        <img
          src="/products/mouse-thumb.jpg"
          alt="Wireless Mouse"
          class="product-image"
        />
        <div class="product-details">
          <h4>Wireless Mouse</h4>
          <p class="price">$29.99</p>
          <div class="rating">
            ⭐⭐⭐⭐⭐ <span>(4.8/5 - 234 reviews)</span>
          </div>
          <p class="description">
            Ergonomic wireless mouse with precision tracking
            and 18-month battery life.
          </p>
          <div class="actions">
            <button class="btn-primary">Add to Cart</button>
            <button class="btn-secondary">Quick View</button>
          </div>
        </div>
      </HoverCard.Content>
    </HoverCard>
  );
});

// Link preview card
export const LinkPreviewCard = defineComponent(() => {
  return () => (
    <HoverCard openDelay={800}>
      <HoverCard.Trigger>
        <a href="https://example.com/article">
          Read the full article
        </a>
      </HoverCard.Trigger>

      <HoverCard.Content class="link-preview-card">
        <img
          src="/og-images/article.jpg"
          alt="Article preview"
          class="preview-image"
        />
        <div class="preview-content">
          <h4>The Future of Web Development</h4>
          <p class="excerpt">
            Exploring emerging trends and technologies that will
            shape the next decade of web development...
          </p>
          <div class="meta">
            <span class="author">by Jane Smith</span>
            <span class="date">Oct 11, 2025</span>
            <span class="read-time">5 min read</span>
          </div>
        </div>
      </HoverCard.Content>
    </HoverCard>
  );
});

// Repository info card (GitHub-style)
export const RepoHoverCard = defineComponent(() => {
  return () => (
    <HoverCard openDelay={600}>
      <HoverCard.Trigger>
        <a href="/repos/aether">aether/framework</a>
      </HoverCard.Trigger>

      <HoverCard.Content class="repo-card">
        <div class="repo-header">
          <div class="repo-icon">📦</div>
          <div>
            <h4>aether/framework</h4>
            <p class="visibility">Public</p>
          </div>
        </div>

        <p class="repo-description">
          Minimalist, high-performance frontend framework
          with fine-grained reactivity
        </p>

        <div class="repo-stats">
          <span>⭐ 12.3k</span>
          <span>🔱 2.1k</span>
          <span>TypeScript</span>
        </div>

        <div class="repo-topics">
          <span class="topic">javascript</span>
          <span class="topic">typescript</span>
          <span class="topic">reactivity</span>
          <span class="topic">framework</span>
        </div>

        <div class="repo-footer">
          <span>Updated 2 hours ago</span>
          <span>MIT License</span>
        </div>
      </HoverCard.Content>
    </HoverCard>
  );
});
```

#### Styling Example

```css
.hover-card-content {
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: var(--spacing-4);

  max-width: 320px;
  min-width: 240px;

  z-index: var(--z-popover);

  /* Animation */
  animation: scaleIn 200ms ease-out;
  transform-origin: var(--radix-hover-card-content-transform-origin);
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

/* Arrow */
.hover-card-arrow {
  fill: var(--color-background-primary);
  stroke: var(--color-border);
  stroke-width: 1px;
}

/* User card example */
.hover-card-content .avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  margin-bottom: var(--spacing-3);
}

.hover-card-content .user-info h4 {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin-bottom: var(--spacing-1);
  color: var(--color-text-primary);
}

.hover-card-content .user-info .bio {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-2);
}

.hover-card-content .stats {
  display: flex;
  gap: var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  margin-bottom: var(--spacing-3);
}

.hover-card-content .btn-follow {
  width: 100%;
  padding: var(--spacing-2) var(--spacing-4);
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: var(--font-weight-medium);
}

/* Product card example */
.product-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.product-card .product-image {
  width: 100%;
  height: 160px;
  object-fit: cover;
  border-radius: var(--radius-md);
}

.product-card .price {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-primary);
}

.product-card .rating {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.product-card .actions {
  display: flex;
  gap: var(--spacing-2);
  margin-top: var(--spacing-2);
}
```

#### API Reference

**`<HoverCard>`** - Root component

Props:
- `openDelay?: number` - Delay before showing card in ms (default: 700)
- `closeDelay?: number` - Delay before hiding card in ms (default: 300)

**`<HoverCard.Trigger>`** - Element that triggers the hover card

Automatically rendered as an `<a>` element with proper ARIA attributes:
- `aria-expanded` - Indicates open/closed state
- `aria-haspopup="dialog"` - Indicates presence of dialog
- `data-state` - "open" or "closed" for styling

Events:
- Hover (pointer enter/leave) with configured delays
- Focus/blur for keyboard accessibility

**`<HoverCard.Content>`** - Rich content container

Props:
- `side?: 'top' | 'right' | 'bottom' | 'left'` - Preferred side (default: 'bottom')
- `align?: 'start' | 'center' | 'end'` - Alignment (default: 'center')
- `sideOffset?: number` - Offset from trigger in px (default: 8)
- `alignOffset?: number` - Offset along alignment axis in px (default: 0)
- `avoidCollisions?: boolean` - Auto-flip/shift to avoid viewport edges (default: true)
- `collisionPadding?: number` - Padding from viewport edges in px (default: 8)

ARIA attributes:
- `role="dialog"` - Identifies as dialog for screen readers
- `aria-labelledby` - Links to trigger for context
- `data-state` - "open" or "closed" for styling

Behavior:
- Rendered in Portal (outside DOM hierarchy)
- Stays open when hovering over content
- Closes when mouse leaves content

**`<HoverCard.Arrow>`** - Optional arrow pointing to trigger

Props:
- `width?: number` - Arrow width in px (default: 12)
- `height?: number` - Arrow height in px (default: 6)

#### Interaction Patterns

**Mouse Interaction:**
1. User hovers over trigger
2. After `openDelay` (default 700ms), card appears
3. User can move mouse to card content
4. When mouse leaves both trigger and content, after `closeDelay` (default 300ms), card disappears

**Keyboard Interaction:**
1. User focuses trigger (Tab key)
2. Card appears immediately (no delay)
3. User can interact with card content if it contains focusable elements
4. When focus leaves, card disappears immediately

**Touch Interaction:**
- On touch devices, hover cards are typically not shown
- Consider providing alternative access method (e.g., click to open)

#### Accessibility

The HoverCard primitive follows WAI-ARIA Dialog pattern for rich preview content:

- **Role**: `role="dialog"` on content
- **Labeling**: `aria-labelledby` connects content to trigger
- **State**: `aria-expanded` on trigger indicates open/closed state
- **Discovery**: `aria-haspopup="dialog"` announces dialog presence

**Best Practices:**
- Keep content concise and scannable
- Ensure trigger text is descriptive
- Don't put critical actions only in hover cards (not keyboard accessible on all devices)
- Consider mobile/touch experiences (no hover state)
- Use appropriate delays - too fast is jarring, too slow feels unresponsive
- Test with keyboard navigation
- Ensure sufficient color contrast in card content

#### Comparison: HoverCard vs Tooltip vs Popover

| Feature | HoverCard | Tooltip | Popover |
|---------|-----------|---------|---------|
| **Content** | Rich (images, buttons, complex layouts) | Simple text only | Rich content |
| **Trigger** | Hover (with delay) + focus | Hover (instant) + focus | Click/explicit |
| **Interaction** | Can interact with content | Non-interactive | Full interaction |
| **ARIA Role** | `role="dialog"` | `role="tooltip"` | `role="dialog"` |
| **Use Case** | Preview cards, user profiles, link previews | Label/description, help text | Menus, forms, actions |
| **Delays** | Configurable open/close delays | Minimal/no delay | None (explicit) |
| **Dismissal** | Auto (on mouse leave) | Auto (instant) | Explicit close |
| **Mobile** | Not recommended | Works with long-press | Full support |

**When to use HoverCard:**
- ✅ User profile previews on mentions/avatars
- ✅ Link previews (like Twitter/Slack)
- ✅ Product quick views in e-commerce
- ✅ Repository/file previews in code editors
- ✅ Calendar event details on hover
- ✅ Rich previews of complex data

**When NOT to use HoverCard:**
- ❌ Simple labels/descriptions (use Tooltip)
- ❌ Critical actions (use Popover or Dialog)
- ❌ Mobile-primary interfaces (no hover state)
- ❌ Forms requiring user input (use Popover)
- ❌ When instant feedback is needed (use Tooltip)

#### Best Practices

**1. Appropriate Delays**
```typescript
// Fast preview (quick scan)
<HoverCard openDelay={300} closeDelay={150}>

// Standard preview (most cases)
<HoverCard openDelay={700} closeDelay={300}>

// Deliberate preview (avoid accidental triggers)
<HoverCard openDelay={1000} closeDelay={400}>
```

**2. Content Structure**
```typescript
// ✅ Good: Clear hierarchy, scannable
<HoverCard.Content>
  <img src="..." alt="..." />
  <h4>Clear title</h4>
  <p>Concise description</p>
  <div class="stats">Quick facts</div>
  <button>Optional action</button>
</HoverCard.Content>

// ❌ Bad: Too much text, no hierarchy
<HoverCard.Content>
  <div>Lorem ipsum dolor sit amet, consectetur adipiscing elit...</div>
  <div>More text...</div>
  <div>Even more text...</div>
</HoverCard.Content>
```

**3. Positioning**
```typescript
// ✅ Good: Consider viewport boundaries
<HoverCard.Content
  side="bottom"
  avoidCollisions={true}
  collisionPadding={16}
>

// ✅ Good: Consistent alignment
<HoverCard.Content
  side="right"
  align="start"
  sideOffset={8}
>
```

**4. Performance**
```typescript
// ✅ Good: Load data on hover
export const UserCard = defineComponent((props: { userId: string }) => {
  const userData = signal(null);

  const loadUserData = async () => {
    const data = await fetchUser(props.userId);
    userData.set(data);
  };

  return () => (
    <HoverCard>
      <HoverCard.Trigger on:pointerenter={loadUserData}>
        @{props.userId}
      </HoverCard.Trigger>
      <HoverCard.Content>
        {userData() ? (
          <div>
            <h4>{userData().name}</h4>
            <p>{userData().bio}</p>
          </div>
        ) : (
          <div>Loading...</div>
        )}
      </HoverCard.Content>
    </HoverCard>
  );
});
```

**5. Mobile Considerations**
```typescript
import { defineComponent, signal } from 'aether';
import { HoverCard } from 'aether/primitives';

// Provide alternative for mobile (no hover)
export const AdaptiveUserCard = defineComponent((props) => {
  const isMobile = signal(window.matchMedia('(hover: none)').matches);

  return () => {
    if (isMobile()) {
      // On mobile, use click to open full profile
      return <a href={`/user/${props.userId}`}>@{props.userId}</a>;
    }

    // On desktop, show hover card
    return (
      <HoverCard>
        <HoverCard.Trigger>
          <a href={`/user/${props.userId}`}>@{props.userId}</a>
        </HoverCard.Trigger>
        <HoverCard.Content>
          {/* Rich preview content */}
        </HoverCard.Content>
      </HoverCard>
    );
  };
});
```

#### Advanced: Lazy Loading Content

```typescript
import { defineComponent, signal } from 'aether';
import { HoverCard } from 'aether/primitives';

export const LazyHoverCard = defineComponent((props: { repoId: string }) => {
  const repoData = signal(null);
  const isLoading = signal(false);
  const error = signal(null);

  const loadRepoData = async () => {
    if (repoData() || isLoading()) return;

    isLoading.set(true);
    try {
      const data = await fetch(`/api/repos/${props.repoId}`).then(r => r.json());
      repoData.set(data);
    } catch (err) {
      error.set(err.message);
    } finally {
      isLoading.set(false);
    }
  };

  return () => (
    <HoverCard openDelay={500}>
      <HoverCard.Trigger on:pointerenter={loadRepoData}>
        <a href={`/repos/${props.repoId}`}>{props.repoId}</a>
      </HoverCard.Trigger>

      <HoverCard.Content class="repo-hover-card">
        {isLoading() ? (
          <div class="loading">Loading...</div>
        ) : error() ? (
          <div class="error">Failed to load</div>
        ) : repoData() ? (
          <div>
            <h4>{repoData().name}</h4>
            <p>{repoData().description}</p>
            <div class="stats">
              <span>⭐ {repoData().stars}</span>
              <span>🔱 {repoData().forks}</span>
            </div>
          </div>
        ) : null}
      </HoverCard.Content>
    </HoverCard>
  );
});
```

#### Advanced: Custom Animations

```typescript
import { defineComponent } from 'aether';
import { HoverCard } from 'aether/primitives';

export const AnimatedHoverCard = defineComponent(() => {
  return () => (
    <HoverCard>
      <HoverCard.Trigger>
        <a href="#">Hover me</a>
      </HoverCard.Trigger>

      <HoverCard.Content
        class="animated-hover-card"
        data-animation="slide-up"
      >
        <h4>Animated Card</h4>
        <p>This card slides up smoothly</p>
      </HoverCard.Content>
    </HoverCard>
  );
});
```

```css
.animated-hover-card[data-animation="slide-up"] {
  animation: slideUp 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Slide from side based on position */
.animated-hover-card[data-side="top"] {
  animation: slideDown 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

.animated-hover-card[data-side="right"] {
  animation: slideLeft 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideLeft {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

---
