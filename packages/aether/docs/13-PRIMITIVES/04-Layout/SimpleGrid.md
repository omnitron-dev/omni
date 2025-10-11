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
