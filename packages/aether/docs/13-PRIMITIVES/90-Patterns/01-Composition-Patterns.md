## Composition Patterns

### Building Complex UIs from Primitives

Primitives are designed to be composed together to build complex UIs:

#### Example: Settings Dialog with Tabs

```typescript
import { defineComponent, signal } from 'aether';
import { Dialog, Tabs, Switch, Select } from 'aether/primitives';

const Example221 = defineComponent(() => {
  const isOpen = signal(false);
  const activeTab = signal('general');
  const theme = signal('system');
  const notifications = signal(true);
  const language = signal('en');

  return () => (
    <Dialog bind:open={isOpen}>
      <Dialog.Trigger class="btn">Settings</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <Dialog.Content class="dialog-content dialog-wide">
          <Dialog.Title>Settings</Dialog.Title>
          <Tabs bind:value={activeTab} class="settings-tabs">
            <Tabs.List class="tabs-list">
              <Tabs.Trigger value="general">General</Tabs.Trigger>
              <Tabs.Trigger value="appearance">Appearance</Tabs.Trigger>
              <Tabs.Trigger value="notifications">Notifications</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="general" class="tabs-content">
              <div class="settings-section">
                <h3>Language</h3>
                <Select bind:value={language}>
                  <Select.Trigger class="select-trigger">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="en">English</Select.Item>
                    <Select.Item value="es">Español</Select.Item>
                    <Select.Item value="fr">Français</Select.Item>
                  </Select.Content>
                </Select>
              </div>
            </Tabs.Content>
            <Tabs.Content value="appearance" class="tabs-content">
              <div class="settings-section">
                <div class="setting-row">
                  <div>
                    <h4>Theme</h4>
                    <p>Select your theme preference</p>
                  </div>
                  <Select bind:value={theme}>
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="light">Light</Select.Item>
                      <Select.Item value="dark">Dark</Select.Item>
                      <Select.Item value="system">System</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content value="notifications" class="tabs-content">
              <div class="settings-section">
                <div class="setting-row">
                  <div>
                    <h4>Push Notifications</h4>
                    <p>Receive push notifications</p>
                  </div>
                  <Switch bind:checked={notifications}>
                    <Switch.Thumb />
                  </Switch>
                </div>
              </div>
            </Tabs.Content>
          </Tabs>
          <div class="dialog-actions">
            <Dialog.Close class="btn btn-secondary">Cancel</Dialog.Close>
            <button class="btn btn-primary">Save Changes</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
});
```

#### Example: Data Table with Filters and Actions

```typescript
import { defineComponent, signal } from 'aether';
import { Table, Dropdown, Dialog, AlertDialog } from 'aether/primitives';

const Example279 = defineComponent(() => {
  const users = signal([/* user data */]);
  const userToDelete = signal<User | null>(null);
  const showDeleteDialog = signal(false);

  return () => (
    <div class="users-view">
      <!-- Filters -->
      <div class="filters">
        <input type="search" placeholder="Search..." />
        <Select><!-- Status filter --></Select>
        <Select><!-- Role filter --></Select>
      </div>
      <!-- Table -->
      <Table data={users()} columns={columns} rowKey="id">
        {#let table}
          <!-- ... table structure ... -->
          <!-- Actions in row -->
          <Table.Cell class="table-cell-actions">
            <DropdownMenu>
              <DropdownMenu.Trigger class="btn-icon">
                <MoreIcon />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item on:select={() => editUser(row)}>
                  Edit
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  on:select={() => {
                    userToDelete(row);
                    showDeleteDialog(true);
                  }}
                  class="destructive"
                >
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </Table.Cell>
        {/let}
      </Table>
      <!-- Delete confirmation -->
      <AlertDialog bind:open={showDeleteDialog}>
        <AlertDialog.Content>
          <AlertDialog.Title>Delete User</AlertDialog.Title>
          <AlertDialog.Description>
            Are you sure you want to delete {userToDelete()?.name}?
            This action cannot be undone.
          </AlertDialog.Description>
          <div class="alert-dialog-actions">
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              class="btn-destructive"
              on:click={() => deleteUser(userToDelete())}
            >
              Delete
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog>
    </div>
  );
});
```

### Layout Composition Patterns

Layout primitives (Box, Flex, Grid, Stack, Container) are designed to be composed together for powerful, maintainable layouts.

#### Pattern 1: Container + Grid (Dashboard Layout)

```typescript
import { defineComponent } from 'aether';
import { Container, Grid, Box, VStack, HStack } from 'aether/primitives';

const Example295 = defineComponent(() => {
  return () => (
    <Container size="2xl" px={24} py={24}>
      <VStack spacing={32}>
        {/* Dashboard header with actions */}
        <HStack justify="space-between" align="center">
          <h1>Analytics Dashboard</h1>
          <HStack spacing={12}>
            <button class="btn-secondary">Export</button>
            <button class="btn-primary">Settings</button>
          </HStack>
        </HStack>

        {/* Stats grid - responsive 4 columns */}
        <Grid templateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap={24}>
          <Box class="stat-card">
            <VStack spacing={8}>
              <span class="stat-label">Revenue</span>
              <span class="stat-value">$123,456</span>
              <span class="stat-change positive">+12.5%</span>
            </VStack>
          </Box>
          <Box class="stat-card">
            <VStack spacing={8}>
              <span class="stat-label">Users</span>
              <span class="stat-value">45,678</span>
              <span class="stat-change positive">+8.2%</span>
            </VStack>
          </Box>
          <Box class="stat-card">
            <VStack spacing={8}>
              <span class="stat-label">Orders</span>
              <span class="stat-value">1,234</span>
              <span class="stat-change negative">-3.1%</span>
            </VStack>
          </Box>
          <Box class="stat-card">
            <VStack spacing={8}>
              <span class="stat-label">Conversion</span>
              <span class="stat-value">3.45%</span>
              <span class="stat-change positive">+0.5%</span>
            </VStack>
          </Box>
        </Grid>

        {/* Charts section - 2:1 ratio */}
        <Grid templateColumns="2fr 1fr" gap={24}>
          <Box class="chart-card">
            <VStack spacing={16}>
              <h3>Revenue Over Time</h3>
              {/* Chart component */}
              <Box style={{ height: '300px', background: '#f5f5f5' }}>
                Chart Area
              </Box>
            </VStack>
          </Box>
          <Box class="chart-card">
            <VStack spacing={16}>
              <h3>Top Products</h3>
              <VStack spacing={12}>
                <HStack justify="space-between">
                  <span>Product A</span>
                  <span class="value">$12,345</span>
                </HStack>
                <HStack justify="space-between">
                  <span>Product B</span>
                  <span class="value">$9,876</span>
                </HStack>
                <HStack justify="space-between">
                  <span>Product C</span>
                  <span class="value">$7,654</span>
                </HStack>
              </VStack>
            </VStack>
          </Box>
        </Grid>
      </VStack>
    </Container>
  );
});
```

#### Pattern 2: Box + Container (Full-Width Sections)

```typescript
import { defineComponent } from 'aether';
import { Container, Box, VStack, HStack, Grid } from 'aether/primitives';

const Example296 = defineComponent(() => {
  return () => (
    <>
      {/* Hero section - full-width colored background */}
      <Box as="section" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
        <Container size="xl" px={24} py={96}>
          <VStack spacing={32} align="center">
            <h1 style={{ fontSize: '56px', fontWeight: 'bold', textAlign: 'center' }}>
              Build Amazing Products
            </h1>
            <p style={{ fontSize: '20px', textAlign: 'center', maxWidth: '600px' }}>
              The complete solution for modern web applications.
              Fast, scalable, and developer-friendly.
            </p>
            <HStack spacing={16}>
              <button class="btn-primary-inverse">Get Started</button>
              <button class="btn-secondary-inverse">View Demo</button>
            </HStack>
          </VStack>
        </Container>
      </Box>

      {/* Features section - white background */}
      <Box as="section" style={{ background: '#ffffff', padding: '80px 0' }}>
        <Container size="lg" px={24}>
          <VStack spacing={48}>
            <h2 style={{ fontSize: '42px', textAlign: 'center' }}>Features</h2>
            <Grid templateColumns="repeat(auto-fit, minmax(300px, 1fr))" gap={40}>
              <VStack spacing={16} align="center">
                <Box class="feature-icon">🚀</Box>
                <h3>Lightning Fast</h3>
                <p style={{ textAlign: 'center' }}>
                  Optimized performance for the best user experience
                </p>
              </VStack>
              <VStack spacing={16} align="center">
                <Box class="feature-icon">🔒</Box>
                <h3>Secure by Default</h3>
                <p style={{ textAlign: 'center' }}>
                  Enterprise-grade security built into every layer
                </p>
              </VStack>
              <VStack spacing={16} align="center">
                <Box class="feature-icon">📱</Box>
                <h3>Fully Responsive</h3>
                <p style={{ textAlign: 'center' }}>
                  Perfect experience on any device or screen size
                </p>
              </VStack>
            </Grid>
          </VStack>
        </Container>
      </Box>

      {/* CTA section - colored background */}
      <Box as="section" style={{ background: '#1e293b', color: 'white', padding: '80px 0' }}>
        <Container size="md" px={24}>
          <VStack spacing={24} align="center">
            <h2 style={{ fontSize: '36px', textAlign: 'center' }}>
              Ready to Get Started?
            </h2>
            <p style={{ fontSize: '18px', textAlign: 'center' }}>
              Join thousands of developers building with our platform
            </p>
            <button class="btn-primary-large">Start Free Trial</button>
          </VStack>
        </Container>
      </Box>
    </>
  );
});
```

#### Pattern 3: Grid + Stack (Card Grid Layout)

```typescript
import { defineComponent } from 'aether';
import { Container, Grid, Box, VStack, HStack } from 'aether/primitives';

const Example297 = defineComponent(() => {
  const products = signal([
    { id: 1, name: 'Product A', price: 99.99, image: '/a.jpg' },
    { id: 2, name: 'Product B', price: 149.99, image: '/b.jpg' },
    { id: 3, name: 'Product C', price: 79.99, image: '/c.jpg' },
    { id: 4, name: 'Product D', price: 199.99, image: '/d.jpg' },
  ]);

  return () => (
    <Container size="xl" px={24} py={48}>
      <VStack spacing={32}>
        <h1>Our Products</h1>

        {/* Responsive product grid */}
        <Grid
          templateColumns="repeat(auto-fill, minmax(280px, 1fr))"
          gap={24}
        >
          {products().map(product => (
            <Box class="product-card" key={product.id}>
              <VStack spacing={16}>
                {/* Product image */}
                <Box
                  style={{
                    width: '100%',
                    height: '200px',
                    background: '#f0f0f0',
                    borderRadius: '8px'
                  }}
                >
                  <img src={product.image} alt={product.name} />
                </Box>

                {/* Product info */}
                <VStack spacing={8}>
                  <h3>{product.name}</h3>
                  <p class="price">${product.price}</p>
                </VStack>

                {/* Actions */}
                <HStack spacing={12} style={{ width: '100%' }}>
                  <button class="btn-secondary" style={{ flex: 1 }}>
                    Details
                  </button>
                  <button class="btn-primary" style={{ flex: 1 }}>
                    Add to Cart
                  </button>
                </HStack>
              </VStack>
            </Box>
          ))}
        </Grid>
      </VStack>
    </Container>
  );
});
```

#### Pattern 4: Flex + Stack (Sidebar Layout)

```typescript
import { defineComponent } from 'aether';
import { Flex, Box, VStack, HStack } from 'aether/primitives';

const Example298 = defineComponent(() => {
  return () => (
    <Flex style={{ minHeight: '100vh' }}>
      {/* Sidebar - fixed width */}
      <Box
        as="aside"
        style={{
          width: '250px',
          background: '#1e293b',
          color: 'white',
          padding: '24px'
        }}
      >
        <VStack spacing={24} align="stretch">
          <h2>Dashboard</h2>
          <VStack spacing={8} align="stretch">
            <a href="/home" class="nav-link active">Home</a>
            <a href="/analytics" class="nav-link">Analytics</a>
            <a href="/users" class="nav-link">Users</a>
            <a href="/settings" class="nav-link">Settings</a>
          </VStack>
        </VStack>
      </Box>

      {/* Main content - grows to fill space */}
      <Box as="main" grow={1} style={{ background: '#f9fafb' }}>
        <VStack spacing={0} style={{ height: '100%' }}>
          {/* Header - fixed height */}
          <Box
            as="header"
            style={{
              background: 'white',
              borderBottom: '1px solid #e5e7eb',
              padding: '16px 24px'
            }}
          >
            <HStack justify="space-between" align="center">
              <h1>Page Title</h1>
              <HStack spacing={12}>
                <button class="btn-icon">🔔</button>
                <button class="btn-icon">👤</button>
              </HStack>
            </HStack>
          </Box>

          {/* Content - scrollable */}
          <Box grow={1} style={{ padding: '24px', overflowY: 'auto' }}>
            <VStack spacing={24}>
              <p>Main content area that grows to fill available space</p>
              {/* Page content */}
            </VStack>
          </Box>
        </VStack>
      </Box>
    </Flex>
  );
});
```

#### Pattern 5: Nested Stacks (Form Layout)

```typescript
import { defineComponent } from 'aether';
import { Container, VStack, HStack, Box } from 'aether/primitives';

const Example299 = defineComponent(() => {
  return () => (
    <Container size="md" px={24} py={48}>
      <VStack spacing={32}>
        {/* Form header */}
        <Box>
          <h1>Contact Us</h1>
          <p>Fill out the form below and we'll get back to you</p>
        </Box>

        {/* Form */}
        <Box as="form">
          <VStack spacing={24}>
            {/* Name fields - horizontal on desktop */}
            <HStack spacing={16} wrap>
              <VStack spacing={8} grow={1} style={{ minWidth: '200px' }}>
                <label for="firstName">First Name</label>
                <input id="firstName" type="text" class="form-input" />
              </VStack>
              <VStack spacing={8} grow={1} style={{ minWidth: '200px' }}>
                <label for="lastName">Last Name</label>
                <input id="lastName" type="text" class="form-input" />
              </VStack>
            </HStack>

            {/* Email - full width */}
            <VStack spacing={8}>
              <label for="email">Email Address</label>
              <input id="email" type="email" class="form-input" />
            </VStack>

            {/* Subject - full width */}
            <VStack spacing={8}>
              <label for="subject">Subject</label>
              <input id="subject" type="text" class="form-input" />
            </VStack>

            {/* Message - full width */}
            <VStack spacing={8}>
              <label for="message">Message</label>
              <textarea
                id="message"
                class="form-input"
                rows={6}
              />
            </VStack>

            {/* Form actions */}
            <HStack spacing={12} justify="end">
              <button type="button" class="btn-secondary">
                Cancel
              </button>
              <button type="submit" class="btn-primary">
                Send Message
              </button>
            </HStack>
          </VStack>
        </Box>
      </VStack>
    </Container>
  );
});
```

#### Pattern 6: Grid with Named Areas (Complex Layout)

```typescript
import { defineComponent } from 'aether';
import { Grid, Box, VStack, HStack } from 'aether/primitives';

const Example300 = defineComponent(() => {
  return () => (
    <Grid
      templateAreas={`
        "header header header"
        "sidebar main aside"
        "footer footer footer"
      `}
      templateColumns="250px 1fr 300px"
      templateRows="auto 1fr auto"
      gap={0}
      style={{ minHeight: '100vh' }}
    >
      {/* Header */}
      <Box
        style={{ gridArea: 'header' }}
        class="site-header"
      >
        <HStack
          justify="space-between"
          align="center"
          style={{ padding: '16px 24px' }}
        >
          <h1>My App</h1>
          <nav>
            <HStack spacing={16}>
              <a href="/">Home</a>
              <a href="/about">About</a>
              <a href="/contact">Contact</a>
            </HStack>
          </nav>
        </HStack>
      </Box>

      {/* Left Sidebar */}
      <Box
        style={{ gridArea: 'sidebar' }}
        class="sidebar-left"
      >
        <VStack spacing={16} style={{ padding: '24px' }}>
          <h3>Categories</h3>
          <VStack spacing={8} align="stretch">
            <a href="/tech" class="category-link">Technology</a>
            <a href="/design" class="category-link">Design</a>
            <a href="/business" class="category-link">Business</a>
          </VStack>
        </VStack>
      </Box>

      {/* Main Content */}
      <Box
        style={{ gridArea: 'main' }}
        class="main-content"
      >
        <VStack spacing={24} style={{ padding: '24px' }}>
          <h2>Main Content</h2>
          <p>This is the primary content area</p>
        </VStack>
      </Box>

      {/* Right Aside */}
      <Box
        style={{ gridArea: 'aside' }}
        class="sidebar-right"
      >
        <VStack spacing={16} style={{ padding: '24px' }}>
          <h3>Recent Posts</h3>
          <VStack spacing={12}>
            <Box class="widget-item">
              <p>Post title 1</p>
            </Box>
            <Box class="widget-item">
              <p>Post title 2</p>
            </Box>
          </VStack>
        </VStack>
      </Box>

      {/* Footer */}
      <Box
        style={{ gridArea: 'footer' }}
        class="site-footer"
      >
        <VStack
          spacing={16}
          align="center"
          style={{ padding: '32px 24px' }}
        >
          <p>© 2025 My App. All rights reserved.</p>
          <HStack spacing={16}>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/contact">Contact</a>
          </HStack>
        </VStack>
      </Box>
    </Grid>
  );
});
```

#### Key Layout Composition Principles

1. **Container for Content Width**: Always use Container to constrain content width and center it
2. **Box for Semantic Structure**: Use Box with `as` prop for semantic HTML elements
3. **Grid for 2D Layouts**: Use Grid when you need both rows and columns (dashboards, image galleries)
4. **Flex for 1D Layouts**: Use Flex for navigation bars, toolbars, or any single-axis layout
5. **Stack for Vertical/Horizontal Lists**: Use VStack/HStack for simple lists with consistent spacing
6. **Nesting is Powerful**: Compose primitives deeply - Grid > Container > VStack > HStack
7. **Responsive by Design**: Use auto-fit/auto-fill for grids, wrap for flex, and container sizes
8. **Full-Width Sections**: Box (colored) > Container (constrained) for landing pages
9. **Sidebar Layouts**: Flex with fixed-width sidebar and growing main content
10. **Form Layouts**: Container (md/sm) > VStack for vertical flow > HStack for field groups

---

### Primitive Composition Rules

1. **Primitives don't style themselves** - You provide all styling
2. **Context flows down** - Parent primitives provide context to children
3. **Events bubble up** - Child interactions notify parent components
4. **Accessibility is built-in** - ARIA attributes handled automatically
5. **State can be controlled or uncontrolled** - Flexible state management

---

