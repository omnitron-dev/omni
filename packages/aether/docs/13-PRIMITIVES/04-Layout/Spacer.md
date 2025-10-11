### Spacer

A flexible space component that grows to fill available space in flex layouts, pushing adjacent elements apart. Unlike Space which adds fixed gaps, Spacer creates dynamic space.

#### Features

- Creates flexible space in flex layouts
- Automatically grows to fill available space
- Works in both horizontal and vertical flex containers
- Configurable flex-grow and flex-shrink values
- Optional flex-basis control
- Pushes adjacent elements to edges
- No visual output (aria-hidden by default)
- Minimal runtime overhead

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Spacer, Flex } from 'aether/primitives';

// Push items to edges
const Example314 = defineComponent(() => {
  return () => (
    <Flex>
      <button>Left</button>
      <Spacer />
      <button>Right</button>
    </Flex>
  );
});

// Multiple spacers for equal distribution
const Example315 = defineComponent(() => {
  return () => (
    <Flex>
      <div>Start</div>
      <Spacer />
      <div>Middle</div>
      <Spacer />
      <div>End</div>
    </Flex>
  );
});

// Vertical layout
const Example316 = defineComponent(() => {
  return () => (
    <Flex direction="column" style={{ height: '400px' }}>
      <div>Header</div>
      <Spacer />
      <div>Footer</div>
    </Flex>
  );
});
```

#### Navigation Layouts

```typescript
// Navbar with logo and actions
const Example317 = defineComponent(() => {
  return () => (
    <Flex
      as="nav"
      align="center"
      style={{
        padding: '16px 24px',
        background: '#1e293b',
        color: 'white'
      }}
    >
      <div class="logo">
        <strong>MyApp</strong>
      </div>
      <Spacer />
      <Flex gap={16}>
        <a href="/">Home</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </Flex>
      <Spacer />
      <button class="btn-primary">Login</button>
    </Flex>
  );
});

// Header with title and actions
const Example318 = defineComponent(() => {
  return () => (
    <Flex align="center" style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
      <h1 style={{ margin: 0 }}>Dashboard</h1>
      <Spacer />
      <Flex gap={12}>
        <button class="btn-secondary">Export</button>
        <button class="btn-primary">New Item</button>
      </Flex>
    </Flex>
  );
});

// Mobile menu with back button
const Example319 = defineComponent(() => {
  return () => (
    <Flex
      align="center"
      style={{
        padding: '12px 16px',
        background: '#f9fafb',
        borderBottom: '1px solid #e5e7eb'
      }}
    >
      <button class="icon-btn">←</button>
      <Spacer />
      <h2 style={{ margin: 0, fontSize: '18px' }}>Settings</h2>
      <Spacer />
      <button class="icon-btn">✓</button>
    </Flex>
  );
});
```

#### Footer Layouts

```typescript
// Simple footer with copyright and links
const Example320 = defineComponent(() => {
  return () => (
    <Flex
      as="footer"
      align="center"
      style={{
        padding: '24px',
        background: '#f3f4f6',
        borderTop: '1px solid #e5e7eb'
      }}
    >
      <p style={{ margin: 0 }}>© 2025 MyCompany</p>
      <Spacer />
      <Flex gap={16}>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/contact">Contact</a>
      </Flex>
    </Flex>
  );
});

// Footer with social icons
const Example321 = defineComponent(() => {
  return () => (
    <Flex
      as="footer"
      direction="column"
      gap={16}
      style={{ padding: '32px 24px', background: '#1e293b', color: 'white' }}
    >
      <Flex align="center">
        <div class="logo">MyBrand</div>
        <Spacer />
        <Flex gap={12}>
          <a href="#" class="social-icon">𝕏</a>
          <a href="#" class="social-icon">in</a>
          <a href="#" class="social-icon">f</a>
        </Flex>
      </Flex>
      <div style={{ fontSize: '14px', opacity: 0.7 }}>
        © 2025 MyBrand. All rights reserved.
      </div>
    </Flex>
  );
});
```

#### Card Layouts

```typescript
// Card with header and actions
const Example322 = defineComponent(() => {
  return () => (
    <div class="card">
      <Flex align="center" class="card-header">
        <h3>Card Title</h3>
        <Spacer />
        <button class="icon-btn">⋮</button>
      </Flex>
      <div class="card-body">
        <p>Card content goes here with whatever you need.</p>
      </div>
    </div>
  );
});

// List item with label and value
const Example323 = defineComponent(() => {
  return () => (
    <Flex align="center" style={{ padding: '12px', borderBottom: '1px solid #e5e7eb' }}>
      <span class="label">Total Amount</span>
      <Spacer />
      <strong class="value">$1,234.56</strong>
    </Flex>
  );
});

// Settings row
const Example324 = defineComponent(() => {
  const enabled = signal(true);

  return () => (
    <Flex align="center" style={{ padding: '16px' }}>
      <div>
        <h4 style={{ margin: 0 }}>Notifications</h4>
        <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
          Receive push notifications
        </p>
      </div>
      <Spacer />
      <Switch bind:checked={enabled}>
        <Switch.Thumb />
      </Switch>
    </Flex>
  );
});
```

#### Custom Grow Values

```typescript
// Proportional spacers
const Example325 = defineComponent(() => {
  return () => (
    <Flex style={{ width: '100%', padding: '16px', background: '#f3f4f6' }}>
      <div class="box">Item 1</div>
      <Spacer grow={2} />
      <div class="box">Item 2</div>
      <Spacer grow={1} />
      <div class="box">Item 3</div>
    </Flex>
  );
});

// Spacer with basis
const Example326 = defineComponent(() => {
  return () => (
    <Flex>
      <div>Start</div>
      <Spacer basis={100} />
      <div>End (100px minimum gap)</div>
    </Flex>
  );
});
```

#### Vertical Layouts

```typescript
// Full-height layout with sticky footer
const Example327 = defineComponent(() => {
  return () => (
    <Flex direction="column" style={{ minHeight: '100vh' }}>
      <header style={{ padding: '16px', background: '#1e293b', color: 'white' }}>
        <h1>My App</h1>
      </header>

      <main style={{ padding: '24px' }}>
        <h2>Main Content</h2>
        <p>This content can be any height, and the footer will stick to the bottom.</p>
      </main>

      <Spacer />

      <footer style={{ padding: '16px', background: '#f3f4f6', borderTop: '1px solid #e5e7eb' }}>
        © 2025 MyApp
      </footer>
    </Flex>
  );
});

// Sidebar with spacer
const Example328 = defineComponent(() => {
  return () => (
    <Flex direction="column" style={{ height: '100vh', width: '240px', background: '#f9fafb' }}>
      <div style={{ padding: '16px' }}>
        <strong>Menu</strong>
      </div>

      <nav>
        <a href="/" class="nav-item">Dashboard</a>
        <a href="/projects" class="nav-item">Projects</a>
        <a href="/team" class="nav-item">Team</a>
        <a href="/settings" class="nav-item">Settings</a>
      </nav>

      <Spacer />

      <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
        <button class="btn-block">Logout</button>
      </div>
    </Flex>
  );
});
```

#### Styling Example

```css
/* Spacer doesn't need styling - it's invisible */
/* Style the surrounding layout and items */

/* Navigation links */
nav a {
  color: inherit;
  text-decoration: none;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  transition: background 0.2s;
}

nav a:hover {
  background: var(--color-background-hover);
}

/* Icon buttons */
.icon-btn {
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background 0.2s;
}

.icon-btn:hover {
  background: var(--color-background-hover);
}

/* Social icons */
.social-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  color: white;
  text-decoration: none;
  transition: background 0.2s;
}

.social-icon:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* Settings row */
.label {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.value {
  font-size: 16px;
  color: var(--color-text-primary);
}

/* Card components */
.card-header {
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.card-body {
  padding: 16px;
}

/* Navigation items */
.nav-item {
  display: block;
  padding: 12px 16px;
  color: var(--color-text-primary);
  text-decoration: none;
  transition: background 0.2s;
}

.nav-item:hover {
  background: var(--color-background-hover);
}

.nav-item.active {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: 500;
}
```

#### API Reference

**`<Spacer>`** - Flexible space in flex layouts

Props:
- `grow?: number` - Flex grow value (default: 1) - controls how much space the spacer takes
- `shrink?: number` - Flex shrink value (default: 0) - controls if spacer can shrink
- `basis?: number | string` - Flex basis value - minimum size before growing
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with spacer styles)
- Has `aria-hidden="true"` by default since it's not interactive

#### Accessibility Notes

- Spacer is purely presentational with `aria-hidden="true"`
- Does not affect screen reader navigation or keyboard focus
- Invisible to assistive technologies
- Use semantic HTML around Spacer (nav, header, footer)
- Ensure keyboard navigation works properly in parent flex container
- Don't use Spacer as a substitute for proper semantic spacing

#### Best Practices

1. **Use in flex containers**: Spacer only works inside flex layouts (Flex component or CSS flexbox)
2. **Push to edges**: Perfect for navbar/header/footer layouts where you want items at edges
3. **Vertical layouts**: Great for sticky footer patterns with full-height layouts
4. **Multiple spacers**: Use multiple spacers for proportional distribution
5. **Combine with gaps**: Use Flex gap for spacing between items, Spacer for pushing apart
6. **Grow control**: Adjust grow values for proportional space distribution
7. **Don't use for vertical spacing**: Use Space or Stack for vertical spacing between elements
8. **Parent must be flex**: Spacer has no effect in non-flex layouts
9. **Invisible element**: Spacer creates no visual output - it just fills space
10. **Performance**: Minimal overhead - just sets flex properties

#### Spacer vs Space

**Critical Distinction**:

**Space** - Adds fixed gaps between ALL children (uses CSS gap)
```typescript
<Space size="md">
  <button>A</button>
  <button>B</button>
  <button>C</button>
</Space>
// Result: A [16px] B [16px] C (fixed gaps)
```

**Spacer** - Creates flexible space that grows (uses flex-grow)
```typescript
<Flex>
  <button>A</button>
  <Spacer />
  <button>B</button>
</Flex>
// Result: A [flexible space that grows] B (pushed to edges)
```

**When to use**:
- Use **Space** when: You want consistent fixed spacing between multiple elements
- Use **Spacer** when: You want to push elements apart with flexible growing space
- Use **Space** for: Button groups, tag lists, form fields, toolbars
- Use **Spacer** for: Navbars, headers, footers, card layouts, list items

---

