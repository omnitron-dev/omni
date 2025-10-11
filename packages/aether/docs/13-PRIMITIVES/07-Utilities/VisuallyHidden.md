### VisuallyHidden

Hides content visually while keeping it accessible to screen readers and assistive technologies.

#### Features

- Content invisible to sighted users
- Fully accessible to screen readers
- Maintains document flow
- Focusable when interactive
- Uses CSS clip technique (best practice)
- Zero layout impact
- Works with all interactive elements

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { VisuallyHidden } from 'aether/primitives';

export const IconButton = defineComponent(() => {
  const handleClose = () => {
    // Close dialog
  };

  return () => (
    <button onClick={handleClose} class="icon-button">
      <VisuallyHidden>Close dialog</VisuallyHidden>
      <XIcon />
    </button>
  );
});
```

#### Skip Navigation Link

```typescript
import { defineComponent } from 'aether';
import { VisuallyHidden } from 'aether/primitives';

export const Layout = defineComponent(() => {
  return () => (
    <div>
      {/* Skip link becomes visible when focused */}
      <a href="#main-content" class="skip-link">
        <VisuallyHidden>Skip to main content</VisuallyHidden>
      </a>

      <header>
        <nav aria-label="Main navigation">
          {/* Navigation items */}
        </nav>
      </header>

      <main id="main-content">
        {/* Main content */}
      </main>
    </div>
  );
});
```

#### Accessible Icon-Only Buttons

```typescript
import { defineComponent } from 'aether';
import { VisuallyHidden } from 'aether/primitives';

export const MediaControls = defineComponent(() => {
  const handlePlay = () => console.log('Play');
  const handlePause = () => console.log('Pause');
  const handleNext = () => console.log('Next');
  const handlePrevious = () => console.log('Previous');

  return () => (
    <div class="media-controls">
      <button onClick={handlePrevious} class="media-button">
        <VisuallyHidden>Previous track</VisuallyHidden>
        <PreviousIcon />
      </button>

      <button onClick={handlePlay} class="media-button media-button-primary">
        <VisuallyHidden>Play</VisuallyHidden>
        <PlayIcon />
      </button>

      <button onClick={handlePause} class="media-button">
        <VisuallyHidden>Pause</VisuallyHidden>
        <PauseIcon />
      </button>

      <button onClick={handleNext} class="media-button">
        <VisuallyHidden>Next track</VisuallyHidden>
        <NextIcon />
      </button>
    </div>
  );
});
```

#### Additional Context for Screen Readers

```typescript
import { defineComponent } from 'aether';
import { VisuallyHidden } from 'aether/primitives';

export const StatusBadge = defineComponent(() => {
  return () => (
    <div class="status-container">
      <div class="status-badge status-badge-success">
        <CheckIcon />
        <span>Active</span>
        <VisuallyHidden>User account is currently active</VisuallyHidden>
      </div>

      <div class="status-badge status-badge-warning">
        <AlertIcon />
        <span>3 items</span>
        <VisuallyHidden>3 items require your attention</VisuallyHidden>
      </div>
    </div>
  );
});
```

#### Form Labels

```typescript
import { defineComponent } from 'aether';
import { VisuallyHidden } from 'aether/primitives';

export const SearchForm = defineComponent(() => {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    // Perform search
  };

  return () => (
    <form onSubmit={handleSubmit} class="search-form">
      <VisuallyHidden>
        <label for="search-input">Search the site</label>
      </VisuallyHidden>
      <input
        id="search-input"
        type="search"
        placeholder="Search..."
        class="search-input"
      />
      <button type="submit" class="search-button">
        <VisuallyHidden>Submit search</VisuallyHidden>
        <SearchIcon />
      </button>
    </form>
  );
});
```

#### Data Tables with Context

```typescript
import { defineComponent } from 'aether';
import { VisuallyHidden } from 'aether/primitives';

export const UserTable = defineComponent(() => {
  const users = [
    { id: 1, name: 'Alice', email: 'alice@example.com', status: 'active' },
    { id: 2, name: 'Bob', email: 'bob@example.com', status: 'inactive' },
  ];

  return () => (
    <table class="user-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Status</th>
          <th>
            <VisuallyHidden>Actions</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {users.map(user => (
          <tr>
            <td>{user.name}</td>
            <td>{user.email}</td>
            <td>{user.status}</td>
            <td>
              <button class="icon-button">
                <VisuallyHidden>Edit {user.name}</VisuallyHidden>
                <EditIcon />
              </button>
              <button class="icon-button">
                <VisuallyHidden>Delete {user.name}</VisuallyHidden>
                <DeleteIcon />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});
```

#### Loading States

```typescript
import { defineComponent, signal } from 'aether';
import { VisuallyHidden } from 'aether/primitives';

export const LoadingButton = defineComponent(() => {
  const isLoading = signal(false);

  const handleSubmit = async () => {
    isLoading(true);
    try {
      await saveData();
    } finally {
      isLoading(false);
    }
  };

  return () => (
    <button
      onClick={handleSubmit}
      disabled={isLoading()}
      class="button"
    >
      {isLoading() && (
        <>
          <SpinnerIcon class="spinner" />
          <VisuallyHidden>Loading, please wait</VisuallyHidden>
        </>
      )}
      {!isLoading() && 'Save Changes'}
    </button>
  );
});
```

#### Styling Example

```css
/* Skip link that becomes visible on focus */
.skip-link {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.skip-link:focus {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;

  width: auto;
  height: auto;
  padding: var(--spacing-3) var(--spacing-4);
  margin: var(--spacing-2);

  background: var(--color-primary-500);
  color: white;
  text-decoration: none;
  border-radius: var(--radius-md);

  clip: auto;
  white-space: normal;

  box-shadow: var(--shadow-lg);
  outline: 2px solid var(--color-primary-700);
  outline-offset: 2px;
}

/* Icon buttons with accessible labels */
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 40px;
  height: 40px;
  padding: var(--spacing-2);

  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  color: var(--color-text-primary);

  cursor: pointer;
  outline: none;

  transition: all var(--transition-fast);
}

.icon-button:hover {
  background: var(--color-background-secondary);
  border-color: var(--color-primary-500);
}

.icon-button:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

/* Media controls */
.media-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-4);
  background: var(--color-background-secondary);
  border-radius: var(--radius-lg);
}

.media-button {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;

  background: transparent;
  border: none;
  border-radius: 50%;

  color: var(--color-text-primary);
  cursor: pointer;

  transition: all var(--transition-fast);
}

.media-button:hover {
  background: var(--color-background-tertiary);
}

.media-button-primary {
  width: 64px;
  height: 64px;
  background: var(--color-primary-500);
  color: white;
}

.media-button-primary:hover {
  background: var(--color-primary-600);
}
```

#### API Reference

**`<VisuallyHidden>`** - Visually hidden accessible content

Props:
- `children?: any` - Content to hide visually
- `...HTMLAttributes` - Standard span props

The component applies the following inline styles:
```css
{
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  borderWidth: '0'
}
```

#### Accessibility

The VisuallyHidden component is a critical accessibility tool:

- **Screen Reader Only** - Content is announced by screen readers but invisible to sighted users
- **Best Practice Technique** - Uses the modern CSS clip method (recommended by accessibility experts)
- **Maintains Focus** - Interactive elements remain keyboard accessible
- **No Layout Impact** - Doesn't affect document flow or cause reflows
- **WCAG Compliance** - Helps meet WCAG 2.1 Level AA requirements

#### When to Use

Use VisuallyHidden for:

1. **Icon-Only Buttons** - Provide text alternatives for icon buttons
2. **Skip Links** - Allow keyboard users to bypass navigation
3. **Additional Context** - Add screen reader context not needed visually
4. **Form Labels** - Hide labels when visual design doesn't include them
5. **Loading States** - Announce loading to screen reader users
6. **Table Headers** - Label columns that are visually clear but need text
7. **Status Messages** - Announce status changes to assistive technologies

#### When NOT to Use

Avoid VisuallyHidden for:

1. **Essential Information** - Content that all users need to see
2. **Primary Labels** - Use visible labels when possible (better UX)
3. **Decorative Content** - Use `aria-hidden="true"` or empty `alt` instead
4. **Error Messages** - Make errors visible to all users
5. **Instructions** - Show instructions visually when important

#### Best Practices

1. **Descriptive Text** - Make hidden text clear and concise
2. **Context Matters** - Include enough information for understanding
3. **Consistent Patterns** - Use similar language for similar actions
4. **Test with Screen Readers** - Verify the experience works as intended
5. **Consider All Users** - Visible labels are often better than hidden ones
6. **Combine with ARIA** - Use with appropriate ARIA attributes when needed
7. **Focus Indicators** - Ensure focusable elements have visible focus styles

#### Advanced: Visible on Focus

```typescript
import { defineComponent } from 'aether';

// Custom implementation for skip links that appear on focus
export const SkipLink = defineComponent<{ href: string; children: any }>((props) => () => (
  <a
    href={props.href}
    class="skip-link"
    style={{
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      borderWidth: '0',
    }}
    onFocus={(e) => {
      const element = e.target as HTMLElement;
      element.style.position = 'fixed';
      element.style.top = '0';
      element.style.left = '0';
      element.style.width = 'auto';
      element.style.height = 'auto';
      element.style.padding = '1rem';
      element.style.margin = '0.5rem';
      element.style.clip = 'auto';
      element.style.whiteSpace = 'normal';
    }}
    onBlur={(e) => {
      const element = e.target as HTMLElement;
      element.style.position = 'absolute';
      element.style.width = '1px';
      element.style.height = '1px';
      element.style.padding = '0';
      element.style.margin = '-1px';
      element.style.clip = 'rect(0, 0, 0, 0)';
      element.style.whiteSpace = 'nowrap';
    }}
  >
    {props.children}
  </a>
));
```

#### Integration with Other Components

VisuallyHidden works well with:
- **Button** - Accessible icon-only buttons
- **Toolbar** - Labeled toolbar actions
- **Dialog** - Additional context for modal actions
- **Toast** - Announce notifications to screen readers
- **Form** - Hidden labels and instructions
- **Table** - Column and row context

#### Testing

When testing components with VisuallyHidden:

```typescript
import { render, screen } from '@testing-library/aether';
import { VisuallyHidden } from 'aether/primitives';

test('provides accessible label', () => {
  render(
    <button>
      <VisuallyHidden>Close dialog</VisuallyHidden>
      <XIcon />
    </button>
  );

  // Text is in the document but not visible
  const closeButton = screen.getByText(/close dialog/i);
  expect(closeButton).toBeInTheDocument();

  // Verify styles hide it visually
  expect(closeButton).toHaveStyle({
    position: 'absolute',
    width: '1px',
    height: '1px',
  });
});
```

---
