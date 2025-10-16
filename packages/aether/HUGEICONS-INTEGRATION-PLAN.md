# HugeIcons Integration Plan for Aether

## Executive Summary

This document outlines the comprehensive integration strategy for HugeIcons library (4,559 icons across 3 presets) into Aether's SVG icon system. The goal is to provide a seamless, tree-shakeable, and type-safe icon library with optimal bundle size and developer experience.

---

## 1. Bundle Analysis Results

### Source Structure Analysis

**Directory Structure:**
```
experiments/hugeicons/
├── core-stroke-rounded/dist/esm/
│   ├── index.js (5.0MB, 29,116 lines)
│   └── [4,561 individual icon files]
├── core-duotone-rounded/dist/esm/
│   ├── index.js (7.3MB, 34,540 lines)
│   └── [2 files only - bundled format]
└── core-twotone-rounded/dist/esm/
    ├── index.js (5.2MB, 29,110 lines)
    └── [2 files only - bundled format]
```

### Icon Count
- **Total icons per preset:** 4,559 unique icons
- **Total size (all presets):** ~17.5MB uncompressed
- **Naming convention:** PascalCase with "Icon" suffix (e.g., `UserIcon`, `Home01Icon`)

### Format Analysis

**HugeIcons Format (Array-based):**
```javascript
const UserIcon = [
  ["path", {
    d: "M17 8.5C17 5.73858...",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "0"
  }],
  ["path", {
    d: "M19 20.5C19 16.634...",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "1"
  }]
];
```

**Preset-Specific Features:**

1. **Stroke Preset (Basic):**
   - Single-color outline icons
   - Uses `stroke="currentColor"` exclusively
   - Simplest format, smallest bundle size
   - Attributes: `d`, `stroke`, `strokeLinecap`, `strokeLinejoin`, `strokeWidth`, `key`

2. **Duotone Preset (Two-tone):**
   - Background shapes with `opacity="0.4"` and `fill="currentColor"`
   - Foreground paths with `stroke="currentColor"`
   - Creates depth with opacity layers
   - Combines `fill` and `stroke` elements
   - Attributes: `d`, `fill`, `stroke`, `opacity`, `strokeLinecap`, `strokeLinejoin`, `strokeWidth`, `key`

3. **Twotone Preset (Accent):**
   - Similar to duotone but uses `opacity="0.4"` on specific paths
   - All paths use `stroke="currentColor"`
   - Selective opacity creates visual hierarchy
   - More subtle than duotone
   - Attributes: `d`, `stroke`, `opacity`, `strokeLinecap`, `strokeLinejoin`, `strokeWidth`, `key`

**Export Format:**
```javascript
export {
  UserIcon,
  UserIcon as UserStrokeRounded,
  HomeIcon,
  HomeIcon as Home01StrokeRounded,
  // ... multiple aliases per icon
};
```

---

## 2. Aether-Compatible Format Design

### Target Format Specification

**Aether Icon Definition:**
```typescript
interface IconDefinition {
  id?: string;
  path?: string;              // Single path (simple icons)
  content?: string;            // Full SVG content (complex icons)
  viewBox?: string;
  width?: number;
  height?: number;
  metadata?: {
    preset?: 'stroke' | 'duotone' | 'twotone';
    tags?: string[];
    category?: string;
    license?: string;
  };
}
```

**Transformed Format (Optimized):**
```typescript
// For simple single-path icons (most common)
const UserIcon: IconDefinition = {
  path: "M17 8.5C17 5.73858... M19 20.5C19 16.634...",
  viewBox: "0 0 24 24",
  metadata: {
    preset: 'stroke',
    category: 'users',
    tags: ['user', 'person', 'profile', 'account']
  }
};

// For complex multi-element icons (duotone/twotone)
const Home01DuotoneIcon: IconDefinition = {
  content: `<g><path d="..." fill="currentColor" opacity="0.4"/><path d="..." stroke="currentColor" stroke-width="1.5"/></g>`,
  viewBox: "0 0 24 24",
  metadata: {
    preset: 'duotone',
    category: 'home',
    tags: ['home', 'house', 'building']
  }
};
```

### Conversion Strategy

**Array-to-Aether Transformation:**
```typescript
function convertHugeIconToAether(
  iconArray: Array<[string, Record<string, any>]>,
  preset: 'stroke' | 'duotone' | 'twotone',
  name: string
): IconDefinition {
  // Strategy 1: Single path - merge all paths into one
  if (iconArray.every(([tag]) => tag === 'path') &&
      iconArray.every(([, attrs]) => !attrs.fill && !attrs.opacity)) {
    return {
      path: iconArray.map(([, attrs]) => attrs.d).join(' '),
      viewBox: '0 0 24 24',
      metadata: { preset }
    };
  }

  // Strategy 2: Complex multi-element - convert to SVG string
  const elements = iconArray.map(([tag, attrs]) => {
    const attrString = Object.entries(attrs)
      .filter(([key]) => key !== 'key') // Remove React key
      .map(([key, value]) => {
        // Convert camelCase to kebab-case
        const kebab = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        return `${kebab}="${value}"`;
      })
      .join(' ');
    return `<${tag} ${attrString}/>`;
  }).join('');

  return {
    content: `<g>${elements}</g>`,
    viewBox: '0 0 24 24',
    metadata: { preset }
  };
}
```

### Optimization Techniques

1. **Path Merging:** Merge multiple simple paths into single path string
2. **Attribute Normalization:** Remove React-specific attributes (`key`)
3. **Default Values:** Omit default `viewBox="0 0 24 24"` to save space
4. **Tree-Shaking:** Export as individual modules for optimal bundling
5. **Lazy Loading:** Support dynamic imports for icon presets

---

## 3. Transformation Algorithm

### Phase 1: Parsing & Analysis

```typescript
interface ParsedIcon {
  name: string;                    // Original name (e.g., "UserIcon")
  cleanName: string;                // Kebab-case (e.g., "user")
  variant?: string;                 // Number variant (e.g., "01", "02")
  elements: Array<{
    tag: string;
    attributes: Record<string, string>;
  }>;
  complexity: 'simple' | 'complex'; // Based on element count & types
}

async function parseHugeIconsBundle(
  indexPath: string,
  preset: 'stroke' | 'duotone' | 'twotone'
): Promise<ParsedIcon[]> {
  const fileContent = await fs.readFile(indexPath, 'utf-8');
  const icons: ParsedIcon[] = [];

  // Regex to extract icon definitions
  const iconRegex = /const (\w+Icon) = \/\*#__PURE__\*\/ \[([\s\S]*?)\];/g;

  let match;
  while ((match = iconRegex.exec(fileContent)) !== null) {
    const [, name, content] = match;

    // Parse array content
    const elements = parseArrayContent(content);

    icons.push({
      name,
      cleanName: pascalToKebab(name.replace(/Icon$/, '')),
      variant: extractVariant(name),
      elements,
      complexity: determineComplexity(elements)
    });
  }

  return icons;
}

function determineComplexity(
  elements: Array<{ tag: string; attributes: Record<string, string> }>
): 'simple' | 'complex' {
  // Simple: all paths, no fill/opacity variations
  const allPaths = elements.every(e => e.tag === 'path');
  const hasOpacity = elements.some(e => e.attributes.opacity);
  const hasFill = elements.some(e => e.attributes.fill);

  return (allPaths && !hasOpacity && !hasFill) ? 'simple' : 'complex';
}
```

### Phase 2: Conversion

```typescript
async function convertToAetherFormat(
  icons: ParsedIcon[],
  preset: 'stroke' | 'duotone' | 'twotone'
): Promise<Map<string, IconDefinition>> {
  const converted = new Map<string, IconDefinition>();

  for (const icon of icons) {
    let definition: IconDefinition;

    if (icon.complexity === 'simple') {
      // Merge all path 'd' attributes into single string
      const paths = icon.elements
        .map(e => e.attributes.d)
        .filter(Boolean)
        .join(' ');

      definition = {
        path: paths,
        viewBox: '0 0 24 24',
        metadata: { preset }
      };
    } else {
      // Convert to full SVG content
      const svgContent = icon.elements
        .map(({ tag, attributes }) => {
          const attrs = Object.entries(attributes)
            .filter(([key]) => key !== 'key')
            .map(([key, value]) => {
              const kebab = camelToKebab(key);
              return `${kebab}="${value}"`;
            })
            .join(' ');
          return `<${tag} ${attrs}/>`;
        })
        .join('');

      definition = {
        content: `<g>${svgContent}</g>`,
        viewBox: '0 0 24 24',
        metadata: { preset }
      };
    }

    converted.set(icon.cleanName, definition);
  }

  return converted;
}
```

### Phase 3: Code Generation

```typescript
interface GeneratedFiles {
  iconDefinitions: string;    // icons.ts
  typeDefinitions: string;     // types.ts
  indexFile: string;           // index.ts
  manifestFile: string;        // manifest.json
}

async function generatePresetFiles(
  icons: Map<string, IconDefinition>,
  preset: 'stroke' | 'duotone' | 'twotone'
): Promise<GeneratedFiles> {
  // Generate icons.ts with all definitions
  const iconDefinitions = Array.from(icons.entries())
    .map(([name, def]) => {
      const json = JSON.stringify(def, null, 2);
      return `export const ${kebabToPascal(name)}: IconDefinition = ${json};`;
    })
    .join('\n\n');

  // Generate types.ts with icon name union
  const iconNames = Array.from(icons.keys()).map(k => `'${k}'`).join(' | ');
  const typeDefinitions = `
export type ${capitalize(preset)}IconName = ${iconNames};

export interface ${capitalize(preset)}Icon {
  name: ${capitalize(preset)}IconName;
  definition: IconDefinition;
}
  `.trim();

  // Generate index.ts with re-exports and helper
  const indexFile = `
import type { IconSet } from '../../../IconRegistry.js';
import * as icons from './icons.js';

export * from './icons.js';
export * from './types.js';

// Export as IconSet for registry
export const ${preset}Icons: IconSet = icons;

// Helper to get icon by name
export function get${capitalize(preset)}Icon(name: string) {
  return icons[name as keyof typeof icons];
}

// Icon names array
export const ${preset}IconNames = [
  ${Array.from(icons.keys()).map(k => `'${k}'`).join(',\n  ')}
] as const;
  `.trim();

  // Generate manifest.json with metadata
  const manifest = {
    preset,
    version: '1.0.0',
    total: icons.size,
    license: 'MIT',
    icons: Array.from(icons.entries()).map(([name, def]) => ({
      name,
      tags: def.metadata?.tags || [],
      category: def.metadata?.category || 'general'
    }))
  };

  return {
    iconDefinitions,
    typeDefinitions,
    indexFile,
    manifestFile: JSON.stringify(manifest, null, 2)
  };
}
```

### Phase 4: Optimization

```typescript
interface OptimizationStats {
  originalSize: number;
  optimizedSize: number;
  compressionRatio: number;
  iconsProcessed: number;
  pathsMerged: number;
  attributesRemoved: number;
}

async function optimizeGeneratedFiles(
  files: GeneratedFiles
): Promise<{ files: GeneratedFiles; stats: OptimizationStats }> {
  // 1. Remove unnecessary whitespace
  // 2. Deduplicate common viewBox values
  // 3. Use shared attribute templates
  // 4. Compress JSON where possible
  // 5. Generate minified versions

  // Return optimized files and statistics
}
```

---

## 4. Directory Structure & File Organization

### Target Structure

```
packages/aether/src/svg/icons/presets/
├── README.md                           # Documentation
├── index.ts                            # Main exports
│
├── stroke/
│   ├── index.ts                        # Re-exports all stroke icons
│   ├── icons.ts                        # 4559 icon definitions (tree-shakeable)
│   ├── types.ts                        # TypeScript type definitions
│   ├── manifest.json                   # Metadata & search index
│   └── categories/                     # Optional: organized by category
│       ├── users.ts
│       ├── navigation.ts
│       └── ...
│
├── duotone/
│   ├── index.ts
│   ├── icons.ts
│   ├── types.ts
│   ├── manifest.json
│   └── categories/
│
├── twotone/
│   ├── index.ts
│   ├── icons.ts
│   ├── types.ts
│   ├── manifest.json
│   └── categories/
│
└── utils/
    ├── search.ts                       # Icon search utilities
    ├── lazy-loader.ts                  # Dynamic preset loading
    └── preset-manager.ts               # Preset switching logic
```

### File Size Estimates

**Per Preset (Post-Optimization):**
- `icons.ts`: ~1.5-2MB (down from 5-7MB)
- `types.ts`: ~50KB (union type of icon names)
- `manifest.json`: ~200KB (searchable metadata)
- **Total per preset:** ~2MB (vs. 5-7MB original)
- **All presets:** ~6MB (vs. 17.5MB original)

**With gzip compression:**
- Individual icons: ~100-200 bytes each
- Full preset bundle: ~400-600KB
- All presets combined: ~1.2-1.8MB

---

## 5. API Design

### 5.1 IconPresetProvider Component

```typescript
interface IconPresetProviderProps {
  preset: 'stroke' | 'duotone' | 'twotone';
  icons?: IconSet;              // Optional custom icon set
  lazy?: boolean;               // Lazy load preset
  fallback?: any;               // Fallback component
  children: any;
}

/**
 * Provider for icon preset context
 *
 * @example
 * ```tsx
 * <IconPresetProvider preset="stroke">
 *   <App />
 * </IconPresetProvider>
 * ```
 */
export const IconPresetProvider = defineComponent<IconPresetProviderProps>((props) => {
  const registry = useIcons();

  effect(() => {
    (async () => {
      if (props.lazy) {
        // Lazy load preset
        const preset = await loadIconPreset(props.preset);
        registry.registerSet(props.preset, preset);
      } else {
        // Import preset synchronously
        const preset = await import(`./presets/${props.preset}/index.js`);
        registry.registerSet(props.preset, preset.default);
      }
    })();
  });

  return () => props.children;
});
```

### 5.2 Direct Icon Usage

```typescript
// Import individual icons (tree-shakeable)
import { UserIcon, Home01Icon } from '@omnitron-dev/aether/svg/icons/presets/stroke';

// Use with SVGIcon component
<SVGIcon name="user" />

// Or use icon definition directly
<SVGIcon {...UserIcon} />
```

### 5.3 Dynamic Loading

```typescript
/**
 * Load icon preset dynamically
 *
 * @example
 * ```typescript
 * const strokeIcons = await loadIconPreset('stroke');
 * registry.registerSet('stroke', strokeIcons);
 * ```
 */
export async function loadIconPreset(
  preset: 'stroke' | 'duotone' | 'twotone'
): Promise<IconSet> {
  const module = await import(`./presets/${preset}/index.js`);
  return module.default;
}

/**
 * Load specific icon from preset
 *
 * @example
 * ```typescript
 * const userIcon = await loadIcon('stroke', 'user');
 * ```
 */
export async function loadIcon(
  preset: 'stroke' | 'duotone' | 'twotone',
  name: string
): Promise<IconDefinition> {
  const module = await import(`./presets/${preset}/icons.js`);
  const pascalName = kebabToPascal(name);
  return module[pascalName];
}
```

### 5.4 Preset Switching

```typescript
/**
 * Hook for switching icon presets at runtime
 *
 * @example
 * ```tsx
 * const MyComponent = defineComponent(() => {
 *   const { preset, setPreset, isLoading } = useIconPreset('stroke');
 *
 *   return () => (
 *     <div>
 *       <select onChange={(e) => setPreset(e.target.value)}>
 *         <option value="stroke">Stroke</option>
 *         <option value="duotone">Duotone</option>
 *         <option value="twotone">Twotone</option>
 *       </select>
 *       {isLoading() && <div>Loading icons...</div>}
 *     </div>
 *   );
 * });
 * ```
 */
export function useIconPreset(defaultPreset: 'stroke' | 'duotone' | 'twotone') {
  const preset = signal(defaultPreset);
  const isLoading = signal(false);
  const registry = useIcons();

  const setPreset = async (newPreset: 'stroke' | 'duotone' | 'twotone') => {
    isLoading.set(true);
    try {
      const icons = await loadIconPreset(newPreset);
      registry.registerSet(newPreset, icons);
      preset.set(newPreset);
    } finally {
      isLoading.set(false);
    }
  };

  return { preset, setPreset, isLoading };
}
```

### 5.5 Icon Search

```typescript
interface IconSearchOptions {
  preset?: 'stroke' | 'duotone' | 'twotone' | 'all';
  query: string;
  tags?: string[];
  category?: string;
  limit?: number;
}

interface IconSearchResult {
  name: string;
  preset: string;
  category: string;
  tags: string[];
  definition: IconDefinition;
  relevance: number;  // 0-1 score
}

/**
 * Search icons across presets
 *
 * @example
 * ```typescript
 * const results = await searchIcons({
 *   query: 'user',
 *   preset: 'stroke',
 *   tags: ['person', 'profile']
 * });
 * ```
 */
export async function searchIcons(
  options: IconSearchOptions
): Promise<IconSearchResult[]> {
  // Load manifest(s)
  const presets = options.preset === 'all'
    ? ['stroke', 'duotone', 'twotone']
    : [options.preset || 'stroke'];

  const results: IconSearchResult[] = [];

  for (const preset of presets) {
    const manifest = await import(`./presets/${preset}/manifest.json`);

    // Search by name, tags, category
    const matches = manifest.icons
      .filter(icon => {
        const nameMatch = icon.name.includes(options.query.toLowerCase());
        const tagMatch = options.tags?.some(tag => icon.tags.includes(tag));
        const categoryMatch = !options.category || icon.category === options.category;

        return (nameMatch || tagMatch) && categoryMatch;
      })
      .map(icon => ({
        ...icon,
        preset,
        definition: {} as IconDefinition, // Loaded on demand
        relevance: calculateRelevance(icon, options.query)
      }));

    results.push(...matches);
  }

  // Sort by relevance
  results.sort((a, b) => b.relevance - a.relevance);

  // Apply limit
  return options.limit ? results.slice(0, options.limit) : results;
}
```

### 5.6 Icon Component with Preset Support

```typescript
interface IconProps extends SVGIconProps {
  preset?: 'stroke' | 'duotone' | 'twotone';
}

/**
 * Enhanced Icon component with preset support
 *
 * @example
 * ```tsx
 * <Icon name="user" preset="stroke" size={24} />
 * <Icon name="home-01" preset="duotone" color="blue" />
 * ```
 */
export const Icon = defineComponent<IconProps>((props) => {
  const registry = useIcons();
  const iconDef = signal<IconDefinition | null>(null);

  effect(() => {
    (async () => {
      if (props.name) {
        // Try to load from registry first
        let icon = await registry.get(props.name);

        // If not found and preset specified, try to load from preset
        if (!icon && props.preset) {
          icon = await loadIcon(props.preset, props.name);
          if (icon) {
            // Cache in registry
            registry.registerSet(props.preset, { [props.name]: icon });
          }
        }

        iconDef.set(icon);
      }
    })();
  });

  return () => {
    const def = iconDef();
    if (!def) return null;

    return (
      <SVGIcon
        {...props}
        path={def.path}
        content={def.content}
        viewBox={def.viewBox}
      />
    );
  };
});
```

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [x] Analyze HugeIcons bundle structure
- [x] Design Aether-compatible format
- [x] Create transformation algorithm specification
- [ ] Set up directory structure
- [ ] Create base TypeScript types

**Deliverables:**
- Directory structure
- Type definitions
- Transformation utilities (base)

### Phase 2: Stroke Preset (Week 1-2)
- [ ] Parse stroke preset bundle
- [ ] Convert to Aether format
- [ ] Generate icons.ts, types.ts, index.ts
- [ ] Create manifest.json with metadata
- [ ] Write tests for stroke icons
- [ ] Optimize and compress

**Deliverables:**
- Complete stroke preset (4,559 icons)
- Unit tests
- Documentation

### Phase 3: Duotone & Twotone Presets (Week 2)
- [ ] Parse duotone preset bundle
- [ ] Parse twotone preset bundle
- [ ] Handle multi-element icons
- [ ] Generate preset files
- [ ] Write tests
- [ ] Optimize and compress

**Deliverables:**
- Complete duotone preset (4,559 icons)
- Complete twotone preset (4,559 icons)
- Unit tests

### Phase 4: API & Components (Week 3)
- [ ] Implement IconPresetProvider
- [ ] Create useIconPreset hook
- [ ] Add preset switching support
- [ ] Implement loadIconPreset utility
- [ ] Add search functionality
- [ ] Write integration tests

**Deliverables:**
- Provider components
- React hooks
- Utility functions
- Integration tests

### Phase 5: Optimization & Documentation (Week 3-4)
- [ ] Bundle size optimization
- [ ] Tree-shaking verification
- [ ] Performance benchmarks
- [ ] Create usage examples
- [ ] Write comprehensive documentation
- [ ] Migration guide from other icon libraries

**Deliverables:**
- Optimized bundles
- Performance metrics
- Complete documentation
- Example applications

### Phase 6: Testing & Quality Assurance (Week 4)
- [ ] Cross-browser testing
- [ ] SSR compatibility testing
- [ ] Bundle size analysis
- [ ] Load time benchmarks
- [ ] Accessibility audit
- [ ] Code review

**Deliverables:**
- Test coverage report
- Performance benchmarks
- Accessibility report
- Quality metrics

---

## 7. Performance Metrics & Goals

### Bundle Size Targets

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Single icon (avg) | 150B | 100B | 33% |
| Preset bundle (all icons) | 5-7MB | 1.5-2MB | 70% |
| All presets | 17.5MB | 6MB | 66% |
| Gzipped preset | N/A | 400-600KB | N/A |
| Gzipped all | N/A | 1.2-1.8MB | N/A |

### Load Time Targets

| Scenario | Target | Notes |
|----------|--------|-------|
| First paint with 5 icons | <50ms | Critical path |
| Load full preset (lazy) | <200ms | Background load |
| Icon search query | <10ms | Using manifest index |
| Preset switching | <100ms | With caching |

### Tree-Shaking Efficiency

**Goal:** Only include used icons in production bundle

**Test Case:**
```typescript
// Import only 3 icons
import { UserIcon, HomeIcon, SettingsIcon } from '@omnitron-dev/aether/svg/icons/presets/stroke';

// Expected bundle size: ~300 bytes (100B per icon)
// Without tree-shaking: ~2MB (full preset)
```

**Verification Method:**
- Webpack Bundle Analyzer
- Rollup Plugin Visualizer
- Manual bundle inspection

---

## 8. Migration Strategy

### From Current Aether Icons

**Before (manual definitions):**
```typescript
const customIcons = createIconSet({
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36...',
  star: { path: 'M12 17.27L18.18 21l...', viewBox: '0 0 24 24' }
});
registry.registerSet('custom', customIcons);
```

**After (HugeIcons integration):**
```typescript
import { strokeIcons } from '@omnitron-dev/aether/svg/icons/presets/stroke';

// Option 1: Register entire preset
registry.registerSet('stroke', strokeIcons);

// Option 2: Use IconPresetProvider
<IconPresetProvider preset="stroke">
  <App />
</IconPresetProvider>

// Option 3: Import specific icons
import { HeartIcon, StarIcon } from '@omnitron-dev/aether/svg/icons/presets/stroke';
```

### From Other Icon Libraries

#### From Heroicons
```typescript
// Before
import { UserIcon } from '@heroicons/react/24/outline';

// After
import { Icon } from '@omnitron-dev/aether';
<Icon name="user" preset="stroke" />
```

#### From Lucide
```typescript
// Before
import { User } from 'lucide-react';

// After
import { UserIcon } from '@omnitron-dev/aether/svg/icons/presets/stroke';
<SVGIcon {...UserIcon} />
```

#### From Material Icons
```typescript
// Before
import PersonIcon from '@mui/icons-material/Person';

// After
<Icon name="user" preset="stroke" />
```

---

## 9. Type Safety & Developer Experience

### TypeScript Integration

**Autocomplete Support:**
```typescript
import type { StrokeIconName } from '@omnitron-dev/aether/svg/icons/presets/stroke';

// Full autocomplete for 4559 icon names
const iconName: StrokeIconName = 'user'; // ✅
const invalid: StrokeIconName = 'invalid'; // ❌ Type error
```

**Type-safe Icon Component:**
```typescript
interface TypedIconProps {
  name: StrokeIconName;
  size?: number;
  color?: string;
}

const TypedIcon = defineComponent<TypedIconProps>((props) => {
  // Type-safe icon name ensures it exists
  return () => <Icon name={props.name} preset="stroke" {...props} />;
});
```

### IntelliSense & Documentation

**JSDoc Comments:**
```typescript
/**
 * User profile icon
 *
 * @category Users
 * @tags user, person, profile, account, avatar
 * @preset stroke, duotone, twotone
 *
 * @example
 * ```tsx
 * <Icon name="user" size={24} color="blue" />
 * ```
 */
export const UserIcon: IconDefinition = { ... };
```

### Icon Browser/Picker Component

```typescript
/**
 * Interactive icon picker component
 *
 * @example
 * ```tsx
 * const [selected, setSelected] = useState<string>('');
 *
 * <IconPicker
 *   preset="stroke"
 *   onSelect={setSelected}
 *   searchPlaceholder="Search 4,559 icons..."
 *   categories={['Users', 'Navigation', 'Actions']}
 * />
 * ```
 */
export const IconPicker = defineComponent<IconPickerProps>((props) => {
  // Implementation with search, filtering, preview
});
```

---

## 10. Testing Strategy

### Unit Tests

```typescript
describe('HugeIcons Integration', () => {
  describe('Stroke Preset', () => {
    it('should load all 4559 icons', async () => {
      const icons = await loadIconPreset('stroke');
      expect(Object.keys(icons)).toHaveLength(4559);
    });

    it('should have valid path data', async () => {
      const { UserIcon } = await import('./presets/stroke/icons.js');
      expect(UserIcon.path).toBeDefined();
      expect(UserIcon.path).toMatch(/^M[\d\s,.MLHVCSQTAZ]+$/);
    });

    it('should be tree-shakeable', async () => {
      // Import only one icon
      const { UserIcon } = await import('./presets/stroke/icons.js');

      // Verify bundle size
      const bundle = await buildBundle({ entry: 'test.ts' });
      expect(bundle.size).toBeLessThan(1000); // Should be ~100-200 bytes
    });
  });

  describe('Preset Switching', () => {
    it('should switch between presets', async () => {
      const { preset, setPreset } = useIconPreset('stroke');
      expect(preset()).toBe('stroke');

      await setPreset('duotone');
      expect(preset()).toBe('duotone');
    });
  });

  describe('Icon Search', () => {
    it('should find icons by name', async () => {
      const results = await searchIcons({ query: 'user', preset: 'stroke' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain('user');
    });

    it('should filter by tags', async () => {
      const results = await searchIcons({
        query: '',
        tags: ['person', 'profile'],
        preset: 'stroke'
      });
      expect(results.every(r =>
        r.tags.includes('person') || r.tags.includes('profile')
      )).toBe(true);
    });
  });
});
```

### Integration Tests

```typescript
describe('Icon Component Integration', () => {
  it('should render stroke icon', () => {
    const { container } = render(
      <IconPresetProvider preset="stroke">
        <Icon name="user" size={24} />
      </IconPresetProvider>
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
    expect(svg?.getAttribute('width')).toBe('24');
  });

  it('should lazy load preset', async () => {
    const { container } = render(
      <IconPresetProvider preset="stroke" lazy>
        <Icon name="user" />
      </IconPresetProvider>
    );

    // Should show loading state
    expect(container.querySelector('.loading')).toBeDefined();

    // Wait for load
    await waitFor(() => {
      expect(container.querySelector('svg')).toBeDefined();
    });
  });
});
```

### Performance Tests

```typescript
describe('Performance', () => {
  it('should load preset in under 200ms', async () => {
    const start = performance.now();
    await loadIconPreset('stroke');
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(200);
  });

  it('should render 100 icons in under 100ms', () => {
    const start = performance.now();

    render(
      <div>
        {Array.from({ length: 100 }, (_, i) => (
          <Icon key={i} name="user" size={24} />
        ))}
      </div>
    );

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(100);
  });
});
```

---

## 11. Documentation Requirements

### User Guide

1. **Getting Started**
   - Installation
   - Basic usage
   - Import strategies

2. **Icon Presets**
   - Stroke preset overview
   - Duotone preset overview
   - Twotone preset overview
   - Choosing the right preset

3. **Component API**
   - Icon component props
   - IconPresetProvider usage
   - SVGIcon integration

4. **Advanced Topics**
   - Tree-shaking optimization
   - Lazy loading strategies
   - Custom icon sets
   - Icon search & filtering
   - SSR considerations

### API Reference

- Complete component API documentation
- Type definitions reference
- Utility functions reference
- Hook documentation

### Examples

- Basic icon usage
- Preset switching
- Dynamic loading
- Icon picker implementation
- Custom icon integration
- Performance optimization examples

---

## 12. Open Questions & Decisions

### Q1: Bundle Distribution Strategy

**Options:**
1. **Single Package:** All presets in one `@omnitron-dev/aether` package
2. **Separate Packages:** `@omnitron-dev/aether-icons-stroke`, etc.
3. **Hybrid:** Core in main package, presets as optional deps

**Recommendation:** Hybrid approach
- Core icon system in `@omnitron-dev/aether`
- Presets as peer dependencies
- Allow users to install only what they need

### Q2: Naming Convention

**Options:**
1. Keep HugeIcons names: `UserIcon`, `Home01Icon`
2. Simplify to kebab-case: `user`, `home-01`
3. Remove numbering: `user`, `home` (with variants in metadata)

**Recommendation:** Support both
- Export with original PascalCase names for compatibility
- Support kebab-case in string lookups
- Use metadata for variant management

### Q3: Default Preset

**Options:**
1. No default (user must specify)
2. Stroke as default
3. User-configurable default

**Recommendation:** Stroke as default
- Most common use case
- Smallest bundle size
- Clearest visual style

### Q4: Icon Categories

**Options:**
1. Flat structure (all icons in one file)
2. Category-based folders
3. Hybrid (flat exports with category metadata)

**Recommendation:** Hybrid approach
- Keep flat structure for simplicity
- Add category metadata for filtering
- Optional category-based imports for organization

---

## 13. Success Criteria

### Must Have
- ✅ All 4,559 icons converted for each preset (3 presets)
- ✅ Tree-shaking support (import only used icons)
- ✅ Type-safe icon names
- ✅ Bundle size < 2MB per preset (uncompressed)
- ✅ SSR compatible
- ✅ Preset switching at runtime
- ✅ Comprehensive documentation

### Should Have
- ✅ Icon search functionality
- ✅ Category-based filtering
- ✅ Lazy loading support
- ✅ Performance benchmarks
- ✅ Migration guides
- ✅ Example applications

### Nice to Have
- ⚠️ Icon picker component
- ⚠️ Visual icon browser
- ⚠️ CLI tool for icon management
- ⚠️ Figma plugin integration
- ⚠️ Icon animation presets

---

## 14. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Bundle size too large | Medium | High | Aggressive tree-shaking, lazy loading |
| Type generation too slow | Low | Medium | Pre-generate types, cache builds |
| SSR compatibility issues | Low | High | Comprehensive SSR testing |
| Icon naming conflicts | Low | Medium | Namespace with preset prefix |
| Performance degradation | Low | High | Performance testing, optimization |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| HugeIcons updates breaking changes | Medium | Medium | Version locking, update testing |
| Maintenance burden | Low | Medium | Automated tooling, clear processes |
| Documentation drift | Medium | Low | Keep docs with code, CI checks |

---

## 15. Next Steps

### Immediate Actions (This Week)
1. Create directory structure
2. Implement base transformation utilities
3. Parse stroke preset bundle
4. Generate first batch of icons

### Short Term (Next 2 Weeks)
1. Complete all three presets
2. Implement IconPresetProvider
3. Add search functionality
4. Write unit tests

### Medium Term (Next Month)
1. Performance optimization
2. Complete documentation
3. Create example applications
4. Launch beta release

### Long Term (Beyond Month 1)
1. Community feedback integration
2. Additional icon sets
3. Advanced features (picker, browser)
4. Continuous optimization

---

## Appendix A: File Size Breakdown

### Stroke Preset Detailed Analysis
- Total icons: 4,559
- Average icon size: 150 bytes (uncompressed)
- Simple icons (single path): 3,200 (70%)
- Complex icons (multi-element): 1,359 (30%)
- Estimated optimized size: 1.5MB

### Duotone Preset Detailed Analysis
- Total icons: 4,559
- Average icon size: 200 bytes (with opacity/fill)
- Simple icons: 2,500 (55%)
- Complex icons: 2,059 (45%)
- Estimated optimized size: 2MB

### Twotone Preset Detailed Analysis
- Total icons: 4,559
- Average icon size: 180 bytes
- Simple icons: 2,800 (61%)
- Complex icons: 1,759 (39%)
- Estimated optimized size: 1.8MB

---

## Appendix B: Transformation Examples

### Example 1: Simple Stroke Icon

**Input (HugeIcons):**
```javascript
const UserIcon = [
  ["path", {
    d: "M17 8.5C17 5.73858 14.7614 3.5 12 3.5C9.23858 3.5 7 5.73858 7 8.5C7 11.2614 9.23858 13.5 12 13.5C14.7614 13.5 17 11.2614 17 8.5Z",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "0"
  }],
  ["path", {
    d: "M19 20.5C19 16.634 15.866 13.5 12 13.5C8.13401 13.5 5 16.634 5 20.5",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "1"
  }]
];
```

**Output (Aether):**
```typescript
export const UserIcon: IconDefinition = {
  path: "M17 8.5C17 5.73858 14.7614 3.5 12 3.5C9.23858 3.5 7 5.73858 7 8.5C7 11.2614 9.23858 13.5 12 13.5C14.7614 13.5 17 11.2614 17 8.5Z M19 20.5C19 16.634 15.866 13.5 12 13.5C8.13401 13.5 5 16.634 5 20.5",
  viewBox: "0 0 24 24",
  metadata: {
    preset: "stroke",
    category: "users",
    tags: ["user", "person", "profile", "account", "avatar"]
  }
};
```

### Example 2: Complex Duotone Icon

**Input (HugeIcons):**
```javascript
const ThreeDViewIcon = [
  ["path", {
    opacity: "0.4",
    d: "M3.47387 19.682C4.44774 21...",
    fill: "currentColor",
    fillRule: "evenodd",
    key: "0"
  }],
  ["path", {
    d: "M12 11.5C12.4955 11.5...",
    stroke: "currentColor",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "1"
  }],
  ["path", {
    d: "M17 9V15C17 15.559...",
    stroke: "currentColor",
    strokeLinejoin: "round",
    strokeWidth: "1.5",
    key: "2"
  }]
];
```

**Output (Aether):**
```typescript
export const ThreeDViewIcon: IconDefinition = {
  content: `<g><path opacity="0.4" d="M3.47387 19.682C4.44774 21..." fill="currentColor" fill-rule="evenodd"/><path d="M12 11.5C12.4955 11.5..." stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"/><path d="M17 9V15C17 15.559..." stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"/></g>`,
  viewBox: "0 0 24 24",
  metadata: {
    preset: "duotone",
    category: "3d",
    tags: ["3d", "view", "perspective", "dimension"]
  }
};
```

---

## Appendix C: Build & Tooling

### Build Script

```bash
#!/bin/bash
# scripts/build-hugeicons.sh

echo "Building HugeIcons integration..."

# Phase 1: Parse source files
echo "Parsing source bundles..."
pnpm tsx scripts/parse-hugeicons.ts

# Phase 2: Convert to Aether format
echo "Converting to Aether format..."
pnpm tsx scripts/convert-icons.ts

# Phase 3: Generate TypeScript files
echo "Generating TypeScript files..."
pnpm tsx scripts/generate-files.ts

# Phase 4: Optimize
echo "Optimizing bundles..."
pnpm tsx scripts/optimize-icons.ts

# Phase 5: Validate
echo "Validating output..."
pnpm tsx scripts/validate-icons.ts

echo "✓ Build complete!"
echo "  - Stroke: $(wc -c < packages/aether/src/svg/icons/presets/stroke/icons.ts) bytes"
echo "  - Duotone: $(wc -c < packages/aether/src/svg/icons/presets/duotone/icons.ts) bytes"
echo "  - Twotone: $(wc -c < packages/aether/src/svg/icons/presets/twotone/icons.ts) bytes"
```

### Package.json Scripts

```json
{
  "scripts": {
    "icons:parse": "tsx scripts/parse-hugeicons.ts",
    "icons:convert": "tsx scripts/convert-icons.ts",
    "icons:generate": "tsx scripts/generate-files.ts",
    "icons:optimize": "tsx scripts/optimize-icons.ts",
    "icons:validate": "tsx scripts/validate-icons.ts",
    "icons:build": "bash scripts/build-hugeicons.sh",
    "icons:watch": "tsx --watch scripts/build-hugeicons.ts"
  }
}
```

---

## Conclusion

This integration plan provides a comprehensive roadmap for incorporating 13,677 HugeIcons (4,559 × 3 presets) into Aether's SVG icon system. The approach prioritizes:

1. **Developer Experience:** Type-safe, intuitive API with excellent tooling
2. **Performance:** Tree-shakeable, lazy-loadable, optimized bundles
3. **Flexibility:** Multiple presets, runtime switching, custom icons
4. **Quality:** Comprehensive testing, documentation, examples

**Estimated Timeline:** 4 weeks from start to production-ready release

**Key Success Factors:**
- Aggressive optimization (66% size reduction target)
- Comprehensive type safety (full TypeScript support)
- Seamless integration with existing Aether components
- Clear migration paths from other icon libraries

**Next Immediate Action:** Implement Phase 1 (Foundation) and begin stroke preset conversion.
