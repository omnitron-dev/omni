# Aether Icon Presets

Complete icon library with **13,677 icons** across 3 presets:
- **Stroke**: 4,559 outline icons
- **Duotone**: 4,559 two-tone icons with fill and stroke
- **Twotone**: 4,559 icons with selective opacity

## Installation

Icon presets are included with Aether. No additional installation needed.

## Quick Start

### Loading an Entire Preset

```typescript
import { loadIconPreset } from '@omnitron-dev/aether/svg/icons/presets';
import { getIconRegistry } from '@omnitron-dev/aether';

// Load the stroke preset (all 4,559 icons)
const strokeIcons = await loadIconPreset('stroke');

// Register with the icon registry
const registry = getIconRegistry();
registry.registerSet('icons', strokeIcons);
```

### Loading Individual Icons

```typescript
import { loadIcon } from '@omnitron-dev/aether/svg/icons/presets';

// Load a specific icon
const userIcon = await loadIcon('stroke', 'user');
console.log(userIcon); // { id: 'user', content: '...', ... }
```

### Direct Imports (Tree-Shakeable)

```typescript
// Import specific icons from stroke preset
import { UserIcon, HomeIcon, SettingsIcon } from '@omnitron-dev/aether/svg/icons/presets/stroke';

// Use with SVGIcon component
<SVGIcon {...UserIcon} />
```

## API Reference

### `loadIconPreset(preset)`

Load an entire icon preset dynamically.

**Parameters:**
- `preset`: `'stroke' | 'duotone' | 'twotone'` - The preset to load

**Returns:** `Promise<IconSet>` - All icons in the preset

**Example:**
```typescript
const strokeIcons = await loadIconPreset('stroke');
const duotoneIcons = await loadIconPreset('duotone');
const twotoneIcons = await loadIconPreset('twotone');
```

### `loadIcon(preset, name)`

Load a specific icon from a preset.

**Parameters:**
- `preset`: `'stroke' | 'duotone' | 'twotone'` - The preset to load from
- `name`: `string` - Icon name in kebab-case (e.g., 'user', 'home-01')

**Returns:** `Promise<IconDefinition>` - The icon definition

**Example:**
```typescript
const icon = await loadIcon('stroke', 'user');
const homeIcon = await loadIcon('duotone', 'home-01');
```

### `preloadIcons(preset, names)`

Efficiently load multiple icons at once.

**Parameters:**
- `preset`: `'stroke' | 'duotone' | 'twotone'` - The preset to load from
- `names`: `string[]` - Array of icon names

**Returns:** `Promise<Map<string, IconDefinition>>` - Map of icon names to definitions

**Example:**
```typescript
const icons = await preloadIcons('stroke', ['user', 'home-01', 'settings']);
const userIcon = icons.get('user');
```

### `searchIcons(options)`

Search for icons across presets.

**Parameters:**
- `options.query`: `string` - Search query (required)
- `options.preset`: `'stroke' | 'duotone' | 'twotone' | 'all'` - Preset to search (default: 'stroke')
- `options.limit`: `number` - Maximum results (optional)
- `options.caseSensitive`: `boolean` - Case-sensitive search (default: false)

**Returns:** `Promise<IconSearchResult[]>` - Array of search results sorted by relevance

**Example:**
```typescript
// Search for user-related icons
const results = await searchIcons({
  query: 'user',
  preset: 'stroke',
  limit: 10
});

// Search across all presets
const allResults = await searchIcons({
  query: 'home',
  preset: 'all'
});
```

### `getMatchingIconNames(options)`

Get only the names of matching icons (more efficient than `searchIcons`).

**Parameters:** Same as `searchIcons`

**Returns:** `Promise<string[]>` - Array of icon names

**Example:**
```typescript
const names = await getMatchingIconNames({
  query: 'arrow',
  preset: 'stroke',
  limit: 50
});
console.log(names); // ['arrow-up', 'arrow-down', ...]
```

## Icon Presets

### Stroke Preset
- **Style**: Single-color outline icons
- **Use Case**: Clean, minimal interfaces
- **Bundle Size**: ~1.5MB uncompressed
- **Import Path**: `@omnitron-dev/aether/svg/icons/presets/stroke`

### Duotone Preset
- **Style**: Two-tone with fill and stroke
- **Use Case**: Rich, layered interfaces
- **Bundle Size**: ~2MB uncompressed
- **Import Path**: `@omnitron-dev/aether/svg/icons/presets/duotone`

### Twotone Preset
- **Style**: Selective opacity for depth
- **Use Case**: Subtle visual hierarchy
- **Bundle Size**: ~1.8MB uncompressed
- **Import Path**: `@omnitron-dev/aether/svg/icons/presets/twotone`

## Usage with IconProvider

```typescript
import { IconProvider } from '@omnitron-dev/aether';
import { loadIconPreset } from '@omnitron-dev/aether/svg/icons/presets';

const App = () => {
  return (
    <IconProvider
      sets={[
        {
          name: 'icons',
          icons: await loadIconPreset('stroke')
        }
      ]}
      defaults={{
        size: 24,
        color: 'currentColor'
      }}
    >
      <YourApp />
    </IconProvider>
  );
};
```

## Integration with IconRegistry

```typescript
import { getIconRegistry } from '@omnitron-dev/aether';
import { loadIconPreset, loadIcon } from '@omnitron-dev/aether/svg/icons/presets';

const registry = getIconRegistry();

// Option 1: Load entire preset
const strokeIcons = await loadIconPreset('stroke');
registry.registerSet('icons-stroke', strokeIcons);

// Option 2: Load icons on demand
const userIcon = await loadIcon('stroke', 'user');
registry.registerSet('custom', { user: userIcon });

// Use icons
const icon = await registry.get('user');
```

## Tree-Shaking

Import only the icons you need for optimal bundle size:

```typescript
// ✅ Good - Only includes UserIcon and HomeIcon
import { UserIcon, HomeIcon } from '@omnitron-dev/aether/svg/icons/presets/stroke';

// ❌ Avoid - Loads entire preset
import * as Icons from '@omnitron-dev/aether/svg/icons/presets/stroke';
```

## Metadata

Each preset exports metadata:

```typescript
import {
  HUGEICONS_STROKE_METADATA,
  HUGEICONS_DUOTONE_METADATA,
  HUGEICONS_TWOTONE_METADATA
} from '@omnitron-dev/aether/svg/icons/presets';

console.log(HUGEICONS_STROKE_METADATA);
// {
//   preset: 'stroke',
//   count: 4559,
//   license: 'CC BY 4.0',
//   source: 'https://hugeicons.com'
// }
```

## TypeScript Support

Full TypeScript support with type definitions:

```typescript
import type {
  IconPreset,
  IconPresetMetadata,
  IconSearchOptions,
  IconSearchResult
} from '@omnitron-dev/aether/svg/icons/presets';

// Type-safe preset parameter
const preset: IconPreset = 'stroke';

// Type-safe search options
const options: IconSearchOptions = {
  query: 'user',
  preset: 'stroke',
  limit: 10
};
```

## Performance Tips

1. **Lazy Loading**: Use `loadIconPreset()` for dynamic loading
2. **Tree-Shaking**: Import only needed icons directly
3. **Preloading**: Use `preloadIcons()` for multiple icons
4. **Search**: Use `getMatchingIconNames()` instead of `searchIcons()` if you only need names
5. **Caching**: The IconRegistry automatically caches loaded icons

## License

Icons are licensed under **CC BY 4.0** (HugeIcons).
Source: https://hugeicons.com

## Examples

### Basic Icon Usage

```typescript
import { loadIcon } from '@omnitron-dev/aether/svg/icons/presets';
import { SVGIcon } from '@omnitron-dev/aether';

const MyComponent = async () => {
  const userIcon = await loadIcon('stroke', 'user');

  return <SVGIcon {...userIcon} size={24} color="blue" />;
};
```

### Search and Display

```typescript
import { searchIcons } from '@omnitron-dev/aether/svg/icons/presets';
import { SVGIcon } from '@omnitron-dev/aether';

const IconBrowser = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const handleSearch = async () => {
    const icons = await searchIcons({
      query,
      preset: 'stroke',
      limit: 50
    });
    setResults(icons);
  };

  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <button onClick={handleSearch}>Search</button>
      <div>
        {results.map((result) => (
          <div key={result.name}>
            <SVGIcon {...result.definition} size={24} />
            <span>{result.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### Preset Switching

```typescript
import { loadIconPreset } from '@omnitron-dev/aether/svg/icons/presets';
import { getIconRegistry } from '@omnitron-dev/aether';

const PresetSwitcher = () => {
  const [preset, setPreset] = useState<'stroke' | 'duotone' | 'twotone'>('stroke');
  const registry = getIconRegistry();

  const switchPreset = async (newPreset) => {
    const icons = await loadIconPreset(newPreset);
    registry.registerSet('current', icons);
    setPreset(newPreset);
  };

  return (
    <select value={preset} onChange={(e) => switchPreset(e.target.value)}>
      <option value="stroke">Stroke</option>
      <option value="duotone">Duotone</option>
      <option value="twotone">Twotone</option>
    </select>
  );
};
```
