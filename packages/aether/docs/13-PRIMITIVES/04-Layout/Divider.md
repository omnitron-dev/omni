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

