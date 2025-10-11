### Container

A responsive content width container that centers content and constrains maximum width for better readability and layout consistency.

#### Features

- Responsive max-width constraints based on size variants
- Automatic content centering with margins
- Configurable horizontal and vertical padding
- Size variants: xs, sm, md, lg, xl, 2xl, full
- Fluid mode for full-width layouts
- Pixel or string-based padding values
- Centered content by default
- Perfect for page layouts and content sections

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Container } from 'aether/primitives';

// Default container (lg size, centered)
const Example280 = defineComponent(() => {
  return () => (
    <Container>
      <h1>Page Title</h1>
      <p>This content is centered and has a max-width of 1024px (lg)</p>
    </Container>
  );
});

// Small container for focused content
const Example281 = defineComponent(() => {
  return () => (
    <Container size="sm">
      <article>
        <h2>Blog Post Title</h2>
        <p>Narrow column for better readability (max-width: 640px)</p>
      </article>
    </Container>
  );
});

// Extra large container for wide layouts
const Example282 = defineComponent(() => {
  return () => (
    <Container size="2xl">
      <h1>Dashboard</h1>
      <p>Wide container for dashboard layouts (max-width: 1536px)</p>
    </Container>
  );
});
```

#### Size Variants

```typescript
// All size variants
const Example283 = defineComponent(() => {
  return () => (
    <>
      <Container size="xs">
        XS Container (480px) - Very narrow
      </Container>

      <Container size="sm">
        SM Container (640px) - Blog posts, articles
      </Container>

      <Container size="md">
        MD Container (768px) - Forms, narrow content
      </Container>

      <Container size="lg">
        LG Container (1024px) - Default, general content
      </Container>

      <Container size="xl">
        XL Container (1280px) - Wide content areas
      </Container>

      <Container size="2xl">
        2XL Container (1536px) - Dashboards, data tables
      </Container>

      <Container size="full">
        Full Container (100%) - Full width, respects padding
      </Container>
    </>
  );
});
```

#### Padding Control

```typescript
// Container with custom padding
const Example284 = defineComponent(() => {
  return () => (
    <Container size="lg" px={32} py={48}>
      <h1>Custom Padded Container</h1>
      <p>32px horizontal padding, 48px vertical padding</p>
    </Container>
  );
});

// Container with string-based padding
const Example285 = defineComponent(() => {
  return () => (
    <Container size="md" px="2rem" py="4rem">
      <h2>String Padding</h2>
      <p>Using rem units for responsive padding</p>
    </Container>
  );
});

// Container with no vertical padding (default)
const Example286 = defineComponent(() => {
  return () => (
    <Container size="lg" px={24}>
      <p>Only horizontal padding, no vertical padding</p>
    </Container>
  );
});
```

#### Fluid Container

```typescript
// Fluid container (full width)
const Example287 = defineComponent(() => {
  return () => (
    <Container fluid px={24}>
      <h1>Full Width Container</h1>
      <p>This container spans the full width with padding</p>
    </Container>
  );
});

// Conditional fluid mode
const Example288 = defineComponent(() => {
  const isWide = signal(false);

  return () => (
    <Container fluid={isWide()} size="lg" px={24}>
      <button onClick={() => isWide(!isWide())}>
        Toggle: {isWide() ? 'Full Width' : 'Constrained'}
      </button>
      <p>Container adapts to fluid mode</p>
    </Container>
  );
});
```

#### Page Layouts

```typescript
// Typical page layout
const Example289 = defineComponent(() => {
  return () => (
    <>
      {/* Full-width header */}
      <Box as="header" style={{ background: '#1e293b', color: 'white' }}>
        <Container size="xl" px={24} py={16}>
          <Flex justify="space-between" align="center">
            <h1>My Website</h1>
            <nav>
              <HStack spacing={16}>
                <a href="/">Home</a>
                <a href="/about">About</a>
                <a href="/contact">Contact</a>
              </HStack>
            </nav>
          </Flex>
        </Container>
      </Box>

      {/* Main content */}
      <Box as="main">
        <Container size="lg" px={24} py={48}>
          <h2>Page Content</h2>
          <p>Main content area with comfortable max-width</p>
        </Container>
      </Box>

      {/* Full-width footer */}
      <Box as="footer" style={{ background: '#f3f4f6', marginTop: '64px' }}>
        <Container size="xl" px={24} py={32}>
          <p>© 2025 My Website. All rights reserved.</p>
        </Container>
      </Box>
    </>
  );
});
```

#### Landing Page Sections

```typescript
// Hero section with large container
const Example290 = defineComponent(() => {
  return () => (
    <Box as="section" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
      <Container size="xl" px={24} py={96}>
        <VStack spacing={24} align="center">
          <h1 style={{ fontSize: '48px', fontWeight: 'bold' }}>Welcome to Our Product</h1>
          <p style={{ fontSize: '20px', maxWidth: '600px', textAlign: 'center' }}>
            The best solution for your business needs. Get started today.
          </p>
          <HStack spacing={16}>
            <button class="btn-primary">Get Started</button>
            <button class="btn-secondary">Learn More</button>
          </HStack>
        </VStack>
      </Container>
    </Box>
  );
});

// Features section with medium container
const Example291 = defineComponent(() => {
  return () => (
    <Box as="section" style={{ padding: '80px 0' }}>
      <Container size="lg" px={24}>
        <VStack spacing={48} align="center">
          <h2 style={{ fontSize: '36px', textAlign: 'center' }}>Features</h2>
          <Grid templateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap={32}>
            <VStack spacing={12}>
              <h3>Feature 1</h3>
              <p>Description of feature 1</p>
            </VStack>
            <VStack spacing={12}>
              <h3>Feature 2</h3>
              <p>Description of feature 2</p>
            </VStack>
            <VStack spacing={12}>
              <h3>Feature 3</h3>
              <p>Description of feature 3</p>
            </VStack>
          </Grid>
        </VStack>
      </Container>
    </Box>
  );
});

// Testimonials section with small container for narrow text
const Example292 = defineComponent(() => {
  return () => (
    <Box as="section" style={{ background: '#f9fafb', padding: '80px 0' }}>
      <Container size="sm" px={24}>
        <VStack spacing={32} align="center">
          <h2 style={{ fontSize: '36px' }}>What Our Customers Say</h2>
          <VStack spacing={24}>
            <Box class="testimonial-card">
              <p class="quote">"This product changed our business!"</p>
              <p class="author">- John Doe, CEO</p>
            </Box>
            <Box class="testimonial-card">
              <p class="quote">"Best decision we ever made."</p>
              <p class="author">- Jane Smith, CTO</p>
            </Box>
          </VStack>
        </VStack>
      </Container>
    </Box>
  );
});
```

#### Dashboard Layouts

```typescript
// Dashboard with wide container
const Example293 = defineComponent(() => {
  return () => (
    <Container size="2xl" px={24} py={24}>
      <VStack spacing={32}>
        {/* Dashboard header */}
        <Flex justify="space-between" align="center">
          <h1>Analytics Dashboard</h1>
          <HStack spacing={12}>
            <button>Export</button>
            <button>Settings</button>
          </HStack>
        </Flex>

        {/* Stats grid */}
        <Grid templateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap={24}>
          <Box class="stat-card">
            <h3>Total Revenue</h3>
            <p class="stat-value">$123,456</p>
          </Box>
          <Box class="stat-card">
            <h3>Active Users</h3>
            <p class="stat-value">45,678</p>
          </Box>
          <Box class="stat-card">
            <h3>Conversion Rate</h3>
            <p class="stat-value">3.45%</p>
          </Box>
          <Box class="stat-card">
            <h3>Growth</h3>
            <p class="stat-value">+23%</p>
          </Box>
        </Grid>

        {/* Charts section */}
        <Grid templateColumns="2fr 1fr" gap={24}>
          <Box class="chart-card">
            <h3>Revenue Over Time</h3>
            {/* Chart component */}
          </Box>
          <Box class="chart-card">
            <h3>Top Products</h3>
            {/* List component */}
          </Box>
        </Grid>
      </VStack>
    </Container>
  );
});
```

#### Form Layouts

```typescript
// Form with medium container for better readability
const Example294 = defineComponent(() => {
  return () => (
    <Container size="md" px={24} py={48}>
      <VStack spacing={32}>
        <Box>
          <h1>Create Account</h1>
          <p>Fill in your details to get started</p>
        </Box>

        <Box as="form">
          <VStack spacing={20}>
            <VStack spacing={8}>
              <label for="name">Full Name</label>
              <input id="name" type="text" class="form-input" />
            </VStack>

            <VStack spacing={8}>
              <label for="email">Email Address</label>
              <input id="email" type="email" class="form-input" />
            </VStack>

            <VStack spacing={8}>
              <label for="password">Password</label>
              <input id="password" type="password" class="form-input" />
            </VStack>

            <HStack spacing={12} justify="end">
              <button type="button" class="btn-secondary">Cancel</button>
              <button type="submit" class="btn-primary">Create Account</button>
            </HStack>
          </VStack>
        </Box>
      </VStack>
    </Container>
  );
});
```

#### Styling Example

```css
/* Container base styles are applied via inline styles */
/* You typically style the content inside containers */

/* Page sections with containers */
.page-section {
  padding: 64px 0;
}

.page-section:nth-child(even) {
  background: var(--color-background-secondary);
}

/* Cards inside containers */
.stat-card,
.chart-card {
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-6);
  box-shadow: var(--shadow-sm);
}

/* Testimonial styling */
.testimonial-card {
  background: white;
  padding: var(--spacing-6);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.quote {
  font-size: 18px;
  font-style: italic;
  margin-bottom: var(--spacing-4);
}

.author {
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* Form inputs inside containers */
.form-input {
  width: 100%;
  padding: var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 16px;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

/* Responsive container adjustments */
@media (max-width: 768px) {
  .page-section {
    padding: 48px 0;
  }
}
```

#### API Reference

**`<Container>`** - Responsive content width container

Props:
- `size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'` - Container max-width size (default: 'lg')
  - xs: 480px
  - sm: 640px
  - md: 768px
  - lg: 1024px
  - xl: 1280px
  - 2xl: 1536px
  - full: 100%
- `centerContent?: boolean` - Center the container with auto margins (default: true)
- `fluid?: boolean` - Disable max-width constraint for full width (default: false)
- `px?: number | string` - Horizontal padding (left and right). Numbers convert to pixels (default: 16px)
- `py?: number | string` - Vertical padding (top and bottom). Numbers convert to pixels (default: none)
- `children?: any` - Child elements
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (merged with container styles)

#### Accessibility Notes

- Container is purely presentational and doesn't affect accessibility
- Use semantic HTML elements inside containers (e.g., `<header>`, `<main>`, `<section>`)
- Ensure proper heading hierarchy within containers
- Container max-width improves readability for body text (optimal line length)
- Centered content is easier to scan and read
- Consider responsive font sizes in conjunction with container sizes

#### Best Practices

1. **Choose appropriate sizes**: Use sm/md for text-heavy content (blogs, articles), lg for general pages, xl/2xl for dashboards
2. **Consistent padding**: Use the same horizontal padding across containers for visual consistency
3. **Nested containers**: Avoid nesting containers - use Box or other layout primitives inside
4. **Full-width sections**: Use fluid containers or Box with Container inside for full-width colored sections
5. **Responsive design**: Container sizes adapt to viewport, but consider mobile-specific adjustments
6. **Readability**: For text content, keep line length between 45-75 characters (sm or md sizes)
7. **Dashboard layouts**: Use xl or 2xl sizes for data-heavy interfaces to maximize screen usage
8. **Forms**: Use sm or md sizes for better form readability and user focus
9. **Hero sections**: Use xl or 2xl for landing page hero sections with prominent CTAs
10. **Performance**: Container has minimal runtime overhead with simple style calculations

---

