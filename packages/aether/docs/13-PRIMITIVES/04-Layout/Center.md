### Center

A flex-based centering utility that perfectly centers child elements both horizontally and vertically.

#### Features

- Centers content horizontally and vertically using flexbox
- Can be rendered as inline or block element
- Optional height constraint for vertical centering control
- Optional width constraint for horizontal sizing
- Minimal overhead with pure CSS-based centering
- Works with any child content (text, images, components)
- Zero JavaScript centering logic (pure CSS)
- Composable with other layout primitives

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Center } from 'aether/primitives';

// Basic centering
const Example295 = defineComponent(() => {
  return () => (
    <Center height={300}>
      <div>This content is perfectly centered</div>
    </Center>
  );
});

// Full viewport height centering
const Example296 = defineComponent(() => {
  return () => (
    <Center height="100vh">
      <div style={{ textAlign: 'center' }}>
        <h1>Welcome</h1>
        <p>This is centered in the full viewport</p>
      </div>
    </Center>
  );
});

// Center with fixed dimensions
const Example297 = defineComponent(() => {
  return () => (
    <Center width={400} height={300} style={{ border: '1px solid #ccc' }}>
      <img src="/logo.png" alt="Logo" width={200} />
    </Center>
  );
});
```

#### Inline Centering

```typescript
// Center inline (useful within text flow)
const Example298 = defineComponent(() => {
  return () => (
    <p>
      This text has an inline centered icon{' '}
      <Center inline width={24} height={24}>
        <svg>...</svg>
      </Center>
      {' '}in the middle.
    </p>
  );
});

// Inline centering for buttons
const Example299 = defineComponent(() => {
  return () => (
    <Center inline>
      <button>Centered Button</button>
    </Center>
  );
});
```

#### Loading States

```typescript
// Center loading spinner
const Example300 = defineComponent(() => {
  const isLoading = signal(true);

  return () => (
    {#if isLoading()}
      <Center height="100vh">
        <Spinner size="lg" />
      </Center>
    {:else}
      <div>Content loaded</div>
    {/if}
  );
});

// Center in a card
const Example301 = defineComponent(() => {
  return () => (
    <Card width={400}>
      <Center height={200}>
        <VStack spacing={12} align="center">
          <Spinner />
          <Text>Loading data...</Text>
        </VStack>
      </Center>
    </Card>
  );
});
```

#### Empty States

```typescript
// Center empty state message
const Example302 = defineComponent(() => {
  const items = signal([]);

  return () => (
    {#if items().length === 0}
      <Center height={400}>
        <VStack spacing={16} align="center">
          <Icon name="inbox" size={48} color="gray" />
          <Text fontSize={18} fontWeight="bold">No items found</Text>
          <Text color="gray">Start by adding your first item</Text>
          <button class="btn-primary">Add Item</button>
        </VStack>
      </Center>
    {:else}
      <ItemList items={items()} />
    {/if}
  );
});

// Center error state
const Example303 = defineComponent(() => {
  return () => (
    <Center height="50vh">
      <VStack spacing={16} align="center">
        <Icon name="alert-circle" size={64} color="red" />
        <Text fontSize={20} fontWeight="bold">Something went wrong</Text>
        <Text color="gray">We couldn't load the data. Please try again.</Text>
        <button class="btn-primary">Retry</button>
      </VStack>
    </Center>
  );
});
```

#### Modal Content

```typescript
// Center content in modals
const Example304 = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <Dialog bind:open={isOpen}>
      <Dialog.Trigger>Open Confirmation</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <Dialog.Content class="dialog-content">
          <Center height={200}>
            <VStack spacing={20} align="center">
              <Icon name="check-circle" size={64} color="green" />
              <Dialog.Title style={{ textAlign: 'center' }}>
                Success!
              </Dialog.Title>
              <Dialog.Description style={{ textAlign: 'center' }}>
                Your changes have been saved successfully.
              </Dialog.Description>
              <Dialog.Close class="btn-primary">Done</Dialog.Close>
            </VStack>
          </Center>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
});
```

#### Image Centering

```typescript
// Center images of varying sizes
const Example305 = defineComponent(() => {
  return () => (
    <Center width={400} height={300} style={{ background: '#f5f5f5' }}>
      <img
        src="/product.jpg"
        alt="Product"
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </Center>
  );
});

// Center avatar in profile card
const Example306 = defineComponent(() => {
  return () => (
    <Card width={300}>
      <Center height={200} style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <Avatar src="/avatar.jpg" size="xl" />
      </Center>
      <Box p={16}>
        <Center>
          <VStack spacing={8} align="center">
            <Text fontSize={20} fontWeight="bold">John Doe</Text>
            <Text color="gray">Software Engineer</Text>
          </VStack>
        </Center>
      </Box>
    </Card>
  );
});
```

#### With Constraints

```typescript
// Center with max-width constraint
const Example307 = defineComponent(() => {
  return () => (
    <Center height={400}>
      <Box style={{ maxWidth: '500px', textAlign: 'center' }}>
        <h2>Welcome to Our Platform</h2>
        <p>
          This content is centered and constrained to a maximum width
          for better readability.
        </p>
        <button class="btn-primary">Get Started</button>
      </Box>
    </Center>
  );
});

// Multiple centered items with spacing
const Example308 = defineComponent(() => {
  return () => (
    <Center height={500}>
      <VStack spacing={32} align="center">
        <Center width={100} height={100} style={{ background: '#3b82f6', borderRadius: '50%' }}>
          <Icon name="rocket" size={48} color="white" />
        </Center>
        <VStack spacing={12} align="center">
          <h1>Launch Your Project</h1>
          <p style={{ textAlign: 'center', maxWidth: '400px' }}>
            Get started with our platform and take your ideas to the next level.
          </p>
        </VStack>
        <HStack spacing={16}>
          <button class="btn-primary">Start Free Trial</button>
          <button class="btn-secondary">Learn More</button>
        </HStack>
      </VStack>
    </Center>
  );
});
```

#### Styling Examples

```css
/* Basic center container */
.center-container {
  background: #f9fafb;
  border-radius: 8px;
  padding: 24px;
}

/* Center with shadow */
.center-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  padding: 32px;
}

/* Full page center */
.full-page-center {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* Center with border */
.bordered-center {
  border: 2px dashed #cbd5e0;
  border-radius: 8px;
  background: #f7fafc;
}
```

```typescript
// Using styled centers
const Example309 = defineComponent(() => {
  return () => (
    <Center height={400} class="center-card">
      <VStack spacing={16} align="center">
        <h2>Styled Center</h2>
        <p>This center has custom styling</p>
      </VStack>
    </Center>
  );
});
```

#### API Reference

**`<Center>`** - Flex-based centering utility

Props:
- `inline?: boolean` - Display as inline-flex instead of flex (default: false)
- `height?: number | string` - Height of container. Numbers convert to pixels. Enables vertical centering
- `width?: number | string` - Width of container. Numbers convert to pixels
- `children?: any` - Child elements to center
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with center styles)
- All other props are forwarded to the underlying div element

#### Accessibility Notes

- Center is purely presentational and doesn't affect accessibility
- Use semantic HTML elements inside Center when appropriate
- Don't rely solely on centering for visual hierarchy - use proper heading levels
- Ensure adequate color contrast for centered text content
- Consider responsive behavior - full viewport height might not work well on mobile
- Centered text should have appropriate font sizes for readability

#### Best Practices

1. **Use for layout, not semantics**: Center is a presentational component - wrap semantic elements, don't replace them
2. **Height is key**: Center needs a height to vertically center content. Use viewport units (vh) or pixel values
3. **Avoid excessive nesting**: Don't nest multiple Centers - flatten your layout structure
4. **Mobile considerations**: Full viewport heights (100vh) can be problematic on mobile due to browser UI
5. **Loading states**: Perfect for centering loading spinners and empty states
6. **Modal content**: Great for centering content within dialogs and modals
7. **Image centering**: Combine with object-fit for responsive image centering
8. **Inline usage**: Use `inline` prop sparingly - mainly for icons within text
9. **Performance**: Center has zero JavaScript overhead - pure CSS flexbox
10. **Composition**: Combine with VStack/HStack for complex centered layouts

---

