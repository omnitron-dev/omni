# HugeIcons Transformation - Quick Start Guide

## One-Line Commands

### Test (10 icons, ~0.2s)
```bash
npm run transform-hugeicons -- --preset stroke --input experiments/hugeicons/core-stroke-rounded/dist/esm/index.js --output packages/aether/src/svg/icons/presets/hugeicons --optimize --limit 10
```

### Production - Stroke Preset (~2 min)
```bash
npm run transform-hugeicons -- --preset stroke --input experiments/hugeicons/core-stroke-rounded/dist/esm/index.js --output packages/aether/src/svg/icons/presets/hugeicons --optimize --batch-size 100
```

### Production - Duotone Preset (~2 min)
```bash
npm run transform-hugeicons -- --preset duotone --input experiments/hugeicons/core-duotone-rounded/dist/esm/index.js --output packages/aether/src/svg/icons/presets/hugeicons --optimize --batch-size 100
```

### Production - Twotone Preset (~2 min)
```bash
npm run transform-hugeicons -- --preset twotone --input experiments/hugeicons/core-twotone-rounded/dist/esm/index.js --output packages/aether/src/svg/icons/presets/hugeicons --optimize --batch-size 100
```

## Options Reference

| Option | Values | Description |
|--------|--------|-------------|
| `--preset` | stroke, duotone, twotone | **Required.** Icon preset to transform |
| `--input` | path | **Required.** HugeIcons index.js file |
| `--output` | path | **Required.** Output directory |
| `--optimize` | flag | Enable optimization (recommended) |
| `--batch-size` | number | Icons per file (100 recommended) |
| `--limit` | number | Limit icons (for testing) |

## Usage in Code

### Tree-Shakeable Import
```typescript
import { FirstBracketCircleIcon } from '@omnitron-dev/aether/svg/icons/presets/hugeicons/stroke';
<Icon definition={FirstBracketCircleIcon} size={24} />
```

### Registry
```typescript
import * as Icons from '@omnitron-dev/aether/svg/icons/presets/hugeicons/stroke';
registry.register({ name: 'hugeicons', type: 'inline', source: Icons });
<Icon name="FirstBracketCircleIcon" size={24} />
```

## Expected Output

```
🚀 Starting HugeIcons transformation
   Preset: stroke
   Input: experiments/hugeicons/core-stroke-rounded/dist/esm/index.js
   Output: packages/aether/src/svg/icons/presets/hugeicons
   Optimize: Yes
   Batch size: 100

📖 Parsing HugeIcons file...
   Found 4559 icons

🔄 Transforming icons...
   Processed 100/4559 icons...
   Processed 200/4559 icons...
   ...

📝 Generating output files...
✓ Generated 46 chunked files in packages/aether/src/svg/icons/presets/hugeicons/stroke
✓ Generated index file

============================================================
📊 Transformation Statistics
============================================================
Total icons:         4559
Processed:           4559
Skipped:             0
Errors:              0

Original size:       1120.50 KB (estimated)
Optimized size:      896.40 KB (estimated)
Savings:             224.10 KB (20.0%)

Duration:            106.23s
============================================================

✅ Transformation complete!
```

## Files

- **Script:** `scripts/transform-hugeicons.ts`
- **Docs:** `scripts/README-transform-hugeicons.md`
- **Report:** `scripts/TRANSFORMATION-REPORT.md`
- **Summary:** `scripts/SUMMARY.md`

## Help
```bash
npm run transform-hugeicons -- --help
```
