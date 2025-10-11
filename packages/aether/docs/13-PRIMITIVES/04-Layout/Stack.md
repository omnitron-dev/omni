### Stack

A layout component for stacking elements vertically or horizontally with consistent spacing.

#### Features

- Vertical and horizontal stacking
- Consistent spacing between items
- Alignment control on cross axis
- Justification control on main axis
- Wrapping support
- Divider support (automatic placement between items)
- VStack and HStack convenience wrappers
- Responsive spacing
- Auto pixel conversion for numeric values

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Stack } from 'aether/primitives';

// Vertical stack (default)
const Example256 = defineComponent(() => {
  return () => (
    <Stack spacing={16}>
      <div>Item 1</div>
      <div>Item 2</div>
      <div>Item 3</div>
    </Stack>
  );
});

// Horizontal stack
const Example257 = defineComponent(() => {
  return () => (
    <Stack direction="horizontal" spacing={24}>
      <button>Button 1</button>
      <button>Button 2</button>
      <button>Button 3</button>
    </Stack>
  );
});
```

#### VStack and HStack

```typescript
import { defineComponent } from 'aether';
import { VStack, HStack } from 'aether/primitives';

// VStack - Vertical stack shorthand
const Example258 = defineComponent(() => {
  return () => (
    <VStack spacing={16} align="center">
      <h1>Title</h1>
      <p>Subtitle</p>
      <button>Action</button>
    </VStack>
  );
});

// HStack - Horizontal stack shorthand
const Example259 = defineComponent(() => {
  return () => (
    <HStack spacing={8} align="center">
      <img src="/avatar.jpg" alt="Avatar" />
      <div>
        <h3>John Doe</h3>
        <p>Software Engineer</p>
      </div>
    </HStack>
  );
});
```

#### Alignment Examples

```typescript
// Centered vertical stack
const Example260 = defineComponent(() => {
  return () => (
    <VStack spacing={20} align="center" justify="center" style={{ minHeight: '400px' }}>
      <h1>Welcome</h1>
      <p>Get started by creating your account</p>
      <button>Sign Up</button>
    </VStack>
  );
});

// Horizontal stack with space-between
const Example261 = defineComponent(() => {
  return () => (
    <HStack spacing={16} justify="space-between" align="center">
      <div>Logo</div>
      <nav>Navigation</nav>
      <button>Login</button>
    </HStack>
  );
});

// Stack with end alignment
const Example262 = defineComponent(() => {
  return () => (
    <VStack spacing={12} align="end">
      <p>Amount:</p>
      <p class="price">$99.99</p>
      <p class="tax">Tax: $10.00</p>
      <p class="total">Total: $109.99</p>
    </VStack>
  );
});
```

#### Stack with Divider

```typescript
import { defineComponent } from 'aether';
import { VStack, HStack } from 'aether/primitives';

// Vertical stack with dividers
const Example263 = defineComponent(() => {
  return () => (
    <VStack
      spacing={16}
      divider={<hr style={{ width: '100%', border: 'none', borderTop: '1px solid #e5e7eb' }} />}
    >
      <div>Section 1</div>
      <div>Section 2</div>
      <div>Section 3</div>
    </VStack>
  );
});

// Horizontal stack with dividers
const Example264 = defineComponent(() => {
  return () => (
    <HStack
      spacing={12}
      align="center"
      divider={<span style={{ color: '#ccc' }}>|</span>}
    >
      <a href="/home">Home</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </HStack>
  );
});
```

#### Advanced Usage

```typescript
// Responsive stack with wrapping
const Example265 = defineComponent(() => {
  return () => (
    <HStack spacing={16} wrap align="center">
      <div class="chip">Tag 1</div>
      <div class="chip">Tag 2</div>
      <div class="chip">Tag 3</div>
      <div class="chip">Tag 4</div>
      <div class="chip">Tag 5</div>
    </HStack>
  );
});

// Card with vertical stack
const Example266 = defineComponent(() => {
  return () => (
    <div class="card">
      <VStack spacing={12}>
        <h3>Card Title</h3>
        <p>Card description text goes here</p>
        <HStack spacing={8} justify="end">
          <button>Cancel</button>
          <button class="primary">Confirm</button>
        </HStack>
      </VStack>
    </div>
  );
});

// Form layout with stacks
const Example267 = defineComponent(() => {
  return () => (
    <form>
      <VStack spacing={20}>
        <VStack spacing={8}>
          <label for="name">Name</label>
          <input id="name" type="text" />
        </VStack>

        <VStack spacing={8}>
          <label for="email">Email</label>
          <input id="email" type="email" />
        </VStack>

        <HStack spacing={12} justify="end">
          <button type="button">Cancel</button>
          <button type="submit">Submit</button>
        </HStack>
      </VStack>
    </form>
  );
});
```

#### Styling Example

```css
/* Stack container */
.stack-container {
  background: var(--color-background-secondary);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
}

/* Stack items */
.stack-item {
  padding: var(--spacing-3);
  background: var(--color-background-primary);
  border-radius: var(--radius-sm);
}

/* Responsive spacing */
@media (max-width: 768px) {
  .responsive-stack {
    gap: 8px !important;
  }
}

/* Divider styling */
.stack-divider {
  width: 100%;
  height: 1px;
  background: var(--color-border);
  margin: 0;
}
```

#### API Reference

**`<Stack>`** - Stack container component

Props:
- `direction?: 'vertical' | 'horizontal'` - Stack direction (default: 'vertical')
- `spacing?: number | string` - Spacing between items (number converts to pixels, default: 0)
- `align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'` - Alignment on cross axis
- `justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly'` - Justification on main axis
- `wrap?: boolean` - Allow items to wrap (default: false)
- `divider?: any` - Element to place between stack items (automatically positioned)
- `children?: any` - Child elements
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with stack styles)

**`<VStack>`** - Vertical stack convenience wrapper

Props: Same as Stack, except `direction` is always 'vertical'

**`<HStack>`** - Horizontal stack convenience wrapper

Props: Same as Stack, except `direction` is always 'horizontal'

#### Accessibility Notes

- Stack uses flexbox internally with `display: flex`
- Use semantic HTML elements when appropriate (e.g., `<nav>`, `<article>`)
- Ensure proper heading hierarchy within stacks
- Dividers should have appropriate aria attributes if they convey semantic meaning
- Consider using `<hr>` for dividers in vertical stacks for semantic separation
- Stack order matches visual order for screen readers
- Keyboard navigation follows natural tab order

#### Best Practices

1. **Use VStack and HStack for clarity**: More explicit than Stack with direction prop
2. **Numeric spacing auto-converts**: `spacing={16}` becomes `gap: 16px`
3. **Dividers are automatic**: No need to manually add dividers between items
4. **Prefer Stack over Flex for simple layouts**: Stack is more semantic for 1D item lists
5. **Combine with other layouts**: Use Stack inside Grid or Flex for complex layouts
6. **Responsive design**: Adjust spacing for different screen sizes
7. **Performance**: Stack is lightweight wrapper around flexbox
8. **Wrapping for responsive tags**: Use `wrap` for tag lists, chips, or badges

---

