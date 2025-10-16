# Aether Icon API

**A minimalist, powerful icon system for Aether framework**

## Table of Contents

- [Overview](#overview)
- [Design Philosophy](#design-philosophy)
- [API Design](#api-design)
- [Type Definitions](#type-definitions)
- [Animation System](#animation-system)
- [Integration Examples](#integration-examples)
- [Performance Considerations](#performance-considerations)
- [Best Practices](#best-practices)

---

## Overview

Aether's Icon API provides a flexible, type-safe way to work with 13,677+ icons across three visual presets (stroke, duotone, twotone). The API is designed to be simple for common cases while providing advanced control when needed.

### Key Features

- **Flexible API**: String-based for simplicity, object-based for control
- **Rich Animations**: 6 built-in animation types with full customization
- **Type-Safe**: Full TypeScript support with autocomplete
- **Performance-Focused**: CSS animations, GPU acceleration, reduced motion support
- **Accessible**: Built-in ARIA support and semantic HTML

---

## Design Philosophy

### Why Object-Based API?

After evaluating three approaches:

**❌ Option A - Attribute-based**
```tsx
<Button icon-name="user" icon-preset="stroke" icon-animation="hover">
```
- Verbose for simple cases
- Non-standard HTML attributes
- Poor TypeScript support

**❌ Option B - Separate props**
```tsx
<Button iconName="user" iconPreset="stroke" iconAnimation="hover">
```
- Too many props pollute component interface
- Hard to manage multiple icons (left, right, loading)

**✅ Option C - Hybrid (String + Object)**
```tsx
// Simple case - just a string
<Button icon="user">Profile</Button>

// Advanced case - full control
<Button icon={{ name: "user", preset: "stroke", animation: "hover" }}>
  Profile
</Button>
```

**Benefits:**
- Maximum simplicity for common cases
- Full control when needed
- Excellent TypeScript autocomplete
- Clean component APIs
- Easy to extend

---

## API Design

### Basic Usage

```tsx
import { Button, Icon } from '@omnitron-dev/aether';

// String-based (simplest)
<Button icon="user">Profile</Button>

// Object-based (more control)
<Button icon={{ name: "user", preset: "stroke", animation: "hover" }}>
  Profile
</Button>

// Multiple icons
<Button leftIcon="save" rightIcon="arrow-right">
  Save and Continue
</Button>

// Direct Icon component
<Icon name="heart" size="lg" color="red" animation="pulse" />
```

### Icon Configuration Object

```tsx
interface IconConfig {
  name: string;                    // Required: icon name
  preset?: 'stroke' | 'duotone' | 'twotone';
  animation?: 'hover' | 'click' | 'loading' | 'spin' | 'pulse' | 'bounce' | 'none';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  color?: string | Signal<string>;
  position?: 'left' | 'right' | 'top' | 'bottom';
  className?: string;
  style?: any;
  label?: string;
  decorative?: boolean;
  animationDuration?: number;
  animationTiming?: string;
  animationIterations?: number | 'infinite';
  rotate?: number | Signal<number>;
  flip?: 'horizontal' | 'vertical' | 'both';
  transform?: string;
}
```

### Type Alias for Flexibility

```tsx
type IconProp = string | IconConfig;
```

This allows components to accept either:
- **String**: `"user"` (simplest, uses defaults)
- **Object**: `{ name: "user", preset: "stroke", ... }` (full control)

---

## Type Definitions

### Core Types

```tsx
// Icon presets
type IconPreset = 'stroke' | 'duotone' | 'twotone';

// Animation types
type IconAnimation =
  | 'hover'      // Animate on mouse hover
  | 'click'      // Animate on click
  | 'loading'    // Continuous loading animation
  | 'spin'       // Continuous spinning
  | 'pulse'      // Pulsing scale animation
  | 'bounce'     // Bouncing animation
  | 'none';      // No animation

// Size presets
type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;

// Position in component
type IconPosition = 'left' | 'right' | 'top' | 'bottom';
```

### Component Integration Interface

```tsx
interface IconSlots {
  // Single icon
  icon?: IconProp;

  // Positional icons
  leftIcon?: IconProp;
  rightIcon?: IconProp;
  topIcon?: IconProp;
  bottomIcon?: IconProp;

  // Special states
  loadingIcon?: IconProp;

  // Global defaults for all icons
  iconPreset?: IconPreset;
  iconSize?: IconSize;
  iconColor?: string | Signal<string>;
}
```

### Advanced Animation Config

```tsx
interface AnimationConfig {
  type: IconAnimation;
  duration?: number;
  timing?: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | string;
  iterations?: number | 'infinite';
  delay?: number;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fillMode?: 'none' | 'forwards' | 'backwards' | 'both';
  keyframes?: string;  // Custom keyframes name
}
```

---

## Animation System

### Built-in Animations

#### 1. **Hover** - Animate on mouse hover
```tsx
<Button icon={{ name: "user", animation: "hover" }}>
  Profile
</Button>
```

**Effect**: Scales up slightly on hover (1.1x), smooth transition

#### 2. **Click** - Animate on click
```tsx
<Button icon={{ name: "save", animation: "click" }}>
  Save
</Button>
```

**Effect**: Quick scale down (0.9x) then back, gives tactile feedback

#### 3. **Loading** - Continuous loading animation
```tsx
<Button loading icon={{ name: "loader", animation: "loading" }}>
  Loading...
</Button>
```

**Effect**: Continuous rotation with opacity pulse

#### 4. **Spin** - Continuous spinning
```tsx
<Icon name="refresh" animation="spin" />
```

**Effect**: Smooth 360° rotation, infinite loop

#### 5. **Pulse** - Pulsing scale animation
```tsx
<Icon name="heart" animation="pulse" color="red" />
```

**Effect**: Scale and opacity pulse (1.0 → 0.95 → 1.0)

#### 6. **Bounce** - Bouncing animation
```tsx
<Icon name="arrow-down" animation="bounce" />
```

**Effect**: Vertical bounce animation

### Animation Customization

```tsx
<Icon
  name="refresh"
  animation="spin"
  animationDuration={1}           // 1 second (default: 2s)
  animationTiming="ease-in-out"   // Timing function
  animationIterations={5}          // 5 times (default: infinite)
/>
```

### CSS Animation Classes

For custom styling or non-component usage:

```css
/* Continuous animations */
.aether-icon-spin           /* Standard spin */
.aether-icon-spin-fast      /* Fast spin (1s) */
.aether-icon-spin-slow      /* Slow spin (3s) */
.aether-icon-pulse          /* Pulse animation */
.aether-icon-bounce         /* Bounce animation */
.aether-icon-loading        /* Loading animation */

/* Hover animations */
.aether-icon-hover          /* Scale on hover */
.aether-icon-hover-bounce   /* Bounce on hover */
.aether-icon-hover-shake    /* Shake on hover */
.aether-icon-hover-rotate   /* Rotate on hover */
.aether-icon-hover-flip     /* Flip on hover */

/* Click animations */
.aether-icon-click-flash    /* Flash on click */
.aether-icon-click-scale    /* Scale on click */

/* Data attribute selectors (headless) */
[data-icon-animation="spin"]
[data-icon-animation="pulse"]
[data-icon-animation="bounce"]
[data-icon-animation="hover"]
[data-icon-animation="click"]
```

### Reduced Motion Support

Animations automatically respect user preferences:

```css
@media (prefers-reduced-motion: reduce) {
  /* All animations disabled */
}
```

---

## Integration Examples

### Button Component

```tsx
// Simple icon
<Button icon="save">Save</Button>

// With preset
<Button icon={{ name: "save", preset: "duotone" }}>
  Save
</Button>

// Left + right icons
<Button
  leftIcon="arrow-left"
  rightIcon="arrow-right"
>
  Navigate
</Button>

// Loading state
const isLoading = signal(false);

<Button
  loading={isLoading}
  loadingIcon={{ name: "loader", animation: "loading" }}
  onClick={async () => {
    isLoading.set(true);
    await saveData();
    isLoading.set(false);
  }}
>
  Save Changes
</Button>

// Icon-only button
<Button
  icon="trash"
  aria-label="Delete item"
  onClick={handleDelete}
/>

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

### Icon Component

```tsx
import { Icon } from '@omnitron-dev/aether';

// Basic usage
<Icon name="heart" />

// With size and color
<Icon name="heart" size="lg" color="red" />

// With animation
<Icon name="spinner" animation="spin" />

// Reactive properties
const heartColor = signal("gray");

<Icon
  name="heart"
  color={heartColor}
  onClick={() => heartColor.set("red")}
/>

// Advanced configuration
<Icon
  name="user"
  preset="duotone"
  size={32}
  animation="pulse"
  animationDuration={1.5}
  rotate={45}
  className="custom-icon"
/>

// Decorative icon (hidden from screen readers)
<Icon name="sparkle" decorative />
```

### Custom Components

```tsx
interface CardProps extends IconSlots {
  title: string;
  children: any;
}

const Card = defineComponent<CardProps>((props) => {
  return () => (
    <div class="card">
      <div class="card-header">
        {props.icon && <Icon {...normalizeIcon(props.icon)} />}
        <h3>{props.title}</h3>
      </div>
      <div class="card-body">
        {props.children}
      </div>
    </div>
  );
});

// Usage
<Card icon="home" title="Dashboard">
  Content here
</Card>

<Card
  icon={{ name: "chart", preset: "duotone", animation: "pulse" }}
  title="Analytics"
>
  Charts here
</Card>
```

### Helper Function for Icon Normalization

```tsx
/**
 * Normalize IconProp to IconConfig
 */
export function normalizeIcon(
  icon: IconProp,
  defaults?: Partial<IconConfig>
): IconConfig {
  const config: IconConfig = typeof icon === 'string'
    ? { name: icon }
    : icon;

  return {
    preset: 'stroke',
    animation: 'none',
    size: 'md',
    decorative: false,
    ...defaults,
    ...config,
  };
}
```

### Icon Provider Context

```tsx
import { IconProvider } from '@omnitron-dev/aether';

// App-wide icon configuration
<IconProvider
  defaultPreset="stroke"
  defaultSize="md"
  defaultColor="currentColor"
>
  <App />
</IconProvider>

// Override in specific sections
<IconProvider
  defaultPreset="duotone"
  defaultAnimation="hover"
>
  <DashboardSection />
</IconProvider>
```

---

## Performance Considerations

### 1. **CSS Animations**
- All animations use CSS `@keyframes`, not JavaScript
- GPU-accelerated with `transform` and `opacity`
- Minimal layout recalculation

### 2. **Lazy Loading**
```tsx
// Icons loaded on-demand from registry
<Icon name="rarely-used-icon" />
```

### 3. **Preloading**
```tsx
import { getIconRegistry } from '@omnitron-dev/aether';

// Preload critical icons
const registry = getIconRegistry();
await registry.preload(['home', 'user', 'settings']);
```

### 4. **SVG Optimization**
- Icons stored as optimized path data
- Shared viewBox definitions
- Minimal DOM nodes

### 5. **Reduced Motion**
```tsx
// Automatically respects user preferences
@media (prefers-reduced-motion: reduce) {
  /* Animations disabled */
}
```

---

## Best Practices

### 1. **Accessibility**

```tsx
// ✅ GOOD: Icon-only button with label
<Button icon="trash" aria-label="Delete item" />

// ❌ BAD: No label
<Button icon="trash" />

// ✅ GOOD: Decorative icon
<Icon name="sparkle" decorative />

// ✅ GOOD: Meaningful icon with label
<Icon name="warning" label="Warning" />
```

### 2. **Performance**

```tsx
// ✅ GOOD: Use string for simple cases
<Button icon="save" />

// ⚠️ OK: Object when needed
<Button icon={{ name: "save", animation: "hover" }} />

// ❌ BAD: Unnecessary object
<Button icon={{ name: "save" }} /> // Use string instead
```

### 3. **Consistency**

```tsx
// ✅ GOOD: Use IconProvider for global defaults
<IconProvider defaultPreset="stroke" defaultSize="md">
  <App />
</IconProvider>

// Then just use names
<Button icon="user" />
<Icon name="settings" />
```

### 4. **Animation Usage**

```tsx
// ✅ GOOD: Appropriate animations
<Button icon={{ name: "refresh", animation: "spin" }} />
<Button loading loadingIcon={{ name: "loader", animation: "loading" }} />

// ❌ BAD: Overuse
<Button icon={{ name: "user", animation: "bounce" }} /> // Distracting
```

### 5. **Type Safety**

```tsx
// ✅ GOOD: Full type checking
import type { IconProp, IconAnimation } from '@omnitron-dev/aether';

interface MyProps {
  icon?: IconProp;
  animation?: IconAnimation;
}

// TypeScript will validate all values
```

---

## Advanced Examples

### Dynamic Icon with Signals

```tsx
const iconName = signal("play");
const isPlaying = signal(false);

<Button
  icon={{
    name: iconName,
    animation: computed(() => isPlaying() ? "pulse" : "none")
  }}
  onClick={() => {
    isPlaying.set(!isPlaying());
    iconName.set(isPlaying() ? "pause" : "play");
  }}
>
  {() => isPlaying() ? "Pause" : "Play"}
</Button>
```

### Custom Animation

```tsx
// Define custom keyframes
const style = document.createElement('style');
style.textContent = `
  @keyframes custom-wiggle {
    0%, 100% { transform: rotate(-3deg); }
    50% { transform: rotate(3deg); }
  }
`;
document.head.appendChild(style);

// Use custom animation
<Icon
  name="bell"
  animation="none"
  style={{ animation: "custom-wiggle 0.5s ease-in-out infinite" }}
/>
```

### Icon Search and Discovery

```tsx
import { searchIcons } from '@omnitron-dev/aether';

// Search for icons
const results = await searchIcons({
  query: "arrow",
  preset: "stroke",
  limit: 10
});

// Display results
<div>
  {results.map(icon => (
    <Icon
      name={icon.name}
      preset={icon.preset}
      onClick={() => selectIcon(icon)}
    />
  ))}
</div>
```

---

## Migration Guide

### From Plain SVG

```tsx
// Before
<svg width="24" height="24" viewBox="0 0 24 24">
  <path d="M12 2L2 7l10 5 10-5-10-5z" />
</svg>

// After
<Icon name="box" size={24} />
```

### From Font Icons

```tsx
// Before
<i class="fa fa-heart"></i>

// After
<Icon name="heart" />
```

### From Image Icons

```tsx
// Before
<img src="/icons/user.svg" width="24" height="24" alt="User" />

// After
<Icon name="user" size={24} label="User" />
```

---

## Summary

The Aether Icon API provides:

✅ **Simplicity**: String-based for 90% of use cases
✅ **Power**: Object-based for advanced control
✅ **Performance**: CSS animations, GPU acceleration
✅ **Accessibility**: Built-in ARIA support
✅ **Type Safety**: Full TypeScript integration
✅ **Flexibility**: Works with Button, Icon, and custom components

**Simple when you need it, powerful when you want it.**
