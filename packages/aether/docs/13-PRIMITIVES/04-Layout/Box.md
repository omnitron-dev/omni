### Box

The foundational layout component that all other layout components build upon. Box is a polymorphic component that can render as any HTML element.

#### Features

- Polymorphic component (can render as any HTML element)
- Base for all layout primitives
- Minimal runtime overhead
- Simple prop forwarding
- Support for custom styling via class and style props
- Semantic HTML element support
- Clean and predictable API
- TypeScript-friendly with proper type inference

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Box } from 'aether/primitives';

// Default div
const Example268 = defineComponent(() => {
  return () => (
    <Box>
      This is a basic box (renders as div)
    </Box>
  );
});

// Semantic HTML elements
const Example269 = defineComponent(() => {
  return () => (
    <>
      <Box as="section" class="page-section">
        <Box as="header">
          <h1>Section Title</h1>
        </Box>
        <Box as="article">
          <p>Article content...</p>
        </Box>
        <Box as="footer">
          <p>Footer content</p>
        </Box>
      </Box>
    </>
  );
});
```

#### Styling Examples

```typescript
// Box with custom styling
const Example270 = defineComponent(() => {
  return () => (
    <Box
      class="card"
      style={{
        padding: '24px',
        background: '#ffffff',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}
    >
      <h3>Card Title</h3>
      <p>Card content goes here</p>
    </Box>
  );
});

// Colored backgrounds
const Example271 = defineComponent(() => {
  return () => (
    <Box
      style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '48px',
        color: 'white',
        borderRadius: '12px'
      }}
    >
      <h2>Gradient Background</h2>
      <p>Beautiful gradient box</p>
    </Box>
  );
});

// Box as navigation
const Example272 = defineComponent(() => {
  return () => (
    <Box as="nav" class="main-nav" style={{ display: 'flex', gap: '16px' }}>
      <a href="/">Home</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </Box>
  );
});
```

#### Spacing Utilities

```typescript
// Box with padding and margin
const Example273 = defineComponent(() => {
  return () => (
    <Box
      style={{
        padding: '16px 24px',
        margin: '0 auto',
        maxWidth: '800px'
      }}
    >
      Content with spacing
    </Box>
  );
});

// Responsive spacing
const Example274 = defineComponent(() => {
  return () => (
    <Box
      class="responsive-box"
      style={{
        padding: '16px'
      }}
    >
      <p>Responsive content</p>
    </Box>
  );
});
```

#### Advanced Usage

```typescript
// Box as button (although Button primitive is preferred)
const Example275 = defineComponent(() => {
  const handleClick = () => {
    console.log('Box clicked');
  };

  return () => (
    <Box
      as="button"
      type="button"
      onClick={handleClick}
      style={{
        padding: '12px 24px',
        border: 'none',
        borderRadius: '4px',
        background: '#3b82f6',
        color: 'white',
        cursor: 'pointer'
      }}
    >
      Click Me
    </Box>
  );
});

// Box with data attributes
const Example276 = defineComponent(() => {
  return () => (
    <Box
      as="article"
      data-testid="article-box"
      data-category="news"
      role="article"
      aria-label="News Article"
    >
      <h2>Article Title</h2>
      <p>Article content...</p>
    </Box>
  );
});

// Conditional styling
const Example277 = defineComponent(() => {
  const isActive = signal(false);

  return () => (
    <Box
      class={isActive() ? 'box box--active' : 'box'}
      style={{
        padding: '16px',
        background: isActive() ? '#e0f2fe' : '#f3f4f6',
        border: `2px solid ${isActive() ? '#0ea5e9' : '#d1d5db'}`,
        transition: 'all 0.2s'
      }}
      onClick={() => isActive(!isActive())}
    >
      Click to toggle active state
    </Box>
  );
});
```

#### Composition with Other Primitives

```typescript
// Box as container for Flex layout
const Example278 = defineComponent(() => {
  return () => (
    <Box class="page-header" style={{ background: '#1e293b', color: 'white' }}>
      <Flex justify="space-between" align="center" style={{ padding: '16px 24px' }}>
        <Box as="h1" style={{ margin: 0 }}>My App</Box>
        <Box as="nav">
          <HStack spacing={16}>
            <a href="/home">Home</a>
            <a href="/about">About</a>
          </HStack>
        </Box>
      </Flex>
    </Box>
  );
});

// Box with Grid inside
const Example279 = defineComponent(() => {
  return () => (
    <Box class="dashboard" style={{ padding: '24px', background: '#f9fafb' }}>
      <Grid templateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap={24}>
        <Box class="stat-card" style={{ padding: '20px', background: 'white', borderRadius: '8px' }}>
          <h3>Total Users</h3>
          <p class="stat-value">1,234</p>
        </Box>
        <Box class="stat-card" style={{ padding: '20px', background: 'white', borderRadius: '8px' }}>
          <h3>Revenue</h3>
          <p class="stat-value">$45,678</p>
        </Box>
        <Box class="stat-card" style={{ padding: '20px', background: 'white', borderRadius: '8px' }}>
          <h3>Growth</h3>
          <p class="stat-value">+23%</p>
        </Box>
      </Grid>
    </Box>
  );
});
```

#### Styling Example

```css
/* Basic box styles */
.box {
  display: block;
}

/* Card-like box */
.card {
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition-fast);
}

.card:hover {
  box-shadow: var(--shadow-md);
}

/* Box with responsive padding */
.responsive-box {
  padding: var(--spacing-3);
}

@media (min-width: 768px) {
  .responsive-box {
    padding: var(--spacing-6);
  }
}

/* Box states */
.box--active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

/* Box as section */
.page-section {
  margin-bottom: var(--spacing-8);
}

.page-section:last-child {
  margin-bottom: 0;
}
```

#### API Reference

**`<Box>`** - Foundational layout component

Props:
- `as?: string` - Element to render as (default: 'div')
- `children?: any` - Child elements
- `class?: string` - CSS class name
- `style?: Record<string, any>` - Inline styles
- `[key: string]: any` - All other props are forwarded to the rendered element

#### Accessibility Notes

- Use semantic HTML elements via the `as` prop whenever possible
- Box with `as="button"` should have proper button attributes (type, aria-label, etc.)
- Box with `as="nav"` should contain navigation links
- Box with `as="article"` should contain article content with proper heading structure
- Interactive boxes need proper keyboard support and focus indicators
- Ensure proper heading hierarchy when using Box as semantic elements

#### Best Practices

1. **Use semantic HTML**: Prefer `<Box as="section">` over `<Box>` for major sections
2. **Keep it simple**: Box is meant to be lightweight - use it for basic container needs
3. **Prefer specific primitives**: Use Flex, Grid, Stack for layout instead of styling Box with flexbox/grid
4. **Type forwarding**: Box forwards all props to the underlying element
5. **Composition over configuration**: Build complex components from simple Box primitives
6. **CSS over inline styles**: Use classes for reusable styles, inline styles for dynamic values
7. **Accessibility first**: Always use appropriate semantic elements via the `as` prop
8. **Performance**: Box has near-zero runtime overhead

---

