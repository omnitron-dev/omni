### Space

A layout component that adds consistent spacing between child elements using CSS gap. Space handles both horizontal and vertical spacing with size variants and flexible layout options.

#### Features

- Fixed spacing between inline/block elements
- Horizontal and vertical direction modes
- Size variants: xs (4px), sm (8px), md (16px), lg (24px), xl (32px)
- Custom numeric spacing values
- Alignment control (start, center, end, baseline)
- Wrapping support for responsive layouts
- Split mode for space-between distribution
- Built on flexbox with gap property

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Space } from 'aether/primitives';

// Default horizontal spacing (md = 16px)
const Example295 = defineComponent(() => {
  return () => (
    <Space>
      <button>Button 1</button>
      <button>Button 2</button>
      <button>Button 3</button>
    </Space>
  );
});

// Vertical spacing
const Example296 = defineComponent(() => {
  return () => (
    <Space direction="vertical">
      <div>Item 1</div>
      <div>Item 2</div>
      <div>Item 3</div>
    </Space>
  );
});

// Custom spacing size
const Example297 = defineComponent(() => {
  return () => (
    <Space size="lg">
      <span>Spaced</span>
      <span>with</span>
      <span>large</span>
      <span>gaps</span>
    </Space>
  );
});
```

#### Size Variants

```typescript
// All size variants
const Example298 = defineComponent(() => {
  return () => (
    <>
      <Space size="xs">
        <button>XS</button>
        <button>4px gap</button>
      </Space>

      <Space size="sm">
        <button>SM</button>
        <button>8px gap</button>
      </Space>

      <Space size="md">
        <button>MD</button>
        <button>16px gap</button>
      </Space>

      <Space size="lg">
        <button>LG</button>
        <button>24px gap</button>
      </Space>

      <Space size="xl">
        <button>XL</button>
        <button>32px gap</button>
      </Space>
    </>
  );
});

// Custom numeric spacing
const Example299 = defineComponent(() => {
  return () => (
    <Space spacing={20}>
      <button>Custom</button>
      <button>20px gap</button>
    </Space>
  );
});
```

#### Alignment Control

```typescript
// Align items vertically
const Example300 = defineComponent(() => {
  return () => (
    <Space align="center" size="md">
      <div style={{ height: '40px', background: '#3b82f6' }}>Tall item</div>
      <div style={{ height: '20px', background: '#10b981' }}>Short item</div>
      <div style={{ height: '30px', background: '#f59e0b' }}>Medium item</div>
    </Space>
  );
});

// Align to start (default)
const Example301 = defineComponent(() => {
  return () => (
    <Space align="start" size="md">
      <button style={{ height: '40px' }}>Tall Button</button>
      <button style={{ height: '30px' }}>Medium</button>
      <button style={{ height: '20px' }}>Small</button>
    </Space>
  );
});

// Align to end
const Example302 = defineComponent(() => {
  return () => (
    <Space align="end" size="md">
      <span style={{ fontSize: '24px' }}>Large</span>
      <span style={{ fontSize: '16px' }}>Medium</span>
      <span style={{ fontSize: '12px' }}>Small</span>
    </Space>
  );
});

// Baseline alignment for text
const Example303 = defineComponent(() => {
  return () => (
    <Space align="baseline" size="md">
      <span style={{ fontSize: '32px' }}>Aa</span>
      <span style={{ fontSize: '16px' }}>Baseline</span>
      <span style={{ fontSize: '12px' }}>aligned</span>
    </Space>
  );
});
```

#### Wrapping Support

```typescript
// Wrapping space for responsive layouts
const Example304 = defineComponent(() => {
  return () => (
    <Space wrap size="sm" style={{ maxWidth: '400px' }}>
      <span class="tag">React</span>
      <span class="tag">TypeScript</span>
      <span class="tag">Node.js</span>
      <span class="tag">GraphQL</span>
      <span class="tag">PostgreSQL</span>
      <span class="tag">Docker</span>
      <span class="tag">AWS</span>
      <span class="tag">Redis</span>
    </Space>
  );
});

// Tag list with wrapping
const Example305 = defineComponent(() => {
  const tags = ['JavaScript', 'CSS', 'HTML', 'React', 'Vue', 'Angular', 'Svelte'];

  return () => (
    <Space wrap size="md" style={{ maxWidth: '500px' }}>
      {tags.map(tag => (
        <span class="tag" key={tag}>
          {tag}
        </span>
      ))}
    </Space>
  );
});
```

#### Split Mode (Space-Between)

```typescript
// Split items evenly with space-between
const Example306 = defineComponent(() => {
  return () => (
    <Space split size="md">
      <div>Start</div>
      <div>Middle</div>
      <div>End</div>
    </Space>
  );
});

// Navigation with split layout
const Example307 = defineComponent(() => {
  return () => (
    <Space split align="center" style={{ padding: '16px', background: '#f3f4f6' }}>
      <div class="logo">
        <strong>MyApp</strong>
      </div>
      <nav>
        <Space size="md">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </Space>
      </nav>
      <div>
        <button class="btn-primary">Login</button>
      </div>
    </Space>
  );
});

// Card footer with split buttons
const Example308 = defineComponent(() => {
  return () => (
    <div class="card">
      <div class="card-body">
        <h3>Card Title</h3>
        <p>Card content goes here</p>
      </div>
      <div class="card-footer">
        <Space split size="md" style={{ width: '100%' }}>
          <button class="btn-secondary">Cancel</button>
          <button class="btn-primary">Confirm</button>
        </Space>
      </div>
    </div>
  );
});
```

#### Button Groups

```typescript
// Horizontal button group
const Example309 = defineComponent(() => {
  return () => (
    <Space size="sm">
      <button class="btn-primary">Save</button>
      <button class="btn-secondary">Cancel</button>
      <button class="btn-tertiary">Delete</button>
    </Space>
  );
});

// Toolbar with multiple button groups
const Example310 = defineComponent(() => {
  return () => (
    <Space size="lg" align="center">
      <Space size="xs">
        <button class="toolbar-btn" title="Bold">B</button>
        <button class="toolbar-btn" title="Italic">I</button>
        <button class="toolbar-btn" title="Underline">U</button>
      </Space>
      <Space size="xs">
        <button class="toolbar-btn" title="Align Left">←</button>
        <button class="toolbar-btn" title="Align Center">↔</button>
        <button class="toolbar-btn" title="Align Right">→</button>
      </Space>
      <Space size="xs">
        <button class="toolbar-btn" title="Link">🔗</button>
        <button class="toolbar-btn" title="Image">🖼</button>
      </Space>
    </Space>
  );
});

// Vertical button stack
const Example311 = defineComponent(() => {
  return () => (
    <Space direction="vertical" size="sm">
      <button class="btn-block">Primary Action</button>
      <button class="btn-block btn-secondary">Secondary Action</button>
      <button class="btn-block btn-tertiary">Tertiary Action</button>
    </Space>
  );
});
```

#### Form Layouts

```typescript
// Form actions with space
const Example312 = defineComponent(() => {
  return () => (
    <form>
      <Space direction="vertical" size="lg">
        <div class="form-field">
          <label for="name">Name</label>
          <input id="name" type="text" />
        </div>
        <div class="form-field">
          <label for="email">Email</label>
          <input id="email" type="email" />
        </div>
        <Space size="md" align="center">
          <button type="submit" class="btn-primary">Submit</button>
          <button type="reset" class="btn-secondary">Reset</button>
        </Space>
      </Space>
    </form>
  );
});

// Inline form fields
const Example313 = defineComponent(() => {
  return () => (
    <Space size="md" align="end" wrap>
      <div class="form-field">
        <label for="search">Search</label>
        <input id="search" type="text" placeholder="Enter search term" />
      </div>
      <div class="form-field">
        <label for="category">Category</label>
        <select id="category">
          <option>All</option>
          <option>Products</option>
          <option>Services</option>
        </select>
      </div>
      <button class="btn-primary">Search</button>
    </Space>
  );
});
```

#### Styling Example

```css
/* Space doesn't need much styling - it uses gap */
/* Style the children instead */

/* Tags inside Space */
.tag {
  display: inline-block;
  padding: 4px 12px;
  background: var(--color-primary-light);
  color: var(--color-primary);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
}

/* Toolbar buttons */
.toolbar-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border);
  background: var(--color-background-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: var(--color-background-hover);
  border-color: var(--color-primary);
}

.toolbar-btn:active {
  background: var(--color-primary-light);
}

/* Full-width buttons */
.btn-block {
  width: 100%;
  padding: 12px;
  text-align: center;
}

/* Card footer */
.card-footer {
  padding: 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-background-secondary);
}

/* Inline form fields */
.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
}
```

#### API Reference

**`<Space>`** - Fixed spacing between elements

Props:
- `direction?: 'horizontal' | 'vertical'` - Spacing direction (default: 'horizontal')
- `size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'` - Spacing size using predefined values (default: 'md')
  - xs: 4px
  - sm: 8px
  - md: 16px
  - lg: 24px
  - xl: 32px
- `spacing?: number` - Custom spacing value in pixels (overrides size)
- `align?: 'start' | 'center' | 'end' | 'baseline'` - Cross-axis alignment
- `wrap?: boolean` - Allow items to wrap to next line (default: false)
- `split?: boolean` - Distribute items evenly with space-between (default: false)
- `children?: any` - Child elements to space
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles

#### Accessibility Notes

- Space is purely presentational and doesn't affect accessibility
- Ensure child elements maintain proper semantic meaning
- When using Space for navigation, wrap links in a semantic `<nav>` element
- Button groups should have proper ARIA labels for screen readers
- Maintain keyboard navigation order with horizontal layouts
- Consider mobile touch targets (minimum 44x44px) for interactive children

#### Best Practices

1. **Use Space for fixed gaps**: Space is perfect for consistent spacing between elements
2. **Direction matters**: Use horizontal for inline elements, vertical for stacked layouts
3. **Choose appropriate sizes**: xs/sm for tight layouts, md for general use, lg/xl for breathing room
4. **Wrapping for responsiveness**: Enable wrap for tag lists or elements that should flow
5. **Split for distribution**: Use split mode for space-between layouts (navbar, card footers)
6. **Don't nest unnecessarily**: Space can handle multiple children - avoid nested Space components
7. **Combine with other layouts**: Use Space inside Flex, Grid, or Container for complex layouts
8. **Custom spacing**: Use the spacing prop for pixel-perfect control when size variants aren't enough
9. **Alignment control**: Use align prop to control cross-axis alignment of varied-height items
10. **Performance**: Space is lightweight - uses CSS gap, no extra DOM elements

#### Space vs Spacer

**Key Difference**: Space adds gaps BETWEEN multiple children, Spacer creates flexible space in flex layouts.

```typescript
// Space - adds gaps between children
<Space size="md">
  <button>A</button>
  <button>B</button>
  <button>C</button>
</Space>
// Result: A [16px] B [16px] C

// Spacer - pushes items apart with flexible space
<Flex>
  <button>A</button>
  <Spacer />
  <button>B</button>
</Flex>
// Result: A [flexible space fills] B
```

Use Space when: You need consistent fixed spacing between all children
Use Spacer when: You need flexible space that grows to push items apart

---

