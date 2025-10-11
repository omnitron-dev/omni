### ScrollArea

A customizable scrollable area component with styled scrollbars. Provides fine-grained control over scroll behavior and custom scrollbar styling while maintaining native scroll performance.

#### Features

- Custom styled scrollbars (vertical and horizontal)
- Multiple scroll types: auto, always, scroll, hover
- Responsive scrollbar visibility
- Proportional scrollbar thumb sizing
- Native scroll performance
- RTL/LTR direction support
- Reactive scroll position tracking
- Composable sub-components
- Cross-browser compatible
- Touch-friendly

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { ScrollArea } from 'aether/primitives';

// Basic scrollable area
const Example329 = defineComponent(() => {
  return () => (
    <ScrollArea class="scroll-container" style={{ height: '300px' }}>
      <ScrollArea.Viewport>
        <div style={{ padding: '16px' }}>
          <h2>Scrollable Content</h2>
          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
          <p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
          <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</p>
          <p>Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
      <ScrollArea.Scrollbar orientation="horizontal">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});

// Vertical scroll only
const Example330 = defineComponent(() => {
  return () => (
    <ScrollArea style={{ height: '400px', width: '600px' }}>
      <ScrollArea.Viewport>
        <div style={{ padding: '24px' }}>
          {Array.from({ length: 50 }, (_, i) => (
            <p key={i}>Line {i + 1}: This is some scrollable content</p>
          ))}
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});
```

#### Scroll Types

```typescript
// Auto - show scrollbars only when needed (default)
const Example331 = defineComponent(() => {
  return () => (
    <ScrollArea type="auto" style={{ height: '300px', width: '500px' }}>
      <ScrollArea.Viewport>
        <div style={{ padding: '16px' }}>
          Content that may or may not overflow
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});

// Always - always show scrollbars even when not needed
const Example332 = defineComponent(() => {
  return () => (
    <ScrollArea type="always" style={{ height: '300px', width: '500px' }}>
      <ScrollArea.Viewport>
        <div style={{ padding: '16px' }}>
          Scrollbars always visible
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" forceMount>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});

// Hover - show scrollbars only on hover
const Example333 = defineComponent(() => {
  return () => (
    <ScrollArea type="hover" style={{ height: '300px', width: '500px' }}>
      <ScrollArea.Viewport>
        <div style={{ padding: '16px' }}>
          Hover to reveal scrollbars
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});

// Scroll - native scroll behavior with custom styling
const Example334 = defineComponent(() => {
  return () => (
    <ScrollArea type="scroll" style={{ height: '300px', width: '500px' }}>
      <ScrollArea.Viewport>
        <div style={{ padding: '16px' }}>
          Native scroll with custom scrollbars
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});
```

#### Horizontal Scrolling

```typescript
// Horizontal scroll for wide content
const Example335 = defineComponent(() => {
  return () => (
    <ScrollArea style={{ height: '200px', width: '100%', maxWidth: '600px' }}>
      <ScrollArea.Viewport>
        <div style={{ display: 'flex', gap: '16px', padding: '16px' }}>
          {Array.from({ length: 20 }, (_, i) => (
            <div
              key={i}
              style={{
                minWidth: '150px',
                height: '150px',
                background: '#3b82f6',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: 'bold'
              }}
            >
              Card {i + 1}
            </div>
          ))}
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="horizontal">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});

// Both scrollbars
const Example336 = defineComponent(() => {
  return () => (
    <ScrollArea style={{ height: '400px', width: '600px' }}>
      <ScrollArea.Viewport>
        <div style={{ minWidth: '1200px', padding: '16px' }}>
          <h2>Wide and Tall Content</h2>
          {Array.from({ length: 30 }, (_, i) => (
            <p key={i}>
              Line {i + 1}: This content is both wide and tall, requiring both scrollbars
            </p>
          ))}
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
      <ScrollArea.Scrollbar orientation="horizontal">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});
```

#### Custom Scrollbar Styling

```typescript
// Styled scrollbars
const Example337 = defineComponent(() => {
  return () => (
    <ScrollArea class="custom-scroll" style={{ height: '400px', width: '600px' }}>
      <ScrollArea.Viewport>
        <div style={{ padding: '24px' }}>
          <h2>Custom Styled Scrollbars</h2>
          {Array.from({ length: 30 }, (_, i) => (
            <p key={i}>Paragraph {i + 1} with custom scrollbar styling</p>
          ))}
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" class="custom-scrollbar">
        <ScrollArea.Thumb class="custom-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea>
  );
});
```

#### Chat/Message List

```typescript
// Chat messages with scroll
const Example338 = defineComponent(() => {
  const messages = [
    { id: 1, user: 'Alice', text: 'Hey there!' },
    { id: 2, user: 'Bob', text: 'Hi Alice! How are you?' },
    { id: 3, user: 'Alice', text: 'Doing great! Working on the new feature.' },
    { id: 4, user: 'Bob', text: 'Awesome! Need any help?' },
    { id: 5, user: 'Alice', text: 'Sure, could you review my PR?' },
    // ... more messages
  ];

  return () => (
    <div class="chat-container">
      <div class="chat-header">
        <h3>Team Chat</h3>
      </div>
      <ScrollArea style={{ height: '400px' }}>
        <ScrollArea.Viewport>
          <div class="messages">
            {messages.map(msg => (
              <div key={msg.id} class="message">
                <strong class="message-user">{msg.user}</strong>
                <p class="message-text">{msg.text}</p>
              </div>
            ))}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
      </ScrollArea>
      <div class="chat-input">
        <input type="text" placeholder="Type a message..." />
        <button>Send</button>
      </div>
    </div>
  );
});
```

#### Data Table with Scroll

```typescript
// Scrollable data table
const Example339 = defineComponent(() => {
  const data = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    role: ['Admin', 'User', 'Guest'][i % 3],
    status: ['Active', 'Inactive'][i % 2]
  }));

  return () => (
    <div class="table-container">
      <ScrollArea style={{ height: '500px' }}>
        <ScrollArea.Viewport>
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.name}</td>
                  <td>{row.email}</td>
                  <td>{row.role}</td>
                  <td>
                    <span class={`status status-${row.status.toLowerCase()}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
      </ScrollArea>
    </div>
  );
});
```

#### Sidebar with Scroll

```typescript
// Scrollable sidebar navigation
const Example340 = defineComponent(() => {
  const menuItems = [
    { section: 'Dashboard', items: ['Overview', 'Analytics', 'Reports'] },
    { section: 'Projects', items: ['All Projects', 'Active', 'Completed', 'Archived'] },
    { section: 'Team', items: ['Members', 'Roles', 'Permissions', 'Invitations'] },
    { section: 'Settings', items: ['General', 'Account', 'Billing', 'Security', 'Integrations', 'API'] },
  ];

  return () => (
    <aside class="sidebar">
      <div class="sidebar-header">
        <strong>MyApp</strong>
      </div>
      <ScrollArea style={{ height: 'calc(100vh - 120px)' }}>
        <ScrollArea.Viewport>
          <nav class="sidebar-nav">
            {menuItems.map(section => (
              <div key={section.section} class="nav-section">
                <div class="nav-section-title">{section.section}</div>
                {section.items.map(item => (
                  <a key={item} href={`/${section.section.toLowerCase()}/${item.toLowerCase()}`} class="nav-item">
                    {item}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
      </ScrollArea>
      <div class="sidebar-footer">
        <button class="btn-block">Logout</button>
      </div>
    </aside>
  );
});
```

#### Code Block with Scroll

```typescript
// Scrollable code block
const Example341 = defineComponent(() => {
  const code = `function calculateTotal(items) {
  return items.reduce((sum, item) => {
    return sum + (item.price * item.quantity);
  }, 0);
}

const cart = [
  { id: 1, name: 'Product A', price: 29.99, quantity: 2 },
  { id: 2, name: 'Product B', price: 49.99, quantity: 1 },
  { id: 3, name: 'Product C', price: 19.99, quantity: 3 }
];

const total = calculateTotal(cart);
console.log('Total:', total);`;

  return () => (
    <div class="code-block">
      <div class="code-header">
        <span>example.js</span>
        <button class="btn-copy">Copy</button>
      </div>
      <ScrollArea style={{ maxHeight: '300px' }}>
        <ScrollArea.Viewport>
          <pre><code>{code}</code></pre>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar orientation="horizontal">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
      </ScrollArea>
    </div>
  );
});
```

#### Styling Example

```css
/* ScrollArea container */
[data-scroll-area] {
  position: relative;
  overflow: hidden;
}

/* Viewport - the scrollable area */
[data-scroll-area-viewport] {
  width: 100%;
  height: 100%;
  overflow: scroll;
  /* Hide native scrollbars */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}

[data-scroll-area-viewport]::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}

/* Custom scrollbar track */
[data-scroll-area-scrollbar] {
  position: absolute;
  display: flex;
  user-select: none;
  touch-action: none;
  background: rgba(0, 0, 0, 0.05);
  transition: background 0.2s;
}

[data-scroll-area-scrollbar]:hover {
  background: rgba(0, 0, 0, 0.1);
}

/* Vertical scrollbar positioning */
[data-scroll-area-scrollbar][data-orientation='vertical'] {
  top: 0;
  right: 0;
  width: 10px;
  height: 100%;
}

/* Horizontal scrollbar positioning */
[data-scroll-area-scrollbar][data-orientation='horizontal'] {
  bottom: 0;
  left: 0;
  height: 10px;
  width: 100%;
}

/* Scrollbar thumb */
[data-scroll-area-thumb] {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  transition: background 0.2s;
}

[data-scroll-area-thumb]:hover {
  background: rgba(0, 0, 0, 0.5);
}

[data-scroll-area-scrollbar]:hover [data-scroll-area-thumb] {
  background: rgba(0, 0, 0, 0.4);
}

/* Custom styled scrollbars */
.custom-scrollbar {
  width: 12px;
  background: var(--color-background-secondary);
  border-radius: 6px;
}

.custom-thumb {
  background: var(--color-primary);
  border-radius: 6px;
  min-height: 40px;
}

.custom-thumb:hover {
  background: var(--color-primary-dark);
}

/* Hover type - hide scrollbar until hover */
[data-scroll-area][data-type='hover'] [data-scroll-area-scrollbar] {
  opacity: 0;
  transition: opacity 0.2s;
}

[data-scroll-area][data-type='hover']:hover [data-scroll-area-scrollbar] {
  opacity: 1;
}

/* Chat messages styling */
.messages {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  background: var(--color-background-secondary);
  padding: 12px;
  border-radius: var(--radius-md);
}

.message-user {
  display: block;
  font-size: 14px;
  color: var(--color-primary);
  margin-bottom: 4px;
}

.message-text {
  margin: 0;
  font-size: 14px;
}

/* Data table styling */
.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th {
  position: sticky;
  top: 0;
  background: var(--color-background-primary);
  padding: 12px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid var(--color-border);
  z-index: 1;
}

.data-table td {
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
}

.data-table tbody tr:hover {
  background: var(--color-background-hover);
}

/* Code block styling */
.code-block {
  background: #1e293b;
  border-radius: var(--radius-md);
  overflow: hidden;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #0f172a;
  color: #94a3b8;
  font-size: 14px;
  border-bottom: 1px solid #334155;
}

.code-block pre {
  margin: 0;
  padding: 16px;
  color: #e2e8f0;
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.5;
}

.code-block code {
  display: block;
  white-space: pre;
}
```

#### API Reference

**`<ScrollArea>`** - Root component

Props:
- `type?: 'auto' | 'always' | 'scroll' | 'hover'` - Scroll behavior type (default: 'hover')
  - auto: Show scrollbars only when content overflows
  - always: Always show scrollbars (use with forceMount on scrollbars)
  - scroll: Native scroll with custom scrollbar styling
  - hover: Show scrollbars on hover
- `dir?: 'ltr' | 'rtl'` - Text direction for scroll behavior (default: 'ltr')
- `children?: any` - Child components (Viewport and Scrollbars)
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles (should include height/maxHeight)

**`<ScrollArea.Viewport>`** - Scrollable content container

Props:
- `children?: any` - Content to scroll
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles

**`<ScrollArea.Scrollbar>`** - Scrollbar track

Props:
- `orientation: 'vertical' | 'horizontal'` - Scrollbar orientation (required)
- `forceMount?: boolean` - Always render scrollbar even when not needed (default: false)
- `children?: any` - Thumb component
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles

**`<ScrollArea.Thumb>`** - Scrollbar thumb (draggable part)

Props:
- `class?: string` - Additional CSS class
- `style?: Record<string, any>` - Inline styles

Data attributes available for styling:
- `[data-scroll-area]` - Root element
- `[data-scroll-area-viewport]` - Viewport element
- `[data-scroll-area-scrollbar]` - Scrollbar track
- `[data-scroll-area-thumb]` - Scrollbar thumb
- `[data-orientation]` - 'vertical' or 'horizontal'
- `[data-state]` - 'visible' or 'hidden'
- `[data-type]` - 'auto', 'always', 'scroll', or 'hover'

#### Accessibility Notes

- ScrollArea maintains native scroll behavior for keyboard navigation
- Scrollable content is accessible via keyboard (arrow keys, Page Up/Down, Home/End)
- Custom scrollbars don't interfere with screen readers
- Native scroll announcements work correctly
- Touch scrolling works on mobile devices
- Focus management is preserved within scroll area
- Consider using native scrollbars for better accessibility if custom styling isn't critical

#### Browser Compatibility

- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Uses ResizeObserver for scroll updates (widely supported)
- CSS gap property for scrollbar positioning (IE11 not supported)
- Touch events supported on mobile browsers
- Fallback to native scrollbars if JavaScript fails

#### Best Practices

1. **Always set height**: ScrollArea needs a height constraint to enable scrolling
2. **Use maxHeight for dynamic content**: Better for content that might not need scrolling
3. **Include both scrollbars when needed**: For content that scrolls both ways
4. **Custom styling**: Use data attributes for consistent scrollbar styling
5. **Hover type for clean UI**: Use type="hover" to hide scrollbars until needed
6. **Performance**: ScrollArea uses native scroll - performant for large content
7. **Sticky headers**: Position sticky works inside ScrollArea.Viewport
8. **Mobile considerations**: Ensure touch targets are large enough (min 44x44px)
9. **Contrast**: Ensure scrollbar thumb has sufficient contrast with track
10. **Test keyboard navigation**: Verify arrow keys, Page Up/Down work correctly

#### Common Patterns

**Chat/Messages**: Set height, add padding to viewport, style messages
**Data Tables**: Use sticky headers, set reasonable height, style rows
**Sidebars**: Use calc(100vh - header - footer) for height
**Code Blocks**: Use maxHeight, enable horizontal scroll for long lines
**Modal Content**: Set maxHeight to 70vh to ensure modal doesn't overflow
**Card Lists**: Fixed height with vertical scroll for long lists

---

---

