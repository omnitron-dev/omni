# Scripts Directory

This directory contains build, transformation, and utility scripts for the Omnitron monorepo.

## HugeIcons Transformation

### Files

| File | Description | Size |
|------|-------------|------|
| `transform-hugeicons.ts` | Main transformation script | 738 lines |
| `TRANSFORMATION-REPORT.md` | Automated transformation report | Auto-generated |
| `TRANSFORMATION-SUMMARY.md` | Complete transformation summary | Comprehensive |
| `README-transform-hugeicons.md` | Original transformation docs | Reference |

### Quick Start

Transform ALL HugeIcons (13,677 icons across 3 presets):

```bash
npx tsx scripts/transform-hugeicons.ts
```

This will:
1. Parse all icons from `/experiments/hugeicons/`
2. Transform to Aether format
3. Generate TypeScript files in `/packages/aether/src/svg/icons/presets/hugeicons/`
4. Create index files with exports and metadata
5. Generate transformation reports

**Duration:** ~1.5 seconds
**Output:** 13,680 files (13,677 icons + 3 index files)

### What Gets Generated

```
packages/aether/src/svg/icons/presets/hugeicons/
├── stroke/
│   ├── index.ts                    # Exports + metadata
│   ├── first-bracket-circle.ts     # Individual icon
│   └── ... (4,559 icons total)
├── duotone/
│   ├── index.ts
│   └── ... (4,559 icons)
└── twotone/
    ├── index.ts
    └── ... (4,559 icons)
```

### Transformation Features

- ✅ Parse HugeIcons JavaScript ESM bundles
- ✅ Convert to individual TypeScript files
- ✅ Optimize SVG attributes (remove defaults)
- ✅ Merge duplicate paths (duotone preset)
- ✅ Generate type-safe `IconDefinition` exports
- ✅ Create preset metadata and indices
- ✅ 17% size reduction overall
- ✅ Tree-shakeable exports

### Preset-Specific Optimizations

#### Stroke
- Simple path merging
- Remove `stroke="currentColor"` (default)
- Remove `strokeWidth="1.5"` (default)
- **Result:** 14.5% size reduction

#### Duotone
- **Duplicate path detection & merging** (2,047 paths merged!)
- Combine fill + stroke on same path
- Preserve opacity for visual effects
- **Result:** 20.7% size reduction (best!)

#### Twotone
- Opacity handling
- Attribute optimization
- **Result:** 13.9% size reduction

### Generated Icon Format

Each icon follows this structure:

```typescript
import type { IconDefinition } from '../../../IconRegistry.js';

export const IconName: IconDefinition = {
  id: "icon-name",
  content: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\">
    <path d=\"...\" />
  </svg>",
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  metadata: {
    preset: "stroke",
    originalName: "IconName",
    elementsCount: 2,
    hasOpacity: false,
    hasFill: false
  }
};
```

### Usage Examples

#### Import Individual Icons
```typescript
import { FirstBracketCircleIcon } from '@/svg/icons/presets/hugeicons/stroke';
import { ThreeDViewIcon } from '@/svg/icons/presets/hugeicons/duotone';
```

#### Import All Icons from Preset
```typescript
import * as StrokeIcons from '@/svg/icons/presets/hugeicons/stroke';
```

#### Access Preset Metadata
```typescript
import { HUGEICONS_STROKE_METADATA } from '@/svg/icons/presets/hugeicons/stroke';

console.log(HUGEICONS_STROKE_METADATA);
// {
//   preset: 'stroke',
//   count: 4559,
//   license: 'CC BY 4.0',
//   source: 'https://hugeicons.com'
// }
```

### Script Options

The transformation script is fully automated and requires no configuration. It:
- Automatically detects source files in `/experiments/hugeicons/`
- Creates output directories as needed
- Generates comprehensive reports
- Provides real-time progress updates

### Statistics

| Metric | Value |
|--------|-------|
| Total Icons | 13,677 |
| Presets | 3 (stroke, duotone, twotone) |
| Success Rate | 100% |
| Processing Time | ~1.5s |
| Size Reduction | 17% |
| Duplicate Paths Merged | 2,047 |
| Icons per Second | ~8,938 |

### Quality Validation

- ✅ 0 icons with missing elements
- ✅ 0 parsing errors
- ✅ 0 skipped icons
- ✅ All visual information preserved
- ✅ Full TypeScript type safety
- ✅ Tree-shakeable exports

### Documentation

For detailed information, see:
- **TRANSFORMATION-REPORT.md** - Automated report with statistics
- **TRANSFORMATION-SUMMARY.md** - Complete transformation overview
- **README-transform-hugeicons.md** - Original planning docs
- **HUGEICONS-INTEGRATION-PLAN.md** - Integration roadmap (in packages/aether/)
- **HUGEICONS-PRESET-ANALYSIS.md** - Preset comparison (in experiments/hugeicons/)

## Other Scripts

Add documentation for other scripts here as they are created.

---

## Development

### Running Scripts

All scripts should be run from the monorepo root:

```bash
npx tsx scripts/<script-name>.ts
```

### Adding New Scripts

1. Create TypeScript file in `/scripts/`
2. Add executable shebang: `#!/usr/bin/env tsx`
3. Document in this README
4. Test thoroughly before committing

### Script Guidelines

- Use TypeScript for type safety
- Provide progress feedback for long operations
- Generate reports for transformation scripts
- Handle errors gracefully
- Include comprehensive logging
- Make scripts idempotent when possible

---

**Last Updated:** October 16, 2025
