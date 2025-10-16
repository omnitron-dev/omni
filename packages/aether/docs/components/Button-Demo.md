# Button Component - Visual Demo & Documentation

A beautiful, production-ready Button component for the Aether UI framework. Built with professional styling, comprehensive variants, and full accessibility support.

## Features

- ✨ **6 Visual Variants**: default, primary, secondary, danger, ghost, link
- 📏 **5 Size Options**: xs, sm, md, lg, xl
- 🎨 **Icon Support**: Left, right, icon-only, loading icons
- ⚡ **Loading States**: Built-in spinner with smooth transitions
- ♿ **Accessibility**: WAI-ARIA compliant with keyboard navigation
- 🎯 **Focus Rings**: Beautiful, accessible focus indicators
- 💅 **Smooth Transitions**: Professional hover and active states
- 📱 **Full Width Option**: Responsive design support
- 🔲 **Icon-Only Buttons**: Perfect square buttons with proper spacing

---

## Variants

### Default Variant
Neutral gray button for standard actions.

```tsx
<Button>Default Button</Button>
<Button leftIcon="save">Save</Button>
<Button rightIcon="arrow-right">Next</Button>
```

**Colors:**
- Background: `#f3f4f6` (gray-100)
- Text: `#111827` (gray-900)
- Border: `#d1d5db` (gray-300)
- Hover: `#e5e7eb` (gray-200)
- Focus Ring: `rgba(107, 114, 128, 0.4)`

---

### Primary Variant
Brand blue button for primary actions.

```tsx
<Button variant="primary">Primary Button</Button>
<Button variant="primary" leftIcon="check">Confirm</Button>
<Button variant="primary" rightIcon="send">Submit</Button>
```

**Colors:**
- Background: `#3b82f6` (blue-500)
- Text: `#ffffff`
- Hover: `#2563eb` (blue-600) + subtle shadow
- Active: `#1d4ed8` (blue-700) + inset shadow
- Focus Ring: `rgba(59, 130, 246, 0.4)`

---

### Secondary Variant
Purple button for secondary actions.

```tsx
<Button variant="secondary">Secondary Button</Button>
<Button variant="secondary" leftIcon="star">Favorite</Button>
<Button variant="secondary" rightIcon="share">Share</Button>
```

**Colors:**
- Background: `#8b5cf6` (purple-500)
- Text: `#ffffff`
- Hover: `#7c3aed` (purple-600) + subtle shadow
- Active: `#6d28d9` (purple-700) + inset shadow
- Focus Ring: `rgba(139, 92, 246, 0.4)`

---

### Danger Variant
Red button for destructive actions.

```tsx
<Button variant="danger">Delete</Button>
<Button variant="danger" leftIcon="trash">Remove</Button>
<Button variant="danger" rightIcon="x">Cancel</Button>
```

**Colors:**
- Background: `#ef4444` (red-500)
- Text: `#ffffff`
- Hover: `#dc2626` (red-600) + subtle shadow
- Active: `#b91c1c` (red-700) + inset shadow
- Focus Ring: `rgba(239, 68, 68, 0.4)`

---

### Ghost Variant
Transparent button with subtle hover state.

```tsx
<Button variant="ghost">Ghost Button</Button>
<Button variant="ghost" leftIcon="settings">Settings</Button>
<Button variant="ghost" rightIcon="more">More</Button>
```

**Colors:**
- Background: `transparent`
- Text: `#374151` (gray-700)
- Hover: `#f3f4f6` (gray-100)
- Active: `#e5e7eb` (gray-200)
- Focus Ring: `rgba(107, 114, 128, 0.4)`

---

### Link Variant
Styled as a hyperlink.

```tsx
<Button variant="link">Link Button</Button>
<Button variant="link" leftIcon="external">Visit Site</Button>
<Button variant="link" rightIcon="arrow-right">Learn More</Button>
```

**Colors:**
- Background: `transparent`
- Text: `#3b82f6` (blue-500)
- Hover: `#2563eb` (blue-600) + underline
- Active: `#1d4ed8` (blue-700)
- Focus: Outline instead of ring

---

## Sizes

### Extra Small (xs)
Compact button for tight spaces.

```tsx
<Button size="xs">Extra Small</Button>
<Button size="xs" icon="plus" aria-label="Add" />
```

**Dimensions:**
- Height: `28px` (1.75rem)
- Padding: `0 10px`
- Font size: `12px` (0.75rem)
- Border radius: `4px` (0.25rem)
- Icon size: `14px` (0.875rem)

---

### Small (sm)
Slightly smaller than default.

```tsx
<Button size="sm">Small Button</Button>
<Button size="sm" icon="edit" aria-label="Edit" />
```

**Dimensions:**
- Height: `32px` (2rem)
- Padding: `0 12px`
- Font size: `13px` (0.8125rem)
- Border radius: `5px` (0.3125rem)
- Icon size: `16px` (1rem)

---

### Medium (md) - Default
Balanced size for most use cases.

```tsx
<Button size="md">Medium Button</Button>
<Button size="md" icon="save" aria-label="Save" />
```

**Dimensions:**
- Height: `40px` (2.5rem)
- Padding: `0 16px`
- Font size: `14px` (0.875rem)
- Border radius: `6px` (0.375rem)
- Icon size: `20px` (1.25rem)

---

### Large (lg)
Prominent button for primary actions.

```tsx
<Button size="lg">Large Button</Button>
<Button size="lg" icon="download" aria-label="Download" />
```

**Dimensions:**
- Height: `48px` (3rem)
- Padding: `0 20px`
- Font size: `16px` (1rem)
- Border radius: `8px` (0.5rem)
- Icon size: `24px` (1.5rem)

---

### Extra Large (xl)
Hero buttons for landing pages.

```tsx
<Button size="xl">Extra Large</Button>
<Button size="xl" icon="rocket" aria-label="Launch" />
```

**Dimensions:**
- Height: `56px` (3.5rem)
- Padding: `0 24px`
- Font size: `18px` (1.125rem)
- Border radius: `10px` (0.625rem)
- Icon size: `28px` (1.75rem)

---

## Icon Support

### Left Icon
Icon positioned before text.

```tsx
<Button leftIcon="save">Save Changes</Button>
<Button variant="primary" leftIcon="check" size="lg">Confirm</Button>
```

### Right Icon
Icon positioned after text.

```tsx
<Button rightIcon="arrow-right">Next Step</Button>
<Button variant="secondary" rightIcon="external" size="sm">Open Link</Button>
```

### Icon-Only
No text, just icon (requires aria-label).

```tsx
<Button icon="plus" aria-label="Add item" />
<Button icon="trash" aria-label="Delete" variant="danger" size="sm" />
<Button icon="settings" aria-label="Settings" variant="ghost" />
```

**Icon-only buttons:**
- Automatically become square (width = height)
- No icon margins
- Require `aria-label` for accessibility

### Loading Icon
Custom loading icon with automatic spin animation.

```tsx
<Button
  loading={isLoading}
  loadingIcon="spinner"
  onClick={handleSubmit}
>
  Submit
</Button>
```

---

## States

### Loading State
Shows spinner and prevents interaction.

```tsx
const isLoading = signal(false);

<Button
  loading={isLoading}
  onClick={async () => {
    isLoading.set(true);
    await performAction();
    isLoading.set(false);
  }}
>
  Submit
</Button>
```

**Behavior:**
- Cursor changes to `wait`
- Pointer events disabled
- Content opacity reduced to 0 (preserves width)
- Loading icon displayed
- `aria-busy="true"` set

---

### Disabled State
Prevents interaction and reduces opacity.

```tsx
<Button disabled>Disabled Button</Button>
<Button variant="primary" disabled>Disabled Primary</Button>
```

**Behavior:**
- Opacity: `0.6`
- Cursor: `not-allowed`
- Pointer events: `none`
- `aria-disabled="true"` set
- `disabled` attribute set for `<button>` elements

---

### Full Width
Button spans entire container width.

```tsx
<Button fullWidth>Full Width Button</Button>
<Button variant="primary" fullWidth size="lg">Sign In</Button>
```

**Behavior:**
- Width: `100%`
- Justify content: `center`

---

## Advanced Examples

### Responsive Button Group

```tsx
<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
  <Button variant="primary" leftIcon="save">Save</Button>
  <Button variant="secondary" leftIcon="download">Download</Button>
  <Button variant="ghost" leftIcon="share">Share</Button>
  <Button variant="danger" icon="trash" aria-label="Delete" />
</div>
```

### Size Comparison

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
  <Button size="xs">XS</Button>
  <Button size="sm">SM</Button>
  <Button size="md">MD</Button>
  <Button size="lg">LG</Button>
  <Button size="xl">XL</Button>
</div>
```

### All Variants

```tsx
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
  <Button>Default</Button>
  <Button variant="primary">Primary</Button>
  <Button variant="secondary">Secondary</Button>
  <Button variant="danger">Danger</Button>
  <Button variant="ghost">Ghost</Button>
  <Button variant="link">Link</Button>
</div>
```

### Icon-Only Toolbar

```tsx
<div style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem', backgroundColor: '#f3f4f6', borderRadius: '0.5rem' }}>
  <Button icon="bold" aria-label="Bold" variant="ghost" size="sm" />
  <Button icon="italic" aria-label="Italic" variant="ghost" size="sm" />
  <Button icon="underline" aria-label="Underline" variant="ghost" size="sm" />
  <Button icon="link" aria-label="Insert Link" variant="ghost" size="sm" />
</div>
```

### Loading Example with State

```tsx
import { signal } from '@omnitron-dev/aether';

function AsyncForm() {
  const isSubmitting = signal(false);

  const handleSubmit = async () => {
    isSubmitting.set(true);
    try {
      await fetch('/api/submit', { method: 'POST' });
    } finally {
      isSubmitting.set(false);
    }
  };

  return (
    <Button
      variant="primary"
      loading={isSubmitting}
      onClick={handleSubmit}
      fullWidth
      size="lg"
    >
      Submit Form
    </Button>
  );
}
```

---

## Accessibility

The Button component is fully accessible and follows WAI-ARIA best practices:

### Keyboard Navigation
- `Enter` or `Space` activates the button
- `Tab` moves focus to/from the button
- Focus ring clearly indicates keyboard focus

### ARIA Attributes
- `role="button"` for non-button elements
- `aria-disabled="true"` when disabled
- `aria-busy="true"` when loading
- `aria-label` required for icon-only buttons
- `aria-expanded`, `aria-pressed` supported for toggle buttons

### Screen Reader Support
- Clear button purpose via text or aria-label
- Loading state announced via aria-busy
- Disabled state announced via aria-disabled

---

## Performance

- **Zero Runtime Overhead**: Styles injected at build time
- **Tree Shakeable**: Only used variants included in bundle
- **Optimized Transitions**: GPU-accelerated animations
- **Minimal Re-renders**: Reactive props only update when changed

---

## Design Tokens

### Color Palette
```css
/* Gray Scale */
--gray-100: #f3f4f6;
--gray-200: #e5e7eb;
--gray-300: #d1d5db;
--gray-700: #374151;
--gray-900: #111827;

/* Blue (Primary) */
--blue-500: #3b82f6;
--blue-600: #2563eb;
--blue-700: #1d4ed8;

/* Purple (Secondary) */
--purple-500: #8b5cf6;
--purple-600: #7c3aed;
--purple-700: #6d28d9;

/* Red (Danger) */
--red-500: #ef4444;
--red-600: #dc2626;
--red-700: #b91c1c;
```

### Shadows
```css
/* Hover Shadow */
box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);

/* Active Shadow */
box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);

/* Focus Ring */
box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4); /* varies by variant */
```

### Timing
```css
/* Transitions */
transition: all 0.15s ease;
```

---

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- iOS Safari 14+
- Android Chrome 90+

---

## Bundle Size

- **Core Button**: ~6KB (minified + gzipped)
- **With all variants**: ~8KB (minified + gzipped)
- **Icon support**: No additional size (uses Aether's Icon system)

---

## Comparison with Other Libraries

| Feature | Aether Button | Chakra UI | shadcn/ui | MUI |
|---------|--------------|-----------|-----------|-----|
| Bundle Size | 6-8KB | 15KB | 10KB | 25KB |
| Variants | 6 | 6 | 5 | 6 |
| Sizes | 5 | 4 | 4 | 3 |
| Icon Support | ✅ Built-in | ✅ Manual | ✅ Manual | ✅ Built-in |
| Loading State | ✅ Built-in | ✅ Built-in | ⚠️ Manual | ✅ Built-in |
| Accessibility | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Reactivity | ✅ Signals | ❌ Re-render | ❌ Re-render | ❌ Re-render |

---

## Credits

Designed and built for the Aether UI framework by the Omnitron team.

Inspired by:
- [Chakra UI](https://chakra-ui.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Radix UI](https://www.radix-ui.com/)
- [MUI](https://mui.com/)
