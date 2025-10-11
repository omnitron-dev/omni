### Spinner

**Loading spinner component with multiple variants and sizes.**

**Features:**
- Multiple sizes (xs, sm, md, lg, xl)
- Multiple visual variants (circular, dots, bars)
- Animation speed control (slow, normal, fast)
- Label support for screen readers
- Optional visible label
- Color variants support
- ARIA live region for loading state

**Basic Usage:**

```tsx
<Spinner size="md" variant="circular" label="Loading..." />
```

**Advanced Usage:**

```tsx
// Full-page loading overlay
<Show when={isLoading()}>
  <div class="loading-overlay">
    <div class="loading-content">
      <Spinner
        size="xl"
        variant="circular"
        speed="normal"
        label="Loading application..."
        showLabel={true}
      />
    </div>
  </div>
</Show>

// Inline button loading state
<button disabled={isSaving()}>
  <Show
    when={isSaving()}
    fallback={<>Save Changes</>}
  >
    <Spinner size="sm" variant="dots" label="Saving..." />
    <span>Saving...</span>
  </Show>
</button>

// Data loading indicator
<div class="data-section">
  <Show
    when={!isLoadingData()}
    fallback={
      <div class="data-loading">
        <Spinner
          size="lg"
          variant="bars"
          label="Loading data..."
          showLabel={true}
        />
      </div>
    }
  >
    {/* Data content */}
  </Show>
</div>
```

**API:**

**`<Spinner>`** - Loading spinner
- `size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'` - Spinner size (default: 'md')
- `variant?: 'circular' | 'dots' | 'bars'` - Visual style (default: 'circular')
- `label?: string` - Accessibility label (default: 'Loading...')
- `speed?: 'slow' | 'normal' | 'fast'` - Animation speed (default: 'normal')
- `showLabel?: boolean` - Show label visibly (default: false)

---

