# HugeIcons to Aether Transformation Script

Comprehensive utility for converting HugeIcons (~4,562 icons per preset) from their array format to Aether's `IconDefinition` format with optimization.

## Overview

This script transforms HugeIcons from their bundled format into tree-shakeable, optimized TypeScript modules for use with the Aether framework.

### Features

- **Automatic Parsing**: Extracts icon definitions from HugeIcons bundled `index.js` files
- **Format Conversion**: Converts array-based format to Aether's `IconDefinition` structure
- **Optimization**:
  - Removes redundant attributes (e.g., `stroke="currentColor"` for stroke preset)
  - Minimizes attribute verbosity while preserving semantics
  - Provides size reduction metrics
- **Preset Support**: Handles all three HugeIcons presets:
  - `stroke` - Standard stroke icons
  - `duotone` - Two-tone icons with opacity and fill
  - `twotone` - Two-tone with opacity variations
- **Flexible Output**: Individual files or chunked batches for bundle optimization
- **Type Safety**: Full TypeScript support with proper exports
- **Progress Tracking**: Real-time feedback during transformation

## Installation

The script uses `tsx` for direct TypeScript execution. Ensure dependencies are installed:

```bash
pnpm install
```

## Usage

### Basic Command

```bash
npm run transform-hugeicons -- [options]
```

### Required Options

- `--preset <type>` - Icon preset: `stroke`, `duotone`, or `twotone`
- `--input <path>` - Path to HugeIcons bundled index.js file
- `--output <path>` - Output directory for generated files

### Optional Options

- `--optimize` - Enable optimization (removes redundant attributes)
- `--batch-size <number>` - Icons per file for chunked output (default: individual files)
- `--limit <number>` - Limit icons to process (useful for testing)

## Examples

### 1. Transform Stroke Preset (with optimization)

```bash
npm run transform-hugeicons -- \
  --preset stroke \
  --input experiments/hugeicons/core-stroke-rounded/dist/esm/index.js \
  --output packages/aether/src/svg/icons/presets/hugeicons \
  --optimize
```

**Output:**
- Individual TypeScript files per icon
- Main index file with re-exports
- Metadata export with icon list

### 2. Test with First 10 Icons

```bash
npm run transform-hugeicons -- \
  --preset stroke \
  --input experiments/hugeicons/core-stroke-rounded/dist/esm/index.js \
  --output packages/aether/src/svg/icons/presets/hugeicons \
  --optimize \
  --limit 10
```

**Perfect for:**
- Validating transformation logic
- Testing output format
- Debugging issues

### 3. Chunked Output (100 icons per file)

```bash
npm run transform-hugeicons -- \
  --preset duotone \
  --input experiments/hugeicons/core-duotone-rounded/dist/esm/index.js \
  --output packages/aether/src/svg/icons/presets/hugeicons \
  --optimize \
  --batch-size 100
```

**Benefits:**
- Reduces file count (46 files instead of 4,562)
- Faster bundler processing
- Still tree-shakeable with proper exports

### 4. Transform All Presets

```bash
# Stroke
npm run transform-hugeicons -- \
  --preset stroke \
  --input experiments/hugeicons/core-stroke-rounded/dist/esm/index.js \
  --output packages/aether/src/svg/icons/presets/hugeicons \
  --optimize \
  --batch-size 100

# Duotone
npm run transform-hugeicons -- \
  --preset duotone \
  --input experiments/hugeicons/core-duotone-rounded/dist/esm/index.js \
  --output packages/aether/src/svg/icons/presets/hugeicons \
  --optimize \
  --batch-size 100

# Twotone
npm run transform-hugeicons -- \
  --preset twotone \
  --input experiments/hugeicons/core-twotone-rounded/dist/esm/index.js \
  --output packages/aether/src/svg/icons/presets/hugeicons \
  --optimize \
  --batch-size 100
```

## Input Format (HugeIcons)

HugeIcons uses an array-based format:

```javascript
const FirstBracketCircleIcon = /*#__PURE__*/ [
  ["path", {
    d: "M9 8C7.7945 8.85994...",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "0"
  }],
  ["circle", {
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",
    strokeWidth: "1.5",
    key: "1"
  }]
];
```

## Output Format (Aether)

The script generates TypeScript files with `IconDefinition` objects:

```typescript
/**
 * FirstBracketCircleIcon
 * Preset: stroke
 * Auto-generated from HugeIcons
 */

import type { IconDefinition } from '../../../IconRegistry.js';

export const FirstBracketCircleIcon: IconDefinition = {
  "id": "first-bracket-circle",
  "content": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\">\n    <path d=\"M9 8C7.7945 8.85994...\" stroke-linecap=\"round\" stroke-linejoin=\"round\" />\n    <circle cx=\"12\" cy=\"12\" r=\"10\" />\n  </svg>",
  "viewBox": "0 0 24 24",
  "width": 24,
  "height": 24,
  "metadata": {
    "preset": "stroke",
    "originalName": "FirstBracketCircleIcon",
    "elementsCount": 2,
    "hasOpacity": false,
    "hasFill": false
  }
};
```

## Optimization Details

### 1. Attribute Reduction

**Redundant attributes removed:**
- `stroke="currentColor"` for stroke preset (default in Aether)
- `strokeWidth="1.5"` when it's the default
- Internal `key` attributes

**Preserved attributes:**
- `opacity` for duotone/twotone (semantic)
- `fill` for duotone (semantic)
- Path data and geometry attributes

### 2. Name Normalization

Icon names are converted from PascalCase to kebab-case:
- `FirstBracketCircleIcon` → `first-bracket-circle`
- `ThreeDViewIcon` → `three-d-view`

### 3. Size Estimation

The script provides rough gzipped size estimates:
- Original format size (array-based)
- Optimized format size (SVG content)
- Percentage savings

Typical savings: **15-25%** with optimization enabled

## Output Structure

### Individual Files Mode (default)

```
packages/aether/src/svg/icons/presets/hugeicons/
└── stroke/
    ├── first-bracket-circle.ts
    ├── first-bracket-square.ts
    ├── second-bracket-circle.ts
    ├── ...
    └── index.ts (4,562+ re-exports)
```

### Chunked Mode (--batch-size 100)

```
packages/aether/src/svg/icons/presets/hugeicons/
└── stroke/
    ├── chunk-1.ts (100 icons)
    ├── chunk-2.ts (100 icons)
    ├── ...
    ├── chunk-46.ts (62 icons)
    └── index.ts (re-exports from chunks)
```

## Statistics Report

After transformation, the script provides comprehensive statistics:

```
============================================================
📊 Transformation Statistics
============================================================
Total icons:         4562
Processed:           4562
Skipped:             0
Errors:              0

Original size:       234.56 KB (estimated)
Optimized size:      187.65 KB (estimated)
Savings:             46.91 KB (20.0%)

Duration:            12.34s
============================================================

✅ Transformation complete!
```

## Usage in Aether

Once transformed, icons can be used in Aether applications:

```typescript
import { IconRegistry } from '@omnitron-dev/aether/svg/icons';
import { FirstBracketCircleIcon } from '@omnitron-dev/aether/svg/icons/presets/hugeicons/stroke';

// Register icon set
const registry = new IconRegistry();
registry.register({
  name: 'hugeicons',
  type: 'inline',
  source: { 'first-bracket-circle': FirstBracketCircleIcon },
  prefix: 'hi',
});

// Use in components
<Icon name="hi:first-bracket-circle" size={24} />
```

Or with tree-shaking (import only what you need):

```typescript
import { FirstBracketCircleIcon } from '@omnitron-dev/aether/svg/icons/presets/hugeicons/stroke';

// Direct usage
<Icon definition={FirstBracketCircleIcon} size={24} />
```

## Troubleshooting

### Issue: "Failed to parse icon"

**Cause:** Complex nested structures or malformed input

**Solution:** Check the input file format, ensure it matches HugeIcons structure

### Issue: "Invalid element format"

**Cause:** Unexpected array structure in icon definition

**Solution:** Verify the icon uses the standard `["tag", {attrs}]` format

### Issue: High error count

**Cause:** Input file may be corrupted or incompatible version

**Solution:** Re-download HugeIcons, ensure you're using the ESM bundle

### Issue: Large bundle size

**Cause:** Using individual files mode with large icon set

**Solution:** Use `--batch-size` option to chunk icons (recommended: 50-200)

## Best Practices

1. **Always use `--optimize`** to reduce bundle size
2. **Use `--batch-size 100`** for production builds (balances file count vs bundle size)
3. **Test with `--limit 10`** before full transformation
4. **Transform all presets separately** to maintain clear organization
5. **Commit generated files** to version control for consistent builds

## Performance

Typical transformation times:
- **4,562 icons**: ~12-15 seconds
- **10 icons (testing)**: ~0.5 seconds
- **Memory usage**: ~100-150 MB peak

The script is designed to handle large icon sets efficiently with streaming processing.

## Future Enhancements

Potential improvements for future versions:
- SVG path optimization using SVGO
- Path merging for multi-path icons
- Metadata extraction (categories, tags)
- Icon search index generation
- Validation and linting
- Incremental updates (only changed icons)

## License

This script is part of the Omnitron monorepo and follows the same license.
