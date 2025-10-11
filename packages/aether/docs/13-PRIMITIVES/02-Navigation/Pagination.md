### Pagination

A pagination component for navigating through pages of content. Provides controls for moving between pages with support for boundaries, sibling pages, and ellipsis for large page counts.

#### Features

- Configurable page display logic
- Boundary pages (first/last)
- Sibling page controls
- Ellipsis for large page ranges
- Previous/Next navigation
- Custom render functions
- Keyboard accessible
- ARIA pagination pattern
- Controlled component
- Flexible item rendering

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Pagination } from 'aether/primitives';

const Example = defineComponent(() => {
  const currentPage = signal(1);
  const totalPages = 10;

  return () => (
    <Pagination
      currentPage={currentPage()}
      totalPages={totalPages}
      onPageChange={(page) => currentPage.set(page)}
    >
      <Pagination.Previous />
      <Pagination.Items />
      <Pagination.Next />
    </Pagination>
  );
});
```

#### With Boundary Controls

```typescript
const Example = defineComponent(() => {
  const currentPage = signal(5);

  return () => (
    <Pagination
      currentPage={currentPage()}
      totalPages={20}
      siblingCount={1}
      showFirstLast={true}
      onPageChange={(page) => currentPage.set(page)}
    >
      <div class="pagination-controls">
        <Pagination.Previous>Previous</Pagination.Previous>
        <Pagination.Items />
        <Pagination.Next>Next</Pagination.Next>
      </div>
    </Pagination>
  );
});
```

#### Compact Pagination

```typescript
const Example = defineComponent(() => {
  const currentPage = signal(1);

  return () => (
    <Pagination
      currentPage={currentPage()}
      totalPages={100}
      siblingCount={0}  // No siblings, just current page
      showFirstLast={true}
      onPageChange={(page) => currentPage.set(page)}
    >
      <div class="compact-pagination">
        <Pagination.Previous>←</Pagination.Previous>
        <Pagination.Items />
        <Pagination.Next>→</Pagination.Next>
      </div>
    </Pagination>
  );
});
```

#### With Custom Item Rendering

```typescript
const Example = defineComponent(() => {
  const currentPage = signal(1);

  const renderItem = (page: number, isCurrent: boolean) => (
    <button
      class={isCurrent ? 'page-btn active' : 'page-btn'}
      aria-current={isCurrent ? 'page' : undefined}
    >
      {page}
    </button>
  );

  const renderEllipsis = () => (
    <span class="page-ellipsis">...</span>
  );

  return () => (
    <Pagination
      currentPage={currentPage()}
      totalPages={50}
      siblingCount={2}
      onPageChange={(page) => currentPage.set(page)}
    >
      <div class="custom-pagination">
        <Pagination.Previous>Previous</Pagination.Previous>
        <Pagination.Items
          renderItem={renderItem}
          renderEllipsis={renderEllipsis}
        />
        <Pagination.Next>Next</Pagination.Next>
      </div>
    </Pagination>
  );
});
```

#### With Page Size Selector

```typescript
const Example = defineComponent(() => {
  const currentPage = signal(1);
  const pageSize = signal(10);
  const totalItems = 500;

  const totalPages = () => Math.ceil(totalItems / pageSize());

  const handlePageSizeChange = (e: Event) => {
    const target = e.target as HTMLSelectElement;
    pageSize.set(parseInt(target.value));
    currentPage.set(1); // Reset to first page
  };

  return () => (
    <div class="pagination-wrapper">
      <Pagination
        currentPage={currentPage()}
        totalPages={totalPages()}
        onPageChange={(page) => currentPage.set(page)}
      >
        <Pagination.Previous />
        <Pagination.Items />
        <Pagination.Next />
      </Pagination>

      <div class="page-size-selector">
        <label for="page-size">Items per page:</label>
        <select
          id="page-size"
          value={pageSize()}
          onChange={handlePageSizeChange}
        >
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>

      <div class="page-info">
        Showing {(currentPage() - 1) * pageSize() + 1} to{' '}
        {Math.min(currentPage() * pageSize(), totalItems)} of {totalItems} items
      </div>
    </div>
  );
});
```

#### Server-Side Pagination

```typescript
import { defineComponent, signal } from 'aether';
import { Pagination } from 'aether/primitives';

interface PaginatedData {
  items: any[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
}

const Example = defineComponent(() => {
  const data = signal<PaginatedData>({
    items: [],
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
  });
  const loading = signal(false);

  const fetchPage = async (page: number) => {
    loading.set(true);
    try {
      const response = await fetch(`/api/items?page=${page}&limit=20`);
      const result = await response.json();
      data.set(result);
    } catch (error) {
      console.error('Failed to fetch page:', error);
    } finally {
      loading.set(false);
    }
  };

  // Initial load
  fetchPage(1);

  const handlePageChange = (page: number) => {
    fetchPage(page);
  };

  return () => (
    <div>
      {loading() && <div class="loading-spinner">Loading...</div>}

      <div class="items-grid">
        <For each={data().items}>
          {(item) => <div class="item">{item.name}</div>}
        </For>
      </div>

      <Pagination
        currentPage={data().currentPage}
        totalPages={data().totalPages}
        onPageChange={handlePageChange}
      >
        <Pagination.Previous />
        <Pagination.Items />
        <Pagination.Next />
      </Pagination>
    </div>
  );
});
```

#### Styling Example

```css
/* Pagination container */
[data-pagination] {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-4);
}

/* Pagination items container */
[data-pagination-items] {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
}

/* Page number button */
[data-pagination-item] {
  min-width: 40px;
  height: 40px;
  padding: var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-background);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s;
}

[data-pagination-item]:hover:not(:disabled) {
  background: var(--color-background-hover);
  border-color: var(--color-primary);
}

[data-pagination-item][data-current] {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
  font-weight: 600;
  cursor: default;
}

[data-pagination-item]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Previous/Next buttons */
[data-pagination-previous],
[data-pagination-next] {
  min-width: 80px;
  height: 40px;
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-background);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s;
}

[data-pagination-previous]:hover:not(:disabled),
[data-pagination-next]:hover:not(:disabled) {
  background: var(--color-background-hover);
  border-color: var(--color-primary);
}

[data-pagination-previous]:disabled,
[data-pagination-next]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Ellipsis */
[data-pagination-ellipsis] {
  padding: var(--spacing-2);
  color: var(--color-text-tertiary);
  user-select: none;
}
```

#### API Reference

**`<Pagination>`** - Root pagination container

Props:
- `currentPage: number` - Current active page (1-indexed, required)
- `totalPages: number` - Total number of pages (required)
- `siblingCount?: number` - Number of page buttons to show on each side of current page (default: 1)
- `showFirstLast?: boolean` - Always show first and last page (default: true)
- `showPrevNext?: boolean` - Show previous/next buttons (default: true)
- `onPageChange?: (page: number) => void` - Page change handler
- Standard HTML attributes

Context Provided:
- Current page state
- Total pages
- Navigation functions
- Page number generation

**`<Pagination.Items>`** - Renders page number buttons with ellipsis

Props:
- `renderItem?: (page: number, isCurrent: boolean) => any` - Custom render function for page buttons
- `renderEllipsis?: () => any` - Custom render function for ellipsis
- Standard HTML attributes

Default Behavior:
- Renders clickable page buttons
- Shows ellipsis for gaps
- Highlights current page
- Disables current page button

**`<Pagination.Previous>`** - Previous page button

Props:
- `children?: any` - Button content (default: 'Previous')
- Standard HTML `<button>` attributes

Behavior:
- Automatically disabled when on first page
- Has `aria-label="Go to previous page"`

**`<Pagination.Next>`** - Next page button

Props:
- `children?: any` - Button content (default: 'Next')
- Standard HTML `<button>` attributes

Behavior:
- Automatically disabled when on last page
- Has `aria-label="Go to next page"`

#### Page Number Generation

The component intelligently generates page numbers based on:

1. **Total pages**: If total pages ≤ 7, show all pages
2. **Current position**: Show siblings around current page
3. **Boundaries**: Optionally show first and last pages
4. **Ellipsis**: Fill gaps with ellipsis indicators

Examples:
- 10 pages, page 1, siblings 1: `[1] 2 ... 10`
- 10 pages, page 5, siblings 1: `1 ... 4 [5] 6 ... 10`
- 10 pages, page 10, siblings 1: `1 ... 9 [10]`

#### Accessibility

The Pagination component follows the ARIA pagination pattern:

- Uses `<nav>` with `role="navigation"` and `aria-label="Pagination"`
- Page buttons have `aria-label` describing page numbers
- Current page has `aria-current="page"`
- Disabled buttons have `disabled` attribute
- Ellipsis has `aria-hidden="true"`
- Keyboard navigation works with standard button behavior

#### Best Practices

1. **Always controlled**: Pagination requires `currentPage` and `onPageChange` props
2. **Reset on filters**: When applying filters, reset to page 1
3. **Show page info**: Display "Showing X to Y of Z items" for context
4. **Reasonable page sizes**: Don't show too many or too few items per page
5. **Loading states**: Show loading indicator during page transitions
6. **Preserve scroll**: Consider scrolling to top when changing pages
7. **URL sync**: For public pages, sync current page with URL query params
8. **Mobile friendly**: Use compact pagination on small screens
9. **Sibling count**: Adjust `siblingCount` based on available space
10. **Server-side**: For large datasets, implement server-side pagination

---

