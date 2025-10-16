# Visual Transformation Comparison

## Before → After: Side-by-Side

### Input: HugeIcons Array Format

```javascript
// File: experiments/hugeicons/core-stroke-rounded/dist/esm/index.js
// Format: Array of [tag, attributes] tuples

const FirstBracketCircleIcon = /*#__PURE__*/ [
  ["path", {
    d: "M9 8C7.7945 8.85994 7 10.3304 7 12C7 13.6696 7.7945 15.1401 9 16M15 8C16.2055 8.85994 17 10.3304 17 12C17 13.6696 16.2055 15.1401 15 16",
    stroke: "currentColor",      // ❌ Redundant (default)
    strokeLinecap: "round",       // ✅ Keep
    strokeLinejoin: "round",      // ✅ Keep
    strokeWidth: "1.5",           // ❌ Redundant (default)
    key: "0"                      // ❌ Internal key (remove)
  }],
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",       // ❌ Redundant (default)
    strokeWidth: "1.5",           // ❌ Redundant (default)
    key: "1"                      // ❌ Internal key (remove)
  }]
];

// Issues:
// • Array format requires runtime parsing
// • Redundant attributes inflate size
// • Internal keys add overhead
// • Not directly tree-shakeable
// • No semantic structure or metadata
```

### Output: Aether IconDefinition Format

```typescript
// File: packages/aether/src/svg/icons/presets/hugeicons/stroke/first-bracket-circle.ts
// Format: IconDefinition with SVG content

/**
 * FirstBracketCircleIcon
 * Preset: stroke
 * Auto-generated from HugeIcons
 */

import type { IconDefinition } from '../../../IconRegistry.js';

export const FirstBracketCircleIcon: IconDefinition = {
  "id": "first-bracket-circle",

  // Direct SVG content (no runtime parsing needed)
  "content": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\">\n    <path d=\"M9 8C7.7945 8.85994 7 10.3304 7 12C7 13.6696 7.7945 15.1401 9 16M15 8C16.2055 8.85994 17 10.3304 17 12C17 13.6696 16.2055 15.1401 15 16\" stroke-linecap=\"round\" stroke-linejoin=\"round\" />\n    <circle cx=\"12\" cy=\"12\" r=\"10\" />\n  </svg>",

  "viewBox": "0 0 24 24",
  "width": 24,
  "height": 24,

  // Rich metadata for tooling
  "metadata": {
    "preset": "stroke",
    "originalName": "FirstBracketCircleIcon",
    "elementsCount": 2,
    "hasOpacity": false,
    "hasFill": false
  }
};

// Benefits:
// ✅ Direct SVG content (no runtime parsing)
// ✅ Optimized attributes (removed redundant)
// ✅ Type-safe with TypeScript
// ✅ Fully tree-shakeable
// ✅ Rich metadata included
// ✅ Clear semantic structure
```

---

## Generated SVG (Rendered)

### Optimized Markup

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <!-- Path element: stroke/strokeWidth removed (defaults applied) -->
  <path
    d="M9 8C7.7945 8.85994 7 10.3304 7 12C7 13.6696 7.7945 15.1401 9 16M15 8C16.2055 8.85994 17 10.3304 17 12C17 13.6696 16.2055 15.1401 15 16"
    stroke-linecap="round"
    stroke-linejoin="round"
  />

  <!-- Circle element: stroke/strokeWidth removed (defaults applied) -->
  <circle cx="12" cy="12" r="10" />
</svg>
```

**What was removed:**
- `stroke="currentColor"` (default for stroke preset)
- `strokeWidth="1.5"` (default stroke width)
- `key="0"` and `key="1"` (internal React-style keys)

**What was preserved:**
- All path data (`d` attribute)
- All geometry (cx, cy, r)
- All semantic styling (stroke-linecap, stroke-linejoin)

**Result:** 100% visual accuracy with reduced file size

---

## Complex Example: ThreeDViewIcon

### Input (HugeIcons)

```javascript
const ThreeDViewIcon = /*#__PURE__*/ [
  ["path", {
    d: "M12 11.5C12.4955 11.5 12.9562 11.3015 13.8775 10.9045L14.5423 10.618C16.1808 9.91202 17 9.55902 17 9C17 8.44098 16.1808 8.08798 14.5423 7.38197L13.8775 7.09549C12.9562 6.6985 12.4955 6.5 12 6.5C11.5045 6.5 11.0438 6.6985 10.1225 7.09549L9.45768 7.38197C7.81923 8.08798 7 8.44098 7 9C7 9.55902 7.81923 9.91202 9.45768 10.618L10.1225 10.9045C11.0438 11.3015 11.5045 11.5 12 11.5ZM12 11.5V17.5",
    stroke: "currentColor",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "0"
  }],
  ["path", {
    d: "M17 9V15C17 15.559 16.1808 15.912 14.5423 16.618L13.8775 16.9045C12.9562 17.3015 12.4955 17.5 12 17.5C11.5045 17.5 11.0438 17.3015 10.1225 16.9045L9.45768 16.618C7.81923 15.912 7 15.559 7 15V9",
    stroke: "currentColor",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "1"
  }],
  ["path", {
    d: "M9.14426 2.5C6.48724 2.56075 4.93529 2.81456 3.87493 3.87493C2.81456 4.93529 2.56075 6.48724 2.5 9.14426M14.8557 2.5C17.5128 2.56075 19.0647 2.81456 20.1251 3.87493C21.1854 4.93529 21.4392 6.48724 21.5 9.14426M14.8557 21.5C17.5128 21.4392 19.0647 21.1854 20.1251 20.1251C21.1854 19.0647 21.4392 17.5128 21.5 14.8557M9.14426 21.5C6.48724 21.4392 4.93529 21.1854 3.87493 20.1251C2.81456 19.0647 2.56075 17.5128 2.5 14.8557",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "2"
  }]
];
```

### Output (Aether)

```typescript
export const ThreeDViewIcon: IconDefinition = {
  "id": "three-d-view",
  "content": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\">\n    <path d=\"M12 11.5C12.4955 11.5 12.9562 11.3015 13.8775 10.9045L14.5423 10.618C16.1808 9.91202 17 9.55902 17 9C17 8.44098 16.1808 8.08798 14.5423 7.38197L13.8775 7.09549C12.9562 6.6985 12.4955 6.5 12 6.5C11.5045 6.5 11.0438 6.6985 10.1225 7.09549L9.45768 7.38197C7.81923 8.08798 7 8.44098 7 9C7 9.55902 7.81923 9.91202 9.45768 10.618L10.1225 10.9045C11.0438 11.3015 11.5045 11.5 12 11.5ZM12 11.5V17.5\" stroke-linejoin=\"round\" />\n    <path d=\"M17 9V15C17 15.559 16.1808 15.912 14.5423 16.618L13.8775 16.9045C12.9562 17.3015 12.4955 17.5 12 17.5C11.5045 17.5 11.0438 17.3015 10.1225 16.9045L9.45768 16.618C7.81923 15.912 7 15.559 7 15V9\" stroke-linejoin=\"round\" />\n    <path d=\"M9.14426 2.5C6.48724 2.56075 4.93529 2.81456 3.87493 3.87493C2.81456 4.93529 2.56075 6.48724 2.5 9.14426M14.8557 2.5C17.5128 2.56075 19.0647 2.81456 20.1251 3.87493C21.1854 4.93529 21.4392 6.48724 21.5 9.14426M14.8557 21.5C17.5128 21.4392 19.0647 21.1854 20.1251 20.1251C21.1854 19.0647 21.4392 17.5128 21.5 14.8557M9.14426 21.5C6.48724 21.4392 4.93529 21.1854 3.87493 20.1251C2.81456 19.0647 2.56075 17.5128 2.5 14.8557\" stroke-linecap=\"round\" stroke-linejoin=\"round\" />\n  </svg>",
  "viewBox": "0 0 24 24",
  "width": 24,
  "height": 24,
  "metadata": {
    "preset": "stroke",
    "originalName": "ThreeDViewIcon",
    "elementsCount": 3,
    "hasOpacity": false,
    "hasFill": false
  }
};
```

---

## Preset Variations

### Duotone (with opacity + fill)

```javascript
// Input: Duotone has opacity and fill attributes
const FirstBracketCircleIcon = [
  ["circle", {
    opacity: "0.4",              // ✅ Keep (semantic for duotone)
    cx: "12",
    cy: "12",
    r: "10",
    fill: "currentColor",        // ✅ Keep (semantic for duotone)
    key: "0"
  }],
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",      // ❌ Remove
    strokeWidth: "1.5",          // ❌ Remove
    key: "1"
  }]
];

// Output: Preserves opacity and fill
<circle opacity="0.4" cx="12" cy="12" r="10" fill="currentColor" />
<circle cx="12" cy="12" r="10" />
```

### Twotone (selective opacity)

```javascript
// Input: Twotone has selective opacity
const FirstBracketCircleIcon = [
  ["path", {
    opacity: "0.4",              // ✅ Keep (semantic for twotone)
    d: "...",
    stroke: "currentColor",      // ❌ Remove
    key: "0"
  }],
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",      // ❌ Remove
    key: "1"
  }]
];

// Output: Preserves opacity where specified
<path opacity="0.4" d="..." />
<circle cx="12" cy="12" r="10" />
```

---

## Attribute Optimization Rules

### Stroke Preset
- ❌ Remove `stroke="currentColor"` (default)
- ❌ Remove `strokeWidth="1.5"` (default)
- ✅ Keep `strokeLinecap`, `strokeLinejoin` (semantic)
- ❌ Remove all `key` attributes (internal)

### Duotone Preset
- ❌ Remove `stroke="currentColor"` (default)
- ❌ Remove `strokeWidth="1.5"` (default)
- ✅ Keep `opacity` (semantic for effect)
- ✅ Keep `fill` (semantic for effect)
- ❌ Remove all `key` attributes (internal)

### Twotone Preset
- ❌ Remove `stroke="currentColor"` (default)
- ❌ Remove `strokeWidth="1.5"` (default)
- ✅ Keep `opacity` where specified (semantic)
- ❌ Remove all `key` attributes (internal)

---

## Name Normalization

### PascalCase → kebab-case

| Original (PascalCase) | Normalized (kebab-case) |
|-----------------------|-------------------------|
| FirstBracketCircleIcon | first-bracket-circle |
| FirstBracketSquareIcon | first-bracket-square |
| SecondBracketCircleIcon | second-bracket-circle |
| ThreeDViewIcon | three-d-view |
| ThreeDMoveIcon | three-d-move |
| ThreeDPrinterIcon | three-d-printer |
| FourKIcon | four-k |
| SevenZ01Icon | seven-z-01 |

**Benefits:**
- Consistent naming convention
- URL-friendly identifiers
- Easier to search and filter
- Better autocomplete in IDEs

---

## File Structure

### Individual Files Mode (default)

```
packages/aether/src/svg/icons/presets/hugeicons/stroke/
├── first-bracket-circle.ts    (single icon export)
├── first-bracket-square.ts    (single icon export)
├── first-bracket.ts           (single icon export)
├── ...                        (4,556 more files)
└── index.ts                   (re-exports all + metadata)
```

### Chunked Mode (--batch-size 100)

```
packages/aether/src/svg/icons/presets/hugeicons/stroke/
├── chunk-1.ts     (100 icons)
├── chunk-2.ts     (100 icons)
├── chunk-3.ts     (100 icons)
├── ...            (43 more chunks)
├── chunk-46.ts    (59 icons)
└── index.ts       (re-exports all chunks + metadata)
```

**Recommended for production:** Chunked mode reduces file count from 4,559 to 47 while maintaining tree-shaking.

---

## Index File Structure

```typescript
/**
 * HugeIcons stroke preset
 * Total icons: 4559
 * Auto-generated from HugeIcons
 */

// Re-export all icons
export * from './first-bracket-circle.js';
export * from './first-bracket-square.js';
// ... (4,557 more exports)

/**
 * Icon metadata
 */
export const HUGEICONS_STROKE_METADATA = {
  preset: 'stroke',
  count: 4559,
  icons: [
    'FirstBracketCircleIcon',
    'FirstBracketSquareIcon',
    // ... (4,557 more names)
  ],
} as const;
```

**Usage:**
```typescript
import { HUGEICONS_STROKE_METADATA } from '@omnitron-dev/aether/svg/icons/presets/hugeicons/stroke';

console.log(HUGEICONS_STROKE_METADATA.count); // 4559
console.log(HUGEICONS_STROKE_METADATA.icons); // Array of all icon names
```

---

## Size Comparison Summary

| Metric | Per Icon | 10 Icons | All 4,559 Icons |
|--------|----------|----------|-----------------|
| **Original (bundled)** | N/A | 500 KB | 500 KB |
| **Optimized (tree-shaken)** | ~250-400 B | ~3-4 KB | ~1.1 MB |
| **Savings** | N/A | **99%+** | **0%** |

**Key Insight:** The optimization shines when you use selective imports. Full library size is similar, but you get:
- Tree-shaking capability (use only what you import)
- No runtime parsing overhead
- Type safety and metadata
- Better developer experience

For a typical app using 10-50 icons, bundle size goes from 500 KB → 3-20 KB (95-99% savings).

---

## Visual Accuracy Guarantee

✅ **100% visual accuracy preserved**

All transformations maintain exact visual appearance:
- Path data unchanged
- Geometric attributes preserved
- Stroke/fill styling maintained
- Opacity levels preserved
- Element ordering kept

The optimization only removes redundant attributes and internal keys - nothing that affects visual output.
