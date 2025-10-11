### Grid

A layout container that provides CSS Grid functionality with convenient props.

#### Features

- CSS Grid layout with shorthand props
- Template columns, rows, and areas support
- Auto-flow control (row, column, dense)
- Auto-columns and auto-rows for implicit grids
- Gap/spacing support with row and column gaps
- Flexible alignment (justify/align items and content)
- Inline grid option
- GridItem sub-component for precise placement
- Responsive grid templates
- Named grid areas support

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Grid } from 'aether/primitives';

// Basic 3-column grid
const Example248 = defineComponent(() => {
  return () => (
    <Grid templateColumns="repeat(3, 1fr)" gap={16}>
      <div>Item 1</div>
      <div>Item 2</div>
      <div>Item 3</div>
      <div>Item 4</div>
      <div>Item 5</div>
      <div>Item 6</div>
    </Grid>
  );
});
```

#### Responsive Grid Examples

```typescript
// Responsive grid with auto-fit
const Example249 = defineComponent(() => {
  return () => (
    <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="1rem">
      <div class="card">Card 1</div>
      <div class="card">Card 2</div>
      <div class="card">Card 3</div>
      <div class="card">Card 4</div>
    </Grid>
  );
});

// Grid with auto-flow
const Example250 = defineComponent(() => {
  return () => (
    <Grid
      templateColumns="repeat(3, 1fr)"
      autoFlow="dense"
      gap={16}
    >
      <div style={{ gridColumn: 'span 2' }}>Wide item</div>
      <div>Item</div>
      <div>Item</div>
      <div style={{ gridColumn: 'span 2' }}>Another wide item</div>
    </Grid>
  );
});
```

#### Named Grid Areas

```typescript
// Dashboard layout with named areas
const Example251 = defineComponent(() => {
  return () => (
    <Grid
      templateAreas={`
        "header header header"
        "sidebar main main"
        "sidebar footer footer"
      `}
      templateColumns="200px 1fr 1fr"
      templateRows="auto 1fr auto"
      gap={16}
      style={{ minHeight: '100vh' }}
    >
      <div style={{ gridArea: 'header' }} class="header">
        Header
      </div>
      <div style={{ gridArea: 'sidebar' }} class="sidebar">
        Sidebar
      </div>
      <div style={{ gridArea: 'main' }} class="main">
        Main Content
      </div>
      <div style={{ gridArea: 'footer' }} class="footer">
        Footer
      </div>
    </Grid>
  );
});
```

#### GridItem Usage

```typescript
import { defineComponent } from 'aether';
import { Grid, GridItem } from 'aether/primitives';

// Precise grid placement with GridItem
const Example252 = defineComponent(() => {
  return () => (
    <Grid templateColumns="repeat(4, 1fr)" templateRows="repeat(3, 100px)" gap={16}>
      <GridItem column="1 / 3" row="1 / 2">
        Spans 2 columns, 1 row
      </GridItem>
      <GridItem column="3 / 5" row="1 / 3">
        Spans 2 columns, 2 rows
      </GridItem>
      <GridItem column="1 / 2" row="2 / 4">
        Spans 1 column, 2 rows
      </GridItem>
      <GridItem column="span 2" row="3">
        Spans 2 columns using span notation
      </GridItem>
    </Grid>
  );
});

// GridItem with named area
const Example253 = defineComponent(() => {
  return () => (
    <Grid
      templateAreas={`
        "header header"
        "sidebar main"
        "footer footer"
      `}
      templateColumns="200px 1fr"
      gap={16}
    >
      <GridItem area="header">Header</GridItem>
      <GridItem area="sidebar">Sidebar</GridItem>
      <GridItem area="main">Main</GridItem>
      <GridItem area="footer">Footer</GridItem>
    </Grid>
  );
});
```

#### Advanced Usage

```typescript
// Complex grid with alignment
const Example254 = defineComponent(() => {
  return () => (
    <Grid
      templateColumns="repeat(auto-fill, minmax(150px, 1fr))"
      autoRows="100px"
      gap={20}
      justifyItems="center"
      alignItems="center"
      justifyContent="space-evenly"
    >
      <div>Centered item 1</div>
      <div>Centered item 2</div>
      <div>Centered item 3</div>
      <div>Centered item 4</div>
    </Grid>
  );
});

// Magazine-style layout
const Example255 = defineComponent(() => {
  return () => (
    <Grid
      templateColumns="repeat(6, 1fr)"
      templateRows="repeat(4, 150px)"
      gap={12}
    >
      <GridItem column="1 / 4" row="1 / 3">
        <article class="featured-article">Featured Article</article>
      </GridItem>
      <GridItem column="4 / 7" row="1 / 2">
        <article class="secondary-article">Secondary</article>
      </GridItem>
      <GridItem column="4 / 7" row="2 / 3">
        <article class="secondary-article">Secondary</article>
      </GridItem>
      <GridItem column="1 / 3" row="3 / 5">
        <article class="small-article">Small</article>
      </GridItem>
      <GridItem column="3 / 5" row="3 / 5">
        <article class="small-article">Small</article>
      </GridItem>
      <GridItem column="5 / 7" row="3 / 5">
        <article class="small-article">Small</article>
      </GridItem>
    </Grid>
  );
});
```

#### Styling Example

```css
/* Grid container */
.grid-container {
  background: var(--color-background-secondary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-4);
}

/* Grid items */
.grid-item {
  background: var(--color-background-primary);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  box-shadow: var(--shadow-sm);
}

/* Responsive grid */
@media (max-width: 768px) {
  .responsive-grid {
    grid-template-columns: 1fr !important;
    grid-template-areas:
      "header"
      "main"
      "sidebar"
      "footer" !important;
  }
}

/* Grid gap responsive */
@media (max-width: 640px) {
  .grid-container {
    gap: 8px;
  }
}
```

#### API Reference

**`<Grid>`** - Grid container component

Props:
- `as?: string` - Element to render as (default: 'div')
- `templateColumns?: string` - Grid template columns (e.g., "1fr 2fr", "repeat(3, 1fr)")
- `templateRows?: string` - Grid template rows
- `templateAreas?: string` - Grid template areas (multiline string with area names)
- `autoFlow?: 'row' | 'column' | 'dense' | 'row dense' | 'column dense'` - Grid auto-flow behavior
- `autoColumns?: string` - Grid auto-columns size for implicit columns
- `autoRows?: string` - Grid auto-rows size for implicit rows
- `gap?: number | string` - Gap between items (number converts to pixels)
- `rowGap?: number | string` - Gap between rows (number converts to pixels)
- `columnGap?: number | string` - Gap between columns (number converts to pixels)
- `justifyItems?: 'start' | 'end' | 'center' | 'stretch'` - Horizontal alignment within grid cell
- `alignItems?: 'start' | 'end' | 'center' | 'stretch' | 'baseline'` - Vertical alignment within grid cell
- `justifyContent?: 'start' | 'end' | 'center' | 'stretch' | 'space-around' | 'space-between' | 'space-evenly'` - Grid track alignment horizontal
- `alignContent?: 'start' | 'end' | 'center' | 'stretch' | 'space-around' | 'space-between' | 'space-evenly'` - Grid track alignment vertical
- `inline?: boolean` - Use inline-grid display (default: false)
- `children?: any` - Child elements
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with grid styles)

**`<GridItem>`** - Grid item component for precise placement

Props:
- `as?: string` - Element to render as (default: 'div')
- `column?: string` - Grid column start/end (e.g., "1 / 3", "span 2")
- `columnStart?: number | string` - Grid column start line
- `columnEnd?: number | string` - Grid column end line
- `row?: string` - Grid row start/end (e.g., "1 / 3", "span 2")
- `rowStart?: number | string` - Grid row start line
- `rowEnd?: number | string` - Grid row end line
- `area?: string` - Grid area name (must match parent's templateAreas)
- `children?: any` - Child elements
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with grid item styles)

#### Accessibility Notes

- Use semantic HTML elements with the `as` prop when appropriate (e.g., `as="main"`, `as="aside"`)
- Grid source order should match visual order for screen readers when possible
- Use proper heading hierarchy within grid layouts
- Consider providing skip links for complex grid layouts
- Grid areas should have semantic meaning
- Test with keyboard navigation to ensure logical tab order

#### Best Practices

1. **Use Grid for 2D layouts**: Grid excels at two-dimensional layouts (rows AND columns)
2. **Combine auto-fit/auto-fill with minmax**: Creates responsive grids without media queries
3. **Named areas for clarity**: Use grid areas for complex layouts to improve readability
4. **GridItem for precise control**: Use GridItem component when you need explicit placement
5. **Performance**: Grid is highly optimized by browsers and has minimal overhead
6. **Mobile-first**: Design for mobile grid first, then enhance for larger screens
7. **Gap over margin**: Use gap property instead of margins for consistent spacing

---

