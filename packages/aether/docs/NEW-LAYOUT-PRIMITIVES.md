# New Layout Primitives Documentation

**These 4 primitives should be inserted into 13-PRIMITIVES.md BEFORE the "## Composition Patterns" section (around line 13706)**

---

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

### Divider

A visual separator with optional label support, providing flexible divider styles for organizing content sections.

#### Features

- Horizontal and vertical orientation support
- Optional label/text with flexible positioning (start, center, end)
- Multiple style variants (solid, dashed, dotted)
- Configurable thickness and color
- Flexible label spacing control
- Semantic HTML with proper ARIA attributes
- Decorative mode for purely visual dividers
- Enhanced version of Separator with more features
- No runtime overhead for simple dividers

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Divider } from 'aether/primitives';

// Basic horizontal divider
const Example310 = defineComponent(() => {
  return () => (
    <div>
      <p>Content above</p>
      <Divider />
      <p>Content below</p>
    </div>
  );
});

// Divider with label
const Example311 = defineComponent(() => {
  return () => (
    <div>
      <p>First section content</p>
      <Divider label="OR" />
      <p>Second section content</p>
    </div>
  );
});

// Divider with children as label
const Example312 = defineComponent(() => {
  return () => (
    <div>
      <section>Previous section</section>
      <Divider>
        <span style={{ fontWeight: 'bold', color: '#666' }}>Next Section</span>
      </Divider>
      <section>Next section</section>
    </div>
  );
});
```

#### Label Positioning

```typescript
// Label at start (left for horizontal, top for vertical)
const Example313 = defineComponent(() => {
  return () => (
    <div>
      <Divider label="Section Title" labelPosition="start" />
      <p>Content under the section</p>
    </div>
  );
});

// Label at center (default)
const Example314 = defineComponent(() => {
  return () => (
    <div>
      <h2>Features</h2>
      <Divider label="Premium Only" labelPosition="center" />
      <p>Premium features listed here</p>
    </div>
  );
});

// Label at end (right for horizontal, bottom for vertical)
const Example315 = defineComponent(() => {
  return () => (
    <div>
      <p>Main content</p>
      <Divider label="End of Section" labelPosition="end" />
    </div>
  );
});
```

#### Style Variants

```typescript
// Solid divider (default)
const Example316 = defineComponent(() => {
  return () => (
    <div>
      <p>Solid style</p>
      <Divider variant="solid" />
      <p>Content</p>
    </div>
  );
});

// Dashed divider
const Example317 = defineComponent(() => {
  return () => (
    <div>
      <p>Dashed style</p>
      <Divider variant="dashed" color="#cbd5e0" />
      <p>Content</p>
    </div>
  );
});

// Dotted divider
const Example318 = defineComponent(() => {
  return () => (
    <div>
      <p>Dotted style</p>
      <Divider variant="dotted" color="#94a3b8" />
      <p>Content</p>
    </div>
  );
});

// Combined: Label with variant
const Example319 = defineComponent(() => {
  return () => (
    <div>
      <section>Section 1</section>
      <Divider label="Optional Features" variant="dashed" />
      <section>Section 2</section>
    </div>
  );
});
```

#### Thickness and Color

```typescript
// Thick divider
const Example320 = defineComponent(() => {
  return () => (
    <div>
      <h1>Main Title</h1>
      <Divider thickness={3} color="#1e293b" />
      <p>Content with prominent separator</p>
    </div>
  );
});

// Thin subtle divider
const Example321 = defineComponent(() => {
  return () => (
    <div>
      <p>Item 1</p>
      <Divider thickness={1} color="#e5e7eb" />
      <p>Item 2</p>
    </div>
  );
});

// Colored divider with label
const Example322 = defineComponent(() => {
  return () => (
    <div>
      <section>Free Features</section>
      <Divider
        label="PREMIUM"
        thickness={2}
        color="#3b82f6"
        style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '12px' }}
      />
      <section>Premium Features</section>
    </div>
  );
});
```

#### Vertical Dividers

```typescript
// Basic vertical divider
const Example323 = defineComponent(() => {
  return () => (
    <div style={{ display: 'flex', alignItems: 'center', height: '100px' }}>
      <div>Left content</div>
      <Divider orientation="vertical" />
      <div>Right content</div>
    </div>
  );
});

// Vertical divider with label
const Example324 = defineComponent(() => {
  return () => (
    <div style={{ display: 'flex', height: '200px' }}>
      <div style={{ flex: 1, padding: '16px' }}>
        <h3>Section A</h3>
        <p>Content A</p>
      </div>
      <Divider orientation="vertical" label="vs" />
      <div style={{ flex: 1, padding: '16px' }}>
        <h3>Section B</h3>
        <p>Content B</p>
      </div>
    </div>
  );
});

// Vertical divider in toolbar
const Example325 = defineComponent(() => {
  return () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px' }}>
      <button>Bold</button>
      <button>Italic</button>
      <button>Underline</button>
      <Divider orientation="vertical" style={{ height: '24px' }} />
      <button>Link</button>
      <button>Image</button>
    </div>
  );
});
```

#### Form Sections

```typescript
// Dividing form sections
const Example326 = defineComponent(() => {
  return () => (
    <form>
      <VStack spacing={20}>
        <VStack spacing={12}>
          <h3>Personal Information</h3>
          <input type="text" placeholder="Name" />
          <input type="email" placeholder="Email" />
        </VStack>

        <Divider label="Contact Details" labelPosition="start" />

        <VStack spacing={12}>
          <input type="tel" placeholder="Phone" />
          <input type="text" placeholder="Address" />
        </VStack>

        <Divider label="Account Settings" labelPosition="start" />

        <VStack spacing={12}>
          <input type="password" placeholder="Password" />
          <input type="password" placeholder="Confirm Password" />
        </VStack>
      </VStack>
    </form>
  );
});
```

#### Authentication UI

```typescript
// Login with social divider
const Example327 = defineComponent(() => {
  return () => (
    <Card width={400} p={32}>
      <VStack spacing={24}>
        <h2 style={{ textAlign: 'center' }}>Sign In</h2>

        <VStack spacing={16}>
          <button class="social-btn">
            <Icon name="google" /> Continue with Google
          </button>
          <button class="social-btn">
            <Icon name="github" /> Continue with GitHub
          </button>
        </VStack>

        <Divider label="OR" />

        <VStack spacing={16}>
          <input type="email" placeholder="Email" class="form-input" />
          <input type="password" placeholder="Password" class="form-input" />
          <button class="btn-primary" style={{ width: '100%' }}>Sign In</button>
        </VStack>
      </VStack>
    </Card>
  );
});
```

#### Pricing Tables

```typescript
// Dividing pricing tiers
const Example328 = defineComponent(() => {
  return () => (
    <div>
      <VStack spacing={32}>
        <PricingCard title="Basic" price="$9/mo" features={['Feature 1', 'Feature 2']} />

        <Divider
          label="MOST POPULAR"
          thickness={2}
          color="#10b981"
          style={{
            color: '#10b981',
            fontWeight: 'bold',
            fontSize: '12px',
            letterSpacing: '0.05em'
          }}
        />

        <PricingCard title="Pro" price="$29/mo" features={['All Basic', 'Feature 3', 'Feature 4']} />

        <Divider variant="dashed" />

        <PricingCard title="Enterprise" price="Custom" features={['All Pro', 'Feature 5', 'Support']} />
      </VStack>
    </div>
  );
});
```

#### Label Spacing

```typescript
// Custom label spacing
const Example329 = defineComponent(() => {
  return () => (
    <div>
      <p>Content</p>
      <Divider label="Wide spacing" labelSpacing={32} />
      <p>Content</p>
      <Divider label="Narrow spacing" labelSpacing={8} />
      <p>Content</p>
    </div>
  );
});
```

#### Styling Examples

```css
/* Divider in cards */
.card-divider {
  margin: 24px 0;
}

/* Section divider with emphasis */
.section-divider {
  margin: 48px 0;
}

/* Subtle divider for lists */
.list-divider {
  margin: 8px 0;
  opacity: 0.6;
}

/* Bold section header divider */
.header-divider {
  margin: 16px 0 32px;
  border-top-width: 3px;
  border-top-color: var(--color-primary);
}

/* Decorative divider */
.decorative-divider {
  background: linear-gradient(to right, transparent, #cbd5e0, transparent);
  height: 1px;
  border: none;
}
```

```typescript
// Using styled dividers
const Example330 = defineComponent(() => {
  return () => (
    <article>
      <h1>Article Title</h1>
      <Divider class="header-divider" thickness={3} color="#3b82f6" />

      <section>
        <h2>Introduction</h2>
        <p>Content...</p>
      </section>

      <Divider class="section-divider" label="Main Content" />

      <section>
        <h2>Details</h2>
        <p>More content...</p>
      </section>
    </article>
  );
});
```

#### API Reference

**`<Divider>`** - Visual separator with label support

Props:
- `orientation?: 'horizontal' | 'vertical'` - Divider orientation (default: 'horizontal')
- `label?: string` - Text label to display within the divider
- `children?: any` - Alternative to label prop for complex label content
- `labelPosition?: 'start' | 'center' | 'end'` - Position of label along divider (default: 'center')
- `variant?: 'solid' | 'dashed' | 'dotted'` - Border style (default: 'solid')
- `thickness?: number` - Border thickness in pixels (default: 1)
- `color?: string` - Border color (CSS color value)
- `labelSpacing?: number` - Spacing around label in pixels (default: 16)
- `decorative?: boolean` - Whether divider is purely decorative with no semantic meaning (default: false)
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with divider styles)
- All other props are forwarded to the underlying element

#### Accessibility Notes

- Divider uses `<hr>` element for semantic meaning when no label is present
- With label, uses `<div>` container with appropriate ARIA attributes
- `role="separator"` by default, `role="presentation"` when decorative
- `aria-orientation` attribute indicates horizontal or vertical orientation
- `aria-label` attribute set when label is a string for screen readers
- Set `decorative={true}` for purely visual dividers with no semantic meaning
- Screen readers announce dividers as content separators
- Label text is announced by screen readers when present
- Consider adding descriptive labels for clarity in long documents

#### Best Practices

1. **Choose appropriate variant**: Use solid for strong separation, dashed/dotted for lighter division
2. **Label positioning**: Use 'start' for section headers, 'center' for balanced separation, 'end' for section endings
3. **Color contrast**: Ensure divider color has sufficient contrast against background (WCAG AA: 3:1 minimum)
4. **Thickness**: Keep thickness between 1-3px for most cases; thicker dividers (4-6px) for major sections only
5. **Spacing**: Use consistent label spacing across your application (default 16px works well)
6. **Vertical dividers**: Ensure parent container has display: flex and appropriate height
7. **Forms**: Use labeled dividers to separate form sections for better scannability
8. **Authentication**: "OR" dividers between social login and email login are conventional
9. **Decorative mode**: Set `decorative={true}` for purely visual dividers that don't convey meaning
10. **Performance**: Divider has minimal overhead; complex labels may increase render time slightly
11. **Semantic HTML**: Divider respects semantic separation - don't overuse for pure decoration
12. **Mobile**: Consider reducing thickness and spacing on mobile for better space efficiency

---

### Separator

A simple, semantic separator component for visually or semantically dividing content. Based on the WAI-ARIA Separator pattern.

#### Features

- Horizontal and vertical orientation support
- Decorative mode (default) for purely visual separation
- Semantic mode for meaningful content separation
- Based on WAI-ARIA Separator pattern
- Minimal API surface (simpler than Divider)
- Proper ARIA attributes for accessibility
- Unstyled by default (bring your own styles)
- Zero JavaScript overhead
- Lightweight alternative to Divider

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Separator } from 'aether/primitives';

// Basic horizontal separator
const Example331 = defineComponent(() => {
  return () => (
    <div>
      <p>Content above</p>
      <Separator />
      <p>Content below</p>
    </div>
  );
});

// With custom styling
const Example332 = defineComponent(() => {
  return () => (
    <div>
      <p>Section 1</p>
      <Separator style={{
        height: '1px',
        background: '#e5e7eb',
        margin: '16px 0'
      }} />
      <p>Section 2</p>
    </div>
  );
});

// With CSS class
const Example333 = defineComponent(() => {
  return () => (
    <div>
      <h2>Title</h2>
      <Separator class="my-separator" />
      <p>Content</p>
    </div>
  );
});
```

#### Vertical Separator

```typescript
// Basic vertical separator
const Example334 = defineComponent(() => {
  return () => (
    <div style={{ display: 'flex', alignItems: 'center', height: '40px' }}>
      <span>Left</span>
      <Separator
        orientation="vertical"
        style={{ width: '1px', background: '#d1d5db', margin: '0 16px' }}
      />
      <span>Right</span>
    </div>
  );
});

// Vertical separator in navigation
const Example335 = defineComponent(() => {
  return () => (
    <nav style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <a href="/">Home</a>
      <Separator
        orientation="vertical"
        style={{ width: '1px', height: '20px', background: '#9ca3af' }}
      />
      <a href="/about">About</a>
      <Separator
        orientation="vertical"
        style={{ width: '1px', height: '20px', background: '#9ca3af' }}
      />
      <a href="/contact">Contact</a>
    </nav>
  );
});
```

#### Decorative vs Semantic

```typescript
// Decorative separator (default) - purely visual, no semantic meaning
const Example336 = defineComponent(() => {
  return () => (
    <div>
      <p>Paragraph 1</p>
      <Separator decorative={true} style={{ height: '1px', background: '#e5e7eb', margin: '12px 0' }} />
      <p>Paragraph 2</p>
    </div>
  );
});

// Semantic separator - meaningful content division
const Example337 = defineComponent(() => {
  return () => (
    <article>
      <section>
        <h2>Introduction</h2>
        <p>Introduction content...</p>
      </section>

      <Separator
        decorative={false}
        style={{ height: '2px', background: '#cbd5e0', margin: '32px 0' }}
      />

      <section>
        <h2>Main Content</h2>
        <p>Main content...</p>
      </section>
    </article>
  );
});
```

#### List Separators

```typescript
// Separator in lists
const Example338 = defineComponent(() => {
  const items = signal(['Apple', 'Banana', 'Cherry', 'Date']);

  return () => (
    <div>
      {items().map((item, index) => (
        <>
          <div key={item} style={{ padding: '12px 0' }}>
            {item}
          </div>
          {#if index < items().length - 1}
            <Separator style={{ height: '1px', background: '#f3f4f6' }} />
          {/if}
        </>
      ))}
    </div>
  );
});

// Menu items with separators
const Example339 = defineComponent(() => {
  return () => (
    <div class="menu">
      <button class="menu-item">New File</button>
      <button class="menu-item">Open</button>
      <button class="menu-item">Save</button>

      <Separator style={{ height: '1px', background: '#e5e7eb', margin: '4px 0' }} />

      <button class="menu-item">Settings</button>
      <button class="menu-item">Help</button>
    </div>
  );
});
```

#### Styled Separators

```css
/* Basic separator */
.separator {
  height: 1px;
  background: #e5e7eb;
  margin: 16px 0;
}

/* Vertical separator */
.separator-vertical {
  width: 1px;
  background: #d1d5db;
  margin: 0 12px;
  align-self: stretch;
}

/* Bold separator */
.separator-bold {
  height: 2px;
  background: #1e293b;
  margin: 24px 0;
}

/* Gradient separator */
.separator-gradient {
  height: 1px;
  background: linear-gradient(to right, transparent, #cbd5e0, transparent);
  margin: 20px 0;
}

/* Dashed separator */
.separator-dashed {
  height: 0;
  border: none;
  border-top: 1px dashed #9ca3af;
  margin: 16px 0;
}

/* Section separator */
.separator-section {
  height: 3px;
  background: linear-gradient(to right, #3b82f6, #8b5cf6);
  margin: 40px 0;
  border-radius: 2px;
}
```

```typescript
// Using styled separators
const Example340 = defineComponent(() => {
  return () => (
    <div>
      <section>
        <h2>Section 1</h2>
        <p>Content 1</p>
      </section>

      <Separator class="separator-gradient" />

      <section>
        <h2>Section 2</h2>
        <p>Content 2</p>
      </section>

      <Separator class="separator-section" decorative={false} />

      <section>
        <h2>Section 3</h2>
        <p>Content 3</p>
      </section>
    </div>
  );
});
```

#### Card Separators

```typescript
// Separator in card
const Example341 = defineComponent(() => {
  return () => (
    <Card width={400}>
      <Box p={16}>
        <h3>Card Header</h3>
        <p>Header content</p>
      </Box>

      <Separator style={{ height: '1px', background: '#e5e7eb' }} />

      <Box p={16}>
        <p>Card body content</p>
      </Box>

      <Separator style={{ height: '1px', background: '#e5e7eb' }} />

      <Box p={16}>
        <button>Action</button>
      </Box>
    </Card>
  );
});
```

#### Toolbar Separators

```typescript
// Separators in toolbar
const Example342 = defineComponent(() => {
  return () => (
    <div class="toolbar" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px',
      background: '#f3f4f6',
      borderRadius: '4px'
    }}>
      <button class="icon-btn">
        <Icon name="bold" />
      </button>
      <button class="icon-btn">
        <Icon name="italic" />
      </button>

      <Separator
        orientation="vertical"
        style={{ width: '1px', height: '24px', background: '#cbd5e0' }}
      />

      <button class="icon-btn">
        <Icon name="align-left" />
      </button>
      <button class="icon-btn">
        <Icon name="align-center" />
      </button>

      <Separator
        orientation="vertical"
        style={{ width: '1px', height: '24px', background: '#cbd5e0' }}
      />

      <button class="icon-btn">
        <Icon name="link" />
      </button>
    </div>
  );
});
```

#### API Reference

**`<Separator>`** - Simple semantic separator

Props:
- `orientation?: 'horizontal' | 'vertical'` - Separator orientation (default: 'horizontal')
- `decorative?: boolean` - Whether separator is purely decorative with no semantic meaning (default: true)
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles
- `data-orientation?: string` - Data attribute reflecting orientation (automatically set)
- All other props are forwarded to the underlying div element

#### Accessibility Notes

- Based on WAI-ARIA Separator pattern: https://www.w3.org/WAI/ARIA/apg/patterns/separator/
- When `decorative={true}` (default): Uses `role="none"`, hidden from screen readers
- When `decorative={false}`: Uses `role="separator"` with `aria-orientation` attribute
- Decorative separators are purely visual and don't convey semantic meaning
- Semantic separators indicate a meaningful division in content structure
- Screen readers announce semantic separators as "separator" with orientation
- Use semantic mode (`decorative={false}`) when the separation is meaningful to document structure
- Use decorative mode (default) for visual styling purposes only
- `data-orientation` attribute is always present for CSS styling purposes

#### Best Practices

1. **Default to decorative**: Most separators are purely visual - use default `decorative={true}`
2. **Semantic separation**: Use `decorative={false}` for meaningful content divisions (e.g., major sections)
3. **Styling required**: Separator is unstyled by default - always provide styles via `class` or `style` prop
4. **Orientation clarity**: For vertical separators, ensure parent has appropriate flexbox layout
5. **Consistent styling**: Create reusable CSS classes for consistent separator appearance
6. **Margin/padding**: Include margin in your styles for proper spacing around separators
7. **Height/width**: Horizontal separators need height, vertical separators need width
8. **List items**: Use separators between list items for visual clarity
9. **Toolbars**: Vertical separators group related toolbar buttons
10. **Cards**: Separate card sections with horizontal separators
11. **When to use Divider**: Use Divider component when you need labels or advanced features
12. **Performance**: Separator has zero runtime overhead - pure CSS styling

**Separator vs Divider:**
- **Separator**: Simple, unstyled, minimal API, requires custom styling
- **Divider**: Feature-rich, built-in styling, labels, variants, more opinionated

Choose Separator for maximum control and minimal bundle size. Choose Divider for convenience and built-in features.

---

### SimpleGrid

A responsive equal-width grid layout that automatically adapts to available space, making it easy to create uniform grid layouts without complex CSS.

#### Features

- Equal-width columns in a grid layout
- Fixed column count or responsive auto-fit/auto-fill
- Minimum child width for automatic responsiveness
- Configurable gap spacing (uniform or separate X/Y)
- Auto-fit behavior (collapse empty columns)
- Auto-fill behavior (maintain columns even if empty)
- CSS Grid-based (no JavaScript calculations)
- Responsive without media queries
- Perfect for card grids and product galleries
- Zero runtime overhead

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { SimpleGrid } from 'aether/primitives';

// Fixed 3-column grid
const Example343 = defineComponent(() => {
  return () => (
    <SimpleGrid columns={3} spacing={16}>
      <Card>Card 1</Card>
      <Card>Card 2</Card>
      <Card>Card 3</Card>
      <Card>Card 4</Card>
      <Card>Card 5</Card>
      <Card>Card 6</Card>
    </SimpleGrid>
  );
});

// Fixed 2-column grid
const Example344 = defineComponent(() => {
  return () => (
    <SimpleGrid columns={2} spacing={24}>
      <Box p={16} style={{ background: '#f3f4f6', borderRadius: '8px' }}>
        <h3>Item 1</h3>
        <p>Content</p>
      </Box>
      <Box p={16} style={{ background: '#f3f4f6', borderRadius: '8px' }}>
        <h3>Item 2</h3>
        <p>Content</p>
      </Box>
      <Box p={16} style={{ background: '#f3f4f6', borderRadius: '8px' }}>
        <h3>Item 3</h3>
        <p>Content</p>
      </Box>
      <Box p={16} style={{ background: '#f3f4f6', borderRadius: '8px' }}>
        <h3>Item 4</h3>
        <p>Content</p>
      </Box>
    </SimpleGrid>
  );
});

// Fixed 4-column grid
const Example345 = defineComponent(() => {
  return () => (
    <SimpleGrid columns={4} spacing={12}>
      {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
        <Center
          key={num}
          height={100}
          style={{ background: '#dbeafe', borderRadius: '4px' }}
        >
          {num}
        </Center>
      ))}
    </SimpleGrid>
  );
});
```

#### Responsive with minChildWidth

```typescript
// Responsive grid - automatically adjusts columns based on space
const Example346 = defineComponent(() => {
  return () => (
    <SimpleGrid minChildWidth={200} spacing={20}>
      <Card>
        <h3>Card 1</h3>
        <p>Responsive card</p>
      </Card>
      <Card>
        <h3>Card 2</h3>
        <p>Responsive card</p>
      </Card>
      <Card>
        <h3>Card 3</h3>
        <p>Responsive card</p>
      </Card>
      <Card>
        <h3>Card 4</h3>
        <p>Responsive card</p>
      </Card>
    </SimpleGrid>
  );
});

// Responsive with string values
const Example347 = defineComponent(() => {
  return () => (
    <SimpleGrid minChildWidth="250px" spacing={24}>
      <Box p={20} style={{ background: '#fef3c7', borderRadius: '8px' }}>
        <h4>Responsive Box 1</h4>
      </Box>
      <Box p={20} style={{ background: '#fef3c7', borderRadius: '8px' }}>
        <h4>Responsive Box 2</h4>
      </Box>
      <Box p={20} style={{ background: '#fef3c7', borderRadius: '8px' }}>
        <h4>Responsive Box 3</h4>
      </Box>
    </SimpleGrid>
  );
});
```

#### Auto-fit vs Auto-fill

```typescript
// Auto-fill (default) - maintains column structure even with fewer items
const Example348 = defineComponent(() => {
  return () => (
    <SimpleGrid minChildWidth={200} behavior="fill" spacing={16}>
      <Card>Item 1</Card>
      <Card>Item 2</Card>
      {/* Empty columns are maintained */}
    </SimpleGrid>
  );
});

// Auto-fit - collapses empty columns, items stretch to fill space
const Example349 = defineComponent(() => {
  return () => (
    <SimpleGrid minChildWidth={200} behavior="fit" spacing={16}>
      <Card>Item 1</Card>
      <Card>Item 2</Card>
      {/* Items stretch to fill available space */}
    </SimpleGrid>
  );
});

// Comparison: auto-fill vs auto-fit with 2 items
const Example350 = defineComponent(() => {
  return () => (
    <VStack spacing={32}>
      <div>
        <h3>Auto-fill (maintains grid structure)</h3>
        <SimpleGrid minChildWidth={150} behavior="fill" spacing={12}>
          <Box p={16} style={{ background: '#bfdbfe' }}>Fill 1</Box>
          <Box p={16} style={{ background: '#bfdbfe' }}>Fill 2</Box>
        </SimpleGrid>
      </div>

      <div>
        <h3>Auto-fit (stretches to fill)</h3>
        <SimpleGrid minChildWidth={150} behavior="fit" spacing={12}>
          <Box p={16} style={{ background: '#fca5a5' }}>Fit 1</Box>
          <Box p={16} style={{ background: '#fca5a5' }}>Fit 2</Box>
        </SimpleGrid>
      </div>
    </VStack>
  );
});
```

#### Custom Spacing

```typescript
// Uniform spacing
const Example351 = defineComponent(() => {
  return () => (
    <SimpleGrid columns={3} spacing={32}>
      <Card>Large spacing</Card>
      <Card>Large spacing</Card>
      <Card>Large spacing</Card>
    </SimpleGrid>
  );
});

// Different horizontal and vertical spacing
const Example352 = defineComponent(() => {
  return () => (
    <SimpleGrid columns={3} spacingX={24} spacingY={16}>
      <Card>Custom spacing</Card>
      <Card>Custom spacing</Card>
      <Card>Custom spacing</Card>
      <Card>Custom spacing</Card>
      <Card>Custom spacing</Card>
      <Card>Custom spacing</Card>
    </SimpleGrid>
  );
});

// No spacing (edge-to-edge grid)
const Example353 = defineComponent(() => {
  return () => (
    <SimpleGrid columns={4} spacing={0}>
      <Center height={100} style={{ background: '#ef4444', color: 'white' }}>1</Center>
      <Center height={100} style={{ background: '#f59e0b', color: 'white' }}>2</Center>
      <Center height={100} style={{ background: '#10b981', color: 'white' }}>3</Center>
      <Center height={100} style={{ background: '#3b82f6', color: 'white' }}>4</Center>
    </SimpleGrid>
  );
});

// String spacing values
const Example354 = defineComponent(() => {
  return () => (
    <SimpleGrid columns={2} spacing="2rem">
      <Card>Spacing in rem units</Card>
      <Card>Spacing in rem units</Card>
    </SimpleGrid>
  );
});
```

#### Product Grids

```typescript
// Product gallery
const Example355 = defineComponent(() => {
  const products = signal([
    { id: 1, name: 'Product 1', price: 29.99, image: '/product1.jpg' },
    { id: 2, name: 'Product 2', price: 39.99, image: '/product2.jpg' },
    { id: 3, name: 'Product 3', price: 49.99, image: '/product3.jpg' },
    { id: 4, name: 'Product 4', price: 59.99, image: '/product4.jpg' },
    { id: 5, name: 'Product 5', price: 69.99, image: '/product5.jpg' },
    { id: 6, name: 'Product 6', price: 79.99, image: '/product6.jpg' },
  ]);

  return () => (
    <SimpleGrid minChildWidth={250} spacing={24}>
      {products().map(product => (
        <Card key={product.id} class="product-card">
          <img
            src={product.image}
            alt={product.name}
            style={{ width: '100%', height: '200px', objectFit: 'cover' }}
          />
          <Box p={16}>
            <VStack spacing={8}>
              <h3>{product.name}</h3>
              <Text fontSize={20} fontWeight="bold" color="#3b82f6">
                ${product.price}
              </Text>
              <button class="btn-primary" style={{ width: '100%' }}>
                Add to Cart
              </button>
            </VStack>
          </Box>
        </Card>
      ))}
    </SimpleGrid>
  );
});

// Image gallery
const Example356 = defineComponent(() => {
  const images = signal([
    '/gallery1.jpg', '/gallery2.jpg', '/gallery3.jpg',
    '/gallery4.jpg', '/gallery5.jpg', '/gallery6.jpg',
    '/gallery7.jpg', '/gallery8.jpg', '/gallery9.jpg',
  ]);

  return () => (
    <SimpleGrid minChildWidth={200} spacing={8}>
      {images().map((src, index) => (
        <Box
          key={index}
          style={{
            aspectRatio: '1',
            overflow: 'hidden',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          <img
            src={src}
            alt={`Gallery ${index + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: 'transform 0.2s'
            }}
            onMouseOver={(e) => e.target.style.transform = 'scale(1.05)'}
            onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
          />
        </Box>
      ))}
    </SimpleGrid>
  );
});
```

#### Dashboard Stats

```typescript
// Stats grid
const Example357 = defineComponent(() => {
  const stats = [
    { label: 'Total Revenue', value: '$123,456', change: '+12.3%', trend: 'up' },
    { label: 'Active Users', value: '45,678', change: '+8.1%', trend: 'up' },
    { label: 'Conversion Rate', value: '3.45%', change: '-0.5%', trend: 'down' },
    { label: 'Avg. Order Value', value: '$89.32', change: '+5.2%', trend: 'up' },
  ];

  return () => (
    <SimpleGrid columns={4} spacing={20}>
      {stats.map(stat => (
        <Card key={stat.label} p={20}>
          <VStack spacing={12}>
            <Text fontSize={14} color="gray">{stat.label}</Text>
            <Text fontSize={28} fontWeight="bold">{stat.value}</Text>
            <Text
              fontSize={14}
              color={stat.trend === 'up' ? 'green' : 'red'}
            >
              {stat.change}
            </Text>
          </VStack>
        </Card>
      ))}
    </SimpleGrid>
  );
});
```

#### Feature Grids

```typescript
// Feature showcase
const Example358 = defineComponent(() => {
  const features = [
    { icon: 'zap', title: 'Fast Performance', description: 'Lightning-fast load times' },
    { icon: 'shield', title: 'Secure', description: 'Enterprise-grade security' },
    { icon: 'users', title: 'Collaborative', description: 'Built for teams' },
    { icon: 'globe', title: 'Global', description: 'Available worldwide' },
    { icon: 'smartphone', title: 'Mobile', description: 'Mobile-first design' },
    { icon: 'heart', title: 'Loved', description: 'Trusted by thousands' },
  ];

  return () => (
    <SimpleGrid minChildWidth={280} spacing={32}>
      {features.map(feature => (
        <VStack key={feature.title} spacing={16} align="center">
          <Center
            width={64}
            height={64}
            style={{
              background: '#dbeafe',
              borderRadius: '50%'
            }}
          >
            <Icon name={feature.icon} size={32} color="#3b82f6" />
          </Center>
          <h3 style={{ fontSize: '20px', textAlign: 'center' }}>
            {feature.title}
          </h3>
          <p style={{ textAlign: 'center', color: '#6b7280' }}>
            {feature.description}
          </p>
        </VStack>
      ))}
    </SimpleGrid>
  );
});
```

#### Team Grids

```typescript
// Team member grid
const Example359 = defineComponent(() => {
  const team = [
    { name: 'John Doe', role: 'CEO', avatar: '/john.jpg' },
    { name: 'Jane Smith', role: 'CTO', avatar: '/jane.jpg' },
    { name: 'Bob Johnson', role: 'Designer', avatar: '/bob.jpg' },
    { name: 'Alice Brown', role: 'Developer', avatar: '/alice.jpg' },
  ];

  return () => (
    <SimpleGrid minChildWidth={200} spacing={24}>
      {team.map(member => (
        <VStack key={member.name} spacing={12} align="center">
          <Avatar src={member.avatar} size="xl" />
          <VStack spacing={4} align="center">
            <Text fontSize={18} fontWeight="bold">{member.name}</Text>
            <Text fontSize={14} color="gray">{member.role}</Text>
          </VStack>
          <HStack spacing={8}>
            <button class="icon-btn-sm">
              <Icon name="linkedin" size={16} />
            </button>
            <button class="icon-btn-sm">
              <Icon name="twitter" size={16} />
            </button>
          </HStack>
        </VStack>
      ))}
    </SimpleGrid>
  );
});
```

#### Responsive Patterns

```typescript
// Different column counts for different content
const Example360 = defineComponent(() => {
  return () => (
    <VStack spacing={48}>
      {/* Many small items - more columns */}
      <div>
        <h2>Icon Grid</h2>
        <SimpleGrid minChildWidth={100} spacing={16}>
          {['icon1', 'icon2', 'icon3', 'icon4', 'icon5', 'icon6'].map(icon => (
            <Center
              key={icon}
              height={100}
              style={{ background: '#f3f4f6', borderRadius: '8px' }}
            >
              <Icon name={icon} size={32} />
            </Center>
          ))}
        </SimpleGrid>
      </div>

      {/* Medium content - medium columns */}
      <div>
        <h2>Card Grid</h2>
        <SimpleGrid minChildWidth={250} spacing={24}>
          {[1, 2, 3, 4].map(num => (
            <Card key={num} p={20}>
              <h3>Card {num}</h3>
              <p>Medium-sized content</p>
            </Card>
          ))}
        </SimpleGrid>
      </div>

      {/* Large content - fewer columns */}
      <div>
        <h2>Article Grid</h2>
        <SimpleGrid minChildWidth={400} spacing={32}>
          {[1, 2].map(num => (
            <Box key={num}>
              <img
                src={`/article${num}.jpg`}
                style={{ width: '100%', height: '200px', objectFit: 'cover', borderRadius: '8px' }}
              />
              <h3 style={{ marginTop: '16px' }}>Article {num}</h3>
              <p>Longer article content that needs more space...</p>
            </Box>
          ))}
        </SimpleGrid>
      </div>
    </VStack>
  );
});
```

#### Styling Examples

```css
/* SimpleGrid with cards */
.grid-card {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;
}

.grid-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

/* Responsive adjustments */
@media (max-width: 640px) {
  /* SimpleGrid automatically adjusts, but you can add other styles */
  .grid-card {
    padding: 16px;
  }
}

/* Product grid specific */
.product-grid-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  background: white;
}

.product-grid-item img {
  width: 100%;
  height: 200px;
  object-fit: cover;
}

/* Dashboard stat cards */
.stat-card {
  background: white;
  border-radius: 8px;
  padding: 24px;
  border-left: 4px solid #3b82f6;
}
```

```typescript
// Using styled grids
const Example361 = defineComponent(() => {
  return () => (
    <SimpleGrid minChildWidth={250} spacing={20}>
      <div class="grid-card">
        <h3>Styled Card 1</h3>
        <p>Hover for effect</p>
      </div>
      <div class="grid-card">
        <h3>Styled Card 2</h3>
        <p>Hover for effect</p>
      </div>
      <div class="grid-card">
        <h3>Styled Card 3</h3>
        <p>Hover for effect</p>
      </div>
    </SimpleGrid>
  );
});
```

#### API Reference

**`<SimpleGrid>`** - Responsive equal-width grid layout

Props:
- `columns?: number` - Fixed number of columns. Takes precedence over `minChildWidth`
- `minChildWidth?: number | string` - Minimum width for each child (triggers auto-responsive behavior). Numbers convert to pixels
- `spacing?: number | string` - Gap between items (both row and column). Numbers convert to pixels
- `spacingX?: number | string` - Horizontal gap (column gap). Overrides `spacing` if set. Numbers convert to pixels
- `spacingY?: number | string` - Vertical gap (row gap). Overrides `spacing` if set. Numbers convert to pixels
- `behavior?: 'fit' | 'fill'` - Grid behavior (default: 'fill')
  - `fill`: Maintains column structure (auto-fill)
  - `fit`: Collapses empty columns, items stretch to fill space (auto-fit)
- `children?: any` - Child elements (grid items)
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with grid styles)
- All other props are forwarded to the underlying div element

#### Accessibility Notes

- SimpleGrid is purely presentational and doesn't affect accessibility
- Grid items maintain their natural tab order (left to right, top to bottom)
- Use semantic HTML elements for grid items (e.g., `<article>`, `<section>`)
- Ensure interactive grid items (cards, buttons) are keyboard accessible
- Provide sufficient spacing between items for touch targets (minimum 44x44px)
- Consider screen reader experience - grid items should make sense in linear order
- For data grids, consider using `<table>` with ARIA grid role instead

#### Best Practices

1. **Choose the right approach**: Use `columns` for fixed layouts, `minChildWidth` for responsive layouts
2. **Auto-fit vs auto-fill**: Use `fill` (default) for maintaining structure, `fit` for stretching items
3. **Spacing consistency**: Use consistent spacing values across your application
4. **Min width consideration**: Set `minChildWidth` to the minimum comfortable size for your content
5. **Mobile-first**: SimpleGrid is inherently responsive, but test on mobile devices
6. **Content variety**: Works best when grid items have similar heights
7. **Loading states**: Consider skeleton screens for grid items during loading
8. **Empty states**: Handle cases where there are few items (auto-fit vs auto-fill)
9. **Performance**: SimpleGrid uses CSS Grid - no JavaScript recalculation on resize
10. **Image aspect ratio**: Use consistent aspect ratios for images in grids
11. **Card design**: Ensure cards have minimum height or use aspect-ratio for consistency
12. **Breakpoint-free**: SimpleGrid automatically adapts without media queries
13. **Nested grids**: Avoid deeply nested grids - flatten structure when possible
14. **Gap vs padding**: Use grid `spacing` for gaps, item padding for internal spacing

**When to use SimpleGrid:**
- Product galleries with equal-sized items
- Feature showcases with consistent layout
- Team member grids
- Dashboard stat cards
- Image galleries with uniform sizing
- Icon grids
- Card layouts with similar content

**When to use Grid instead:**
- Complex layouts with varying column widths
- Asymmetric layouts
- Precise control over row/column placement
- Layouts requiring explicit grid areas

---

**End of New Layout Primitives**
