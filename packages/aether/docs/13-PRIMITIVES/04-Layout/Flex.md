### Flex

A flexible layout container that provides flexbox functionality with convenient props.

#### Features

- Flexbox layout with shorthand props
- Direction control (row, column, reverse variants)
- Flexible alignment (justify, align, alignContent)
- Gap/spacing support with row and column gaps
- Wrapping control
- Flex grow, shrink, and basis support
- Inline flex option
- Responsive values support
- Auto pixel conversion for numeric values

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Flex } from 'aether/primitives';

const Example241 = defineComponent(() => {
  return () => (
    <Flex gap={16}>
      <div>Item 1</div>
      <div>Item 2</div>
      <div>Item 3</div>
    </Flex>
  );
});
```

#### Alignment Examples

```typescript
// Centered column layout
const Example242 = defineComponent(() => {
  return () => (
    <Flex direction="column" align="center" justify="center">
      <h1>Centered Content</h1>
      <p>Both horizontally and vertically centered</p>
    </Flex>
  );
});

// Space between with wrapping
const Example243 = defineComponent(() => {
  return () => (
    <Flex justify="space-between" wrap="wrap" gap="1rem">
      <div>Item 1</div>
      <div>Item 2</div>
      <div>Item 3</div>
      <div>Item 4</div>
    </Flex>
  );
});

// Reverse direction
const Example244 = defineComponent(() => {
  return () => (
    <Flex direction="row-reverse" gap={8}>
      <button>Cancel</button>
      <button>Submit</button>
    </Flex>
  );
});
```

#### Advanced Usage

```typescript
// Complex flex layout with custom flex values
const Example245 = defineComponent(() => {
  return () => (
    <Flex gap={16}>
      <div style={{ flex: '0 0 200px' }}>
        Sidebar (fixed width)
      </div>
      <Flex direction="column" grow={1} gap={12}>
        <div>Main content area (grows to fill space)</div>
        <div>More content</div>
      </Flex>
      <div style={{ flex: '0 0 250px' }}>
        Right panel (fixed width)
      </div>
    </Flex>
  );
});

// Responsive flex layout with separate row/column gaps
const Example246 = defineComponent(() => {
  return () => (
    <Flex
      direction="column"
      rowGap={24}
      columnGap={16}
      wrap="wrap"
      style={{ maxHeight: '600px' }}
    >
      <div>Item 1</div>
      <div>Item 2</div>
      <div>Item 3</div>
      <div>Item 4</div>
    </Flex>
  );
});

// Inline flex for inline layouts
const Example247 = defineComponent(() => {
  return () => (
    <div>
      Some text followed by
      <Flex inline gap={8} align="center">
        <span>inline</span>
        <span>flex</span>
        <span>items</span>
      </Flex>
      and more text
    </div>
  );
});
```

#### Styling Example

```css
/* Flex container with custom styling */
.flex-container {
  background: var(--color-background-secondary);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
}

/* Flex items */
.flex-item {
  background: var(--color-background-primary);
  padding: var(--spacing-3);
  border-radius: var(--radius-sm);
  transition: transform var(--transition-fast);
}

.flex-item:hover {
  transform: translateY(-2px);
}

/* Responsive flex layout */
@media (max-width: 768px) {
  .responsive-flex {
    flex-direction: column;
  }
}
```

#### API Reference

**`<Flex>`** - Flex container component

Props:
- `as?: string` - Element to render as (default: 'div')
- `direction?: 'row' | 'row-reverse' | 'column' | 'column-reverse'` - Flex direction (default: 'row')
- `justify?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly'` - Justify content on main axis
- `align?: 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch'` - Align items on cross axis
- `alignContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'stretch'` - Align content when wrapping
- `wrap?: 'nowrap' | 'wrap' | 'wrap-reverse'` - Flex wrap behavior
- `gap?: number | string` - Gap between items (number converts to pixels)
- `rowGap?: number | string` - Gap between rows (number converts to pixels)
- `columnGap?: number | string` - Gap between columns (number converts to pixels)
- `grow?: number` - Flex grow factor
- `shrink?: number` - Flex shrink factor
- `basis?: number | string` - Flex basis (number converts to pixels)
- `inline?: boolean` - Use inline-flex display (default: false)
- `children?: any` - Child elements
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with flex styles)

#### Accessibility Notes

- Use semantic HTML elements with the `as` prop when appropriate (e.g., `as="nav"`, `as="header"`)
- Ensure proper heading hierarchy within flex layouts
- Consider using landmark roles for major layout sections
- Flex direction changes can affect screen reader order - ensure logical reading order
- Avoid using flex for data tables - use proper table markup instead

#### Best Practices

1. **Use shorthand props**: Flex provides convenient shorthand props for common flexbox patterns
2. **Numeric values auto-convert to pixels**: `gap={16}` becomes `gap: 16px`
3. **Combine with Grid for complex layouts**: Use Flex for 1D layouts, Grid for 2D layouts
4. **Responsive design**: Control direction and wrapping for mobile-first layouts
5. **Performance**: Flex is lightweight with minimal runtime overhead

---

