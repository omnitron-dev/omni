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

