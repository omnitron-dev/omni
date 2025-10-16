# Aether Icon API - Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AETHER ICON SYSTEM                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Simple String API          Object-Based API                        │
│  ─────────────────          ────────────────                        │
│  <Icon name="heart"/>       <Icon name="heart"                      │
│                                   preset="duotone"                   │
│  <Button icon="save">             animation="pulse"                 │
│                                   size="lg"/>                        │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         TYPE SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  IconProp = string | IconConfig                                     │
│                                                                       │
│  IconConfig {                                                        │
│    name: string                                                      │
│    preset?: 'stroke' | 'duotone' | 'twotone'                       │
│    animation?: 'hover' | 'click' | 'spin' | ...                    │
│    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number                │
│    color?: string | Signal<string>                                  │
│    ...                                                               │
│  }                                                                   │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ICON COMPONENT                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Icon Component (High-level)                                        │
│  ├─ Accepts IconProp                                                │
│  ├─ Normalizes configuration                                        │
│  ├─ Integrates with IconProvider                                    │
│  ├─ Builds classes, styles, attributes                             │
│  └─ Renders SVGIcon                                                 │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       UTILITY LAYER                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Normalization          Building              Resolution            │
│  ──────────────          ────────              ──────────            │
│  • normalizeIcon        • buildIconClasses     • resolveIconSize    │
│  • createIconConfig     • buildIconStyles      • resolveIconName    │
│  • mergeIconConfigs     • buildDataAttributes                       │
│                         • buildA11yAttributes                        │
│                                                                       │
│  Validation             Helpers                                      │
│  ──────────             ───────                                      │
│  • validateIconConfig   • getAnimationClass                         │
│  • isIconConfig         • getPositionClass                          │
│                         • ICON_SIZE_MAP                              │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SVGIcon COMPONENT                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Low-level SVG rendering                                            │
│  ├─ Fetches icon from registry                                      │
│  ├─ Handles loading states                                          │
│  ├─ Applies transformations                                         │
│  ├─ Manages reactivity (Signals)                                    │
│  └─ Renders actual SVG element                                      │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ICON REGISTRY                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Icon Storage & Management                                          │
│  ├─ 13,677 icons (stroke, duotone, twotone)                        │
│  ├─ Lazy loading support                                            │
│  ├─ Icon search & discovery                                         │
│  ├─ Transformer pipeline                                            │
│  └─ Caching layer                                                   │
│                                                                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ANIMATION SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  CSS Keyframes (animations.css)                                     │
│  ├─ @keyframes aether-icon-spin                                     │
│  ├─ @keyframes aether-icon-pulse                                    │
│  ├─ @keyframes aether-icon-bounce                                   │
│  ├─ @keyframes aether-icon-loading                                  │
│  └─ ... (+ hover/click variants)                                    │
│                                                                       │
│  CSS Classes                                                         │
│  ├─ .aether-icon-spin                                               │
│  ├─ .aether-icon-pulse                                              │
│  ├─ .aether-icon-hover                                              │
│  └─ [data-icon-animation="..."]                                     │
│                                                                       │
│  Performance Optimizations                                           │
│  ├─ GPU acceleration (transform, opacity)                           │
│  ├─ will-change hints                                               │
│  └─ @media (prefers-reduced-motion)                                 │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Simple String Flow

```
User Input
   │
   │  <Icon name="heart" />
   │
   ▼
Icon Component
   │
   ├─ normalizeIcon("heart")
   │     │
   │     └─► { name: "heart", preset: "stroke", animation: "none", ... }
   │
   ├─ buildIconClasses(config)
   │     └─► "aether-icon"
   │
   ├─ resolveIconName("heart", "stroke")
   │     └─► "icons:stroke:heart"
   │
   ▼
SVGIcon Component
   │
   ├─ getIconRegistry().get("icons:stroke:heart")
   │     │
   │     └─► IconDefinition { path: "M12...", viewBox: "0 0 24 24" }
   │
   ▼
Render SVG
   │
   └─► <svg width="20" height="20" viewBox="0 0 24 24">
           <path d="M12..." fill="currentColor" />
       </svg>
```

---

### Object-Based Flow with Animation

```
User Input
   │
   │  <Icon name="heart" animation="pulse" size="lg" color="red" />
   │
   ▼
Icon Component
   │
   ├─ normalizeIcon({
   │     name: "heart",
   │     animation: "pulse",
   │     size: "lg",
   │     color: "red"
   │   })
   │     └─► Full IconConfig with defaults
   │
   ├─ buildIconClasses(config)
   │     └─► "aether-icon aether-icon-pulse aether-icon-lg"
   │
   ├─ buildIconStyles(config)
   │     └─► { color: "red", width: "24px", height: "24px" }
   │
   ├─ buildDataAttributes(config)
   │     └─► { "data-icon": "heart", "data-icon-animation": "pulse" }
   │
   ▼
SVGIcon Component
   │
   ├─ Load icon from registry
   │
   ▼
Render SVG with animation
   │
   └─► <svg
           class="aether-icon aether-icon-pulse aether-icon-lg"
           style="color: red; width: 24px; height: 24px"
           data-icon="heart"
           data-icon-animation="pulse"
       >
           <path d="M12..." fill="currentColor" />
       </svg>
       
       CSS animation applies automatically via .aether-icon-pulse class
```

---

## Component Integration

### Button Component Integration

```
Button Component
   │
   ├─ Props: {
   │     icon?: IconProp
   │     leftIcon?: IconProp
   │     rightIcon?: IconProp
   │     loadingIcon?: IconProp
   │     iconPreset?: IconPreset
   │     iconSize?: IconSize
   │   }
   │
   ├─ Render Logic:
   │     │
   │     ├─ if (loading)
   │     │     └─► Render loadingIcon with animation
   │     │
   │     ├─ else
   │     │     ├─► Render leftIcon
   │     │     ├─► Render children (text)
   │     │     └─► Render rightIcon
   │     │
   │     └─ Apply global iconPreset, iconSize, iconColor
   │
   ▼
   
<button>
  <Icon name="save" position="left" />
  <span>Save</span>
  <Icon name="arrow-right" position="right" />
</button>
```

---

## IconProvider Context Flow

```
App Level
   │
   │  <IconProvider
   │     defaultPreset="stroke"
   │     defaultSize="md"
   │     defaultColor="currentColor"
   │  >
   │
   ├─────────────────────────────────┐
   │                                 │
   │  Component A                    │  Component B
   │     │                           │     │
   │     │ useIconDefaults()         │     │ useIconDefaults()
   │     │    │                      │     │    │
   │     │    └─► {                  │     │    └─► {
   │     │          preset: "stroke" │     │          preset: "stroke"
   │     │          size: "md"       │     │          size: "md"
   │     │        }                  │     │        }
   │     │                           │     │
   │     └─ <Icon name="user" />    │     └─ <Button icon="save" />
   │           │                     │           │
   │           └─ Uses defaults      │           └─ Uses defaults
   │                                 │
   └─────────────────────────────────┘
```

---

## Animation System Architecture

```
CSS Animations (animations.css)
   │
   ├─ Keyframe Definitions
   │     ├─ @keyframes aether-icon-spin { ... }
   │     ├─ @keyframes aether-icon-pulse { ... }
   │     └─ @keyframes aether-icon-bounce { ... }
   │
   ├─ Animation Classes
   │     ├─ .aether-icon-spin { animation: aether-icon-spin 2s ... }
   │     ├─ .aether-icon-pulse { animation: aether-icon-pulse 2s ... }
   │     └─ .aether-icon-hover:hover { animation: ... }
   │
   ├─ Data Attribute Selectors
   │     ├─ [data-icon-animation="spin"] { ... }
   │     └─ [data-icon-animation="pulse"] { ... }
   │
   └─ Performance Optimizations
         ├─ will-change: transform
         ├─ transform: translateZ(0)  (GPU acceleration)
         └─ @media (prefers-reduced-motion) { ... }

Applied via:
   │
   ├─ Class names: buildIconClasses(config)
   │     └─► Adds animation class based on config.animation
   │
   ├─ Data attributes: buildIconDataAttributes(config)
   │     └─► Adds data-icon-animation attribute
   │
   └─ Inline styles: buildIconStyles(config)
         └─► Overrides duration, timing, iterations
```

---

## Type System Flow

```
TypeScript Types (types.ts)
   │
   ├─ IconProp = string | IconConfig
   │     │
   │     ├─ string: Simple API
   │     │     └─► "user", "heart", "save"
   │     │
   │     └─ IconConfig: Advanced API
   │           └─► { name: "user", preset: "stroke", ... }
   │
   ├─ IconConfig Interface
   │     ├─ Required: name
   │     └─ Optional: preset, animation, size, color, ...
   │
   ├─ Enums
   │     ├─ IconPreset: 'stroke' | 'duotone' | 'twotone'
   │     ├─ IconAnimation: 'hover' | 'click' | 'spin' | ...
   │     ├─ IconSize: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
   │     └─ IconPosition: 'left' | 'right' | 'top' | 'bottom'
   │
   └─ Component Integration
         └─ IconSlots Interface
               ├─ icon?: IconProp
               ├─ leftIcon?: IconProp
               ├─ rightIcon?: IconProp
               └─ iconPreset?, iconSize?, iconColor?
```

---

## Utility Function Pipeline

```
Input: IconProp
   │
   ▼
normalizeIcon(icon, defaults)
   │
   ├─ Check if string or object
   ├─ Convert string to IconConfig
   ├─ Merge with defaults
   └─► Output: IconConfig
       │
       ├───────────┬──────────┬───────────┬──────────┐
       │           │          │           │          │
       ▼           ▼          ▼           ▼          ▼
   buildIcon   buildIcon  buildIcon  buildIcon  resolveIcon
   Classes     Styles     DataAttrs  A11yAttrs  Name/Size
       │           │          │           │          │
       └───────────┴──────────┴───────────┴──────────┘
                              │
                              ▼
                    Props for SVGIcon Component
```

---

## Performance Optimization Flow

```
Icon Request
   │
   ├─ Check IconRegistry cache
   │     │
   │     ├─ Hit: Return cached icon
   │     │     └─► Instant render
   │     │
   │     └─ Miss: Load icon
   │           │
   │           ├─ Fetch from preset directory
   │           ├─ Cache in registry
   │           └─► Render
   │
   ├─ Apply CSS animations (GPU-accelerated)
   │     └─► No JavaScript overhead
   │
   └─ Tree-shake unused icons
         └─► Bundle only what's used
```

---

## Accessibility Flow

```
Icon Configuration
   │
   ├─ Check decorative flag
   │     │
   │     ├─ true: Add aria-hidden="true"
   │     │     └─► Hidden from screen readers
   │     │
   │     └─ false: Check for label
   │           │
   │           ├─ label exists: Add aria-label
   │           │     └─► Accessible to screen readers
   │           │
   │           └─ no label: Development warning
   │                 └─► Alert developer in console
   │
   └─ Icon-only buttons
         │
         └─ Require aria-label or aria-labelledby
               │
               ├─ Provided: Valid
               └─ Missing: Development warning
```

---

## File Structure

```
packages/aether/
├── src/
│   └── svg/
│       ├── icons/
│       │   ├── types.ts              # Type definitions
│       │   ├── utils.ts              # Utility functions
│       │   ├── animations.css        # CSS animations
│       │   ├── IconRegistry.ts       # Icon storage
│       │   └── IconProvider.tsx      # Context provider
│       │
│       └── components/
│           ├── Icon.tsx              # High-level icon component
│           └── SVGIcon.tsx           # Low-level SVG renderer
│
└── docs/
    ├── ICON_API.md                   # Main API documentation
    ├── ICON_API_DESIGN_RATIONALE.md  # Design decisions
    ├── ICON_API_QUICK_REFERENCE.md   # Quick lookup
    ├── ICON_INTEGRATION_EXAMPLES.md  # Real-world examples
    └── ICON_API_ARCHITECTURE.md      # This file
```

---

## Summary

The Aether Icon API architecture follows a clean, layered approach:

1. **Type System** - Strong TypeScript types with union flexibility
2. **Component Layer** - High-level Icon component + low-level SVGIcon
3. **Utility Layer** - Pure functions for normalization and building
4. **Registry Layer** - Icon storage with lazy loading
5. **Animation System** - CSS-based for performance
6. **Context Layer** - Global defaults via IconProvider

This architecture achieves:
- ✅ Clean separation of concerns
- ✅ Excellent performance
- ✅ Type safety throughout
- ✅ Easy to extend
- ✅ Maintainable codebase

**Result**: A robust, scalable icon system for Aether framework.
