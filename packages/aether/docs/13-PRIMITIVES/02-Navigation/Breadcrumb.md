### Breadcrumb

A navigation breadcrumb component that shows the user's current location within the site hierarchy. Breadcrumbs provide a trail of links back to the root page, helping users understand where they are and navigate back through parent pages.

#### Features

- Semantic navigation structure
- ARIA breadcrumb pattern
- Current page indication
- Customizable separators
- Collapsible/truncated breadcrumbs
- Link and text items
- Disabled state support
- Accessible navigation landmark

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Breadcrumb } from 'aether/primitives';

const Example = defineComponent(() => {
  return () => (
    <Breadcrumb>
      <Breadcrumb.List>
        <Breadcrumb.Item>
          <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
        </Breadcrumb.Item>
        <Breadcrumb.Separator />
        <Breadcrumb.Item>
          <Breadcrumb.Link href="/products">Products</Breadcrumb.Link>
        </Breadcrumb.Item>
        <Breadcrumb.Separator />
        <Breadcrumb.Item currentPage>
          <Breadcrumb.Page>Laptop</Breadcrumb.Page>
        </Breadcrumb.Item>
      </Breadcrumb.List>
    </Breadcrumb>
  );
});
```

#### With Custom Separator

```typescript
const Example = defineComponent(() => {
  return () => (
    <Breadcrumb>
      <Breadcrumb.List>
        <Breadcrumb.Item>
          <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
        </Breadcrumb.Item>
        <Breadcrumb.Separator>→</Breadcrumb.Separator>
        <Breadcrumb.Item>
          <Breadcrumb.Link href="/blog">Blog</Breadcrumb.Link>
        </Breadcrumb.Item>
        <Breadcrumb.Separator>→</Breadcrumb.Separator>
        <Breadcrumb.Item currentPage>
          <Breadcrumb.Page>Article Title</Breadcrumb.Page>
        </Breadcrumb.Item>
      </Breadcrumb.List>
    </Breadcrumb>
  );
});
```

#### With Icons

```typescript
const Example = defineComponent(() => {
  return () => (
    <Breadcrumb>
      <Breadcrumb.List>
        <Breadcrumb.Item>
          <Breadcrumb.Link href="/">
            <HomeIcon />
            Home
          </Breadcrumb.Link>
        </Breadcrumb.Item>
        <Breadcrumb.Separator />
        <Breadcrumb.Item>
          <Breadcrumb.Link href="/docs">
            <BookIcon />
            Documentation
          </Breadcrumb.Link>
        </Breadcrumb.Item>
        <Breadcrumb.Separator />
        <Breadcrumb.Item currentPage>
          <Breadcrumb.Page>
            <FileIcon />
            Getting Started
          </Breadcrumb.Page>
        </Breadcrumb.Item>
      </Breadcrumb.List>
    </Breadcrumb>
  );
});
```

#### Collapsed Breadcrumbs

```typescript
import { defineComponent, signal, For } from 'aether';

const Example = defineComponent(() => {
  const showAll = signal(false);

  const allItems = [
    { href: '/', label: 'Home' },
    { href: '/docs', label: 'Docs' },
    { href: '/docs/guides', label: 'Guides' },
    { href: '/docs/guides/components', label: 'Components' },
    { label: 'Breadcrumb', current: true },
  ];

  return () => {
    const items = showAll() ? allItems : [
      allItems[0],
      { label: '...', collapsed: true },
      allItems[allItems.length - 1],
    ];

    return (
      <Breadcrumb>
        <Breadcrumb.List>
          <For each={items}>
            {(item, index) => (
              <>
                {item.collapsed ? (
                  <Breadcrumb.Item>
                    <button onClick={() => showAll.set(true)}>...</button>
                  </Breadcrumb.Item>
                ) : item.current ? (
                  <Breadcrumb.Item currentPage>
                    <Breadcrumb.Page>{item.label}</Breadcrumb.Page>
                  </Breadcrumb.Item>
                ) : (
                  <Breadcrumb.Item>
                    <Breadcrumb.Link href={item.href}>
                      {item.label}
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                )}
                {index() < items.length - 1 && <Breadcrumb.Separator />}
              </>
            )}
          </For>
        </Breadcrumb.List>
      </Breadcrumb>
    );
  };
});
```

#### Responsive Breadcrumbs

```typescript
const Example = defineComponent(() => {
  const isMobile = signal(window.innerWidth < 768);

  // Listen for resize
  window.addEventListener('resize', () => {
    isMobile.set(window.innerWidth < 768);
  });

  const breadcrumbs = [
    { href: '/', label: 'Home' },
    { href: '/category', label: 'Category' },
    { href: '/subcategory', label: 'Subcategory' },
    { label: 'Current Page', current: true },
  ];

  return () => (
    <Breadcrumb>
      <Breadcrumb.List>
        {isMobile() ? (
          // Mobile: Show only back button
          <>
            <Breadcrumb.Item>
              <Breadcrumb.Link href={breadcrumbs[breadcrumbs.length - 2].href}>
                ← Back
              </Breadcrumb.Link>
            </Breadcrumb.Item>
          </>
        ) : (
          // Desktop: Show full breadcrumb trail
          <For each={breadcrumbs}>
            {(item, index) => (
              <>
                {item.current ? (
                  <Breadcrumb.Item currentPage>
                    <Breadcrumb.Page>{item.label}</Breadcrumb.Page>
                  </Breadcrumb.Item>
                ) : (
                  <Breadcrumb.Item>
                    <Breadcrumb.Link href={item.href}>
                      {item.label}
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                )}
                {index() < breadcrumbs.length - 1 && <Breadcrumb.Separator />}
              </>
            )}
          </For>
        )}
      </Breadcrumb.List>
    </Breadcrumb>
  );
});
```

#### Styling Example

```css
/* Breadcrumb container */
[data-breadcrumb] {
  padding: var(--spacing-4);
}

/* Breadcrumb list */
[data-breadcrumb-list] {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  list-style: none;
  margin: 0;
  padding: 0;
}

/* Breadcrumb item */
[data-breadcrumb-item] {
  display: inline-flex;
  align-items: center;
}

/* Current page item */
[data-breadcrumb-item][data-current] {
  font-weight: 600;
}

/* Breadcrumb link */
[data-breadcrumb-link] {
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: color 0.2s;
}

[data-breadcrumb-link]:hover {
  color: var(--color-primary);
  text-decoration: underline;
}

[data-breadcrumb-link][data-disabled] {
  color: var(--color-text-disabled);
  cursor: not-allowed;
  pointer-events: none;
}

/* Current page text */
[data-breadcrumb-page] {
  color: var(--color-text-primary);
  font-weight: 500;
}

/* Separator */
[data-breadcrumb-separator] {
  color: var(--color-text-tertiary);
  user-select: none;
}
```

#### API Reference

**`<Breadcrumb>`** - Root navigation container

Props:
- `aria-label?: string` - ARIA label for navigation (default: 'Breadcrumb')
- Standard HTML attributes

**`<Breadcrumb.List>`** - Ordered list container for breadcrumb items

Props:
- Standard HTML `<ol>` attributes

**`<Breadcrumb.Item>`** - Individual breadcrumb item

Props:
- `currentPage?: boolean` - Indicates if this is the current page
- Standard HTML `<li>` attributes

Accessibility:
- Sets `aria-current="page"` when `currentPage` is true
- Adds `data-current` attribute for styling

**`<Breadcrumb.Link>`** - Link within a breadcrumb item

Props:
- `href?: string` - Link destination
- `disabled?: boolean` - Disables the link
- `onClick?: (e: Event) => void` - Click handler
- Standard HTML `<a>` attributes

Accessibility:
- Sets `aria-disabled="true"` when disabled
- Prevents navigation when disabled

**`<Breadcrumb.Page>`** - Current page text (not a link)

Props:
- Standard HTML `<span>` attributes

Accessibility:
- Always has `aria-current="page"`

**`<Breadcrumb.Separator>`** - Visual separator between items

Props:
- `children?: any` - Separator content (default: '/')
- Standard HTML `<li>` attributes

Accessibility:
- Has `role="presentation"` and `aria-hidden="true"`
- Not exposed to screen readers

#### Accessibility

The Breadcrumb component follows the ARIA breadcrumb pattern:

- Uses `<nav>` with `aria-label="Breadcrumb"` for the container
- Uses `<ol>` for semantic ordered list
- Current page has `aria-current="page"`
- Separators are hidden from screen readers
- Keyboard navigation works with standard link behavior

#### Best Practices

1. **Always indicate current page**: Use `currentPage` prop and `Breadcrumb.Page` for the last item
2. **Keep breadcrumbs short**: Show only necessary levels, consider collapsing on long paths
3. **Use consistent separators**: Stick to one separator style throughout your application
4. **Make links meaningful**: Link text should clearly indicate the destination
5. **Consider mobile**: On small screens, consider showing only a back button
6. **Don't duplicate**: Don't include breadcrumbs if you have other persistent navigation showing the same path
7. **Start with home**: First breadcrumb should typically link to the root/home page
8. **Order matters**: Breadcrumbs should reflect the actual site hierarchy

---

