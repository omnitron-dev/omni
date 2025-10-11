### Empty

**Empty state component for displaying no-data scenarios.**

**Features:**
- Icon support for visual context
- Title and description text
- Action buttons support
- Customizable layout
- Pre-built variants (no-data, no-results, error, custom)
- ARIA live region for status updates

**Basic Usage:**

```tsx
<Empty variant="no-data">
  <Empty.Icon>📭</Empty.Icon>
  <Empty.Title>No data available</Empty.Title>
  <Empty.Description>
    There is no data to display at this time.
  </Empty.Description>
  <Empty.Actions>
    <button onClick={loadData}>Load Data</button>
  </Empty.Actions>
</Empty>
```

**Advanced Usage:**

```tsx
// Search results empty state
<Show
  when={searchResults().length > 0}
  fallback={
    <Empty variant="no-results" class="search-empty">
      <Empty.Icon class="empty-icon">
        <SearchIcon size={64} />
      </Empty.Icon>

      <Empty.Title class="empty-title">
        No results found for "{searchQuery()}"
      </Empty.Title>

      <Empty.Description class="empty-description">
        We couldn't find any results matching your search.
        Try adjusting your search terms or filters.
      </Empty.Description>

      <Empty.Actions class="empty-actions">
        <button onClick={clearSearch} class="btn-secondary">
          Clear Search
        </button>
        <button onClick={showFilters} class="btn-primary">
          Adjust Filters
        </button>
      </Empty.Actions>
    </Empty>
  }
>
  {/* Results content */}
</Show>

// Error state with retry
<Empty variant="error" class="error-state">
  <Empty.Icon>⚠️</Empty.Icon>
  <Empty.Title>Failed to load data</Empty.Title>
  <Empty.Description>
    {errorMessage()}
  </Empty.Description>
  <Empty.Actions>
    <button onClick={retryLoad}>Retry</button>
    <button onClick={goBack}>Go Back</button>
  </Empty.Actions>
</Empty>
```

**API:**

**`<Empty>`** - Root container
- `variant?: 'no-data' | 'no-results' | 'error' | 'custom'` - Visual variant (default: 'no-data')

**`<Empty.Icon>`** - Icon container (typically emoji or SVG)

**`<Empty.Title>`** - Title text (h3 element)

**`<Empty.Description>`** - Description text (p element)

**`<Empty.Actions>`** - Action buttons container

---

