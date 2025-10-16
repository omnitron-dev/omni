# Aether Icon API - Quick Reference

**Fast reference for the most common icon API patterns**

## Basic Usage

```tsx
import { Icon, Button } from '@omnitron-dev/aether';

// Icon component
<Icon name="heart" />
<Icon name="heart" size="lg" color="red" />
<Icon name="heart" animation="pulse" />

// Button with icons
<Button icon="save">Save</Button>
<Button leftIcon="arrow-left" rightIcon="arrow-right">Next</Button>
<Button icon="trash" aria-label="Delete" />
```

---

## Icon Presets

```tsx
// stroke (default) - outline icons
<Icon name="user" preset="stroke" />

// duotone - two-tone with fill and stroke
<Icon name="user" preset="duotone" />

// twotone - selective opacity
<Icon name="user" preset="twotone" />
```

---

## Icon Sizes

```tsx
// Preset sizes
<Icon name="heart" size="xs" />  // 14px
<Icon name="heart" size="sm" />  // 16px
<Icon name="heart" size="md" />  // 20px (default)
<Icon name="heart" size="lg" />  // 24px
<Icon name="heart" size="xl" />  // 28px

// Custom size
<Icon name="heart" size={32} />
```

---

## Animations

```tsx
// Interactive animations
<Icon name="star" animation="hover" />      // Scale on hover
<Icon name="bookmark" animation="click" />  // Scale on click

// Continuous animations
<Icon name="refresh" animation="spin" />    // Continuous rotation
<Icon name="loader" animation="loading" />  // Loading indicator
<Icon name="heart" animation="pulse" />     // Pulse scale + opacity
<Icon name="arrow-down" animation="bounce" /> // Bounce up and down

// No animation
<Icon name="heart" animation="none" />
```

---

## Animation Customization

```tsx
// Custom duration (in seconds)
<Icon name="refresh" animation="spin" animationDuration={1} />

// Custom timing function
<Icon name="heart" animation="pulse" animationTiming="ease-in-out" />

// Limited iterations (instead of infinite)
<Icon name="bell" animation="bounce" animationIterations={3} />
```

---

## Colors

```tsx
// Named colors
<Icon name="heart" color="red" />

// Hex colors
<Icon name="heart" color="#ff0000" />

// CSS variables
<Icon name="heart" color="var(--primary-color)" />

// currentColor (default)
<Icon name="heart" color="currentColor" />
```

---

## Transformations

```tsx
// Rotation (degrees)
<Icon name="arrow-right" rotate={45} />
<Icon name="arrow-right" rotate={90} />
<Icon name="arrow-right" rotate={180} />

// Flip
<Icon name="arrow-right" flip="horizontal" />
<Icon name="arrow-up" flip="vertical" />
<Icon name="image" flip="both" />

// Custom transform
<Icon name="star" transform="scale(1.5) translateX(10px)" />
```

---

## Button Integration

```tsx
// Simple icon
<Button icon="save">Save</Button>

// With preset and animation
<Button icon={{ name: "save", preset: "duotone", animation: "hover" }}>
  Save
</Button>

// Multiple icons
<Button leftIcon="save" rightIcon="arrow-right">
  Save and Continue
</Button>

// Loading state
<Button
  loading={isLoading}
  loadingIcon={{ name: "loader", animation: "loading" }}
>
  Processing...
</Button>

// Icon-only button (requires aria-label)
<Button icon="trash" aria-label="Delete item" />

// Global icon defaults
<Button
  icon="user"
  leftIcon="bell"
  iconPreset="stroke"
  iconSize="sm"
  iconColor="blue"
>
  Notifications
</Button>
```

---

## Object-Based Configuration

```tsx
// Full control via object
<Icon
  name="user"
  preset="duotone"
  size="lg"
  color="blue"
  animation="hover"
  animationDuration={0.3}
  rotate={45}
  className="custom-icon"
  style={{ margin: '0 8px' }}
/>

// Same with Button
<Button
  icon={{
    name: "save",
    preset: "stroke",
    animation: "hover",
    size: "lg",
  }}
>
  Save
</Button>
```

---

## Accessibility

```tsx
// Icon with label (meaningful icon)
<Icon name="warning" label="Warning" />

// Decorative icon (hidden from screen readers)
<Icon name="sparkle" decorative />

// Icon-only button with label
<Button icon="trash" aria-label="Delete item" />

// Icon with description
<Icon
  name="info"
  aria-label="Information"
  aria-describedby="info-tooltip"
/>
```

---

## Reactive Icons

```tsx
import { signal, computed } from '@omnitron-dev/aether';

// Reactive color
const likeColor = signal("gray");

<Icon
  name="heart"
  color={likeColor}
  onClick={() => likeColor.set("red")}
/>

// Reactive rotation
const rotation = signal(0);

<Icon
  name="arrow-right"
  rotate={rotation}
  onClick={() => rotation.set((rotation() + 45) % 360)}
/>

// Reactive animation
const isActive = signal(false);

<Icon
  name="bell"
  animation={computed(() => isActive() ? "pulse" : "none")}
  onClick={() => isActive.set(!isActive())}
/>
```

---

## Icon Provider (Global Defaults)

```tsx
import { IconProvider } from '@omnitron-dev/aether';

// App-wide defaults
<IconProvider
  defaultPreset="stroke"
  defaultSize="md"
  defaultColor="currentColor"
>
  <App />
</IconProvider>

// Section-specific overrides
<IconProvider
  defaultPreset="duotone"
  defaultAnimation="hover"
>
  <DashboardSection />
</IconProvider>
```

---

## CSS Animation Classes

```tsx
// For custom styling or direct HTML usage

// Continuous animations
className="aether-icon-spin"           // Standard spin
className="aether-icon-spin-fast"      // Fast spin (1s)
className="aether-icon-spin-slow"      // Slow spin (3s)
className="aether-icon-pulse"          // Pulse animation
className="aether-icon-bounce"         // Bounce animation
className="aether-icon-loading"        // Loading animation

// Hover animations
className="aether-icon-hover"          // Scale on hover
className="aether-icon-hover-bounce"   // Bounce on hover
className="aether-icon-hover-shake"    // Shake on hover
className="aether-icon-hover-rotate"   // Rotate on hover

// Click animations
className="aether-icon-click-flash"    // Flash on click
className="aether-icon-click-scale"    // Scale on click

// Size classes
className="aether-icon-xs"             // 14px
className="aether-icon-sm"             // 16px
className="aether-icon-md"             // 20px
className="aether-icon-lg"             // 24px
className="aether-icon-xl"             // 28px

// Position classes
className="aether-icon-left"           // Left margin
className="aether-icon-right"          // Right margin
className="aether-icon-top"            // Top margin
className="aether-icon-bottom"         // Bottom margin
```

---

## Data Attributes (Headless Styling)

```tsx
// Icons automatically get data attributes
<svg
  data-icon="user"
  data-icon-preset="stroke"
  data-icon-animation="hover"
  data-icon-position="left"
>
  ...
</svg>

// Style with data attributes
[data-icon-animation="spin"] { /* ... */ }
[data-icon-preset="duotone"] { /* ... */ }
[data-icon-position="left"] { /* ... */ }
```

---

## Common Patterns

### Loading Button
```tsx
const isLoading = signal(false);

<Button
  loading={isLoading}
  loadingIcon={{ name: "loader", animation: "loading" }}
  onClick={async () => {
    isLoading.set(true);
    await performAction();
    isLoading.set(false);
  }}
>
  Submit
</Button>
```

### Play/Pause Toggle
```tsx
const isPlaying = signal(false);

<Button
  icon={computed(() => isPlaying() ? "pause" : "play")}
  onClick={() => isPlaying.set(!isPlaying())}
>
  {() => isPlaying() ? "Pause" : "Play"}
</Button>
```

### Like Button
```tsx
const isLiked = signal(false);

<Button
  icon={{
    name: "heart",
    color: computed(() => isLiked() ? "red" : "gray"),
    animation: "click",
  }}
  onClick={() => isLiked.set(!isLiked())}
  aria-label={computed(() => isLiked() ? "Unlike" : "Like")}
/>
```

### Icon with Tooltip
```tsx
<Tooltip content="Download file">
  <Button
    icon={{ name: "download", animation: "hover" }}
    aria-label="Download"
  />
</Tooltip>
```

### Alert with Icon
```tsx
<Alert
  type="success"
  icon={{ name: "check-circle", preset: "stroke" }}
>
  Your changes have been saved!
</Alert>
```

---

## TypeScript Types

```tsx
import type {
  IconProp,         // string | IconConfig
  IconConfig,       // Full config object
  IconPreset,       // 'stroke' | 'duotone' | 'twotone'
  IconAnimation,    // 'hover' | 'click' | 'loading' | ...
  IconSize,         // 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
  IconPosition,     // 'left' | 'right' | 'top' | 'bottom'
  IconSlots,        // For component integration
} from '@omnitron-dev/aether';

// Use in components
interface MyComponentProps {
  icon?: IconProp;
  leftIcon?: IconProp;
  rightIcon?: IconProp;
}
```

---

## Utility Functions

```tsx
import {
  normalizeIcon,              // Convert IconProp to IconConfig
  resolveIconSize,           // Resolve size to pixels
  buildIconClasses,          // Build CSS classes
  buildIconDataAttributes,   // Build data attributes
  buildIconStyles,           // Build inline styles
  createIconConfig,          // Create config from string/object
  isIconConfig,              // Check if value is IconConfig
  validateIconConfig,        // Validate configuration
} from '@omnitron-dev/aether';

// Normalize icon prop
const config = normalizeIcon('user', { preset: 'duotone' });
// => { name: 'user', preset: 'duotone', animation: 'none', ... }

// Resolve size
const size = resolveIconSize('lg');
// => 24

// Build classes
const classes = buildIconClasses({ name: 'user', animation: 'hover' });
// => 'aether-icon aether-icon-hover'
```

---

## Search & Discovery

```tsx
import { searchIcons } from '@omnitron-dev/aether';

// Search for icons
const results = await searchIcons({
  query: 'arrow',
  preset: 'stroke',
  limit: 10,
});

// Display results
results.forEach(icon => {
  console.log(icon.name, icon.preset, icon.relevance);
});
```

---

## Performance Tips

1. **Use strings for simple cases** - Faster than objects
   ```tsx
   <Icon name="user" />  // ✅ Fast
   <Icon name="user" {...config} />  // ⚠️ Slower
   ```

2. **Preload critical icons**
   ```tsx
   import { getIconRegistry } from '@omnitron-dev/aether';
   const registry = getIconRegistry();
   await registry.preload(['home', 'user', 'settings']);
   ```

3. **Use decorative prop** for decorative icons
   ```tsx
   <Icon name="sparkle" decorative />  // Reduces ARIA overhead
   ```

4. **Avoid unnecessary animations**
   ```tsx
   <Icon name="user" />  // ✅ No animation by default
   <Icon name="user" animation="pulse" />  // ⚠️ Only if needed
   ```

---

## Browser Support

- ✅ All modern browsers (Chrome, Firefox, Safari, Edge)
- ✅ CSS animations with GPU acceleration
- ✅ Automatic fallback for `prefers-reduced-motion`
- ✅ SVG with proper accessibility attributes

---

## Related Documentation

- **Full API Documentation**: `ICON_API.md`
- **Design Rationale**: `ICON_API_DESIGN_RATIONALE.md`
- **Integration Examples**: `ICON_INTEGRATION_EXAMPLES.md`

---

## Quick Start Template

```tsx
import { Icon, Button, IconProvider } from '@omnitron-dev/aether';
import '@omnitron-dev/aether/svg/icons/animations.css';

function App() {
  return (
    <IconProvider defaultPreset="stroke" defaultSize="md">
      <div>
        {/* Basic icon */}
        <Icon name="heart" />

        {/* Button with icon */}
        <Button icon="save">Save</Button>

        {/* Animated icon */}
        <Icon name="spinner" animation="spin" />

        {/* Custom configuration */}
        <Icon
          name="user"
          preset="duotone"
          size="lg"
          color="blue"
          animation="hover"
        />
      </div>
    </IconProvider>
  );
}
```

---

**That's it! 🎉**

For more details, see the full API documentation.
