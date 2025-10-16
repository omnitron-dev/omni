#!/usr/bin/env tsx
/**
 * HugeIcons to Aether Transformation Script (Complete Rewrite)
 *
 * Converts ALL HugeIcons from experiments/hugeicons to Aether format with:
 * - Individual TypeScript files per icon
 * - Preset-specific optimizations (stroke, duotone, twotone)
 * - Duplicate path detection and merging (duotone)
 * - Default attribute removal
 * - Full SVG content generation
 * - Comprehensive statistics and reporting
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ===== Types =====

interface HugeIconElement {
  tag: string;
  attrs: Record<string, string>;
}

interface IconDefinition {
  id: string;
  content: string;
  viewBox: string;
  width: number;
  height: number;
  metadata: {
    preset: string;
    originalName: string;
    elementsCount: number;
    hasOpacity: boolean;
    hasFill: boolean;
    hasFillRule?: boolean;
  };
}

interface PresetConfig {
  name: 'stroke' | 'duotone' | 'twotone';
  inputPath: string;
  outputPath: string;
}

interface TransformStats {
  preset: string;
  totalIcons: number;
  processedIcons: number;
  skippedIcons: number;
  errors: Array<{ icon: string; error: string }>;
  originalSize: number;
  optimizedSize: number;
  duration: number;
  pathsMerged: number; // For duotone
}

interface AllStats {
  presets: TransformStats[];
  totalIcons: number;
  totalDuration: number;
  totalOriginalSize: number;
  totalOptimizedSize: number;
}

// ===== Configuration =====

const DEFAULT_VIEW_BOX = '0 0 24 24';
const DEFAULT_WIDTH = 24;
const DEFAULT_HEIGHT = 24;

const PRESETS: PresetConfig[] = [
  {
    name: 'stroke',
    inputPath: '/Users/taaliman/projects/luxquant/omnitron-dev/omni/experiments/hugeicons/core-stroke-rounded/dist/esm/index.js',
    outputPath: '/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/aether/src/svg/icons/presets/hugeicons/stroke',
  },
  {
    name: 'duotone',
    inputPath: '/Users/taaliman/projects/luxquant/omnitron-dev/omni/experiments/hugeicons/core-duotone-rounded/dist/esm/index.js',
    outputPath: '/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/aether/src/svg/icons/presets/hugeicons/duotone',
  },
  {
    name: 'twotone',
    inputPath: '/Users/taaliman/projects/luxquant/omnitron-dev/omni/experiments/hugeicons/core-twotone-rounded/dist/esm/index.js',
    outputPath: '/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/aether/src/svg/icons/presets/hugeicons/twotone',
  },
];

// ===== Utilities =====

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function pascalToKebab(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z])([a-z])/g, '$1-$2$3')
    .toLowerCase();
}

function normalizeIconName(name: string): string {
  // Remove "Icon" suffix and convert to kebab-case
  const withoutIcon = name.replace(/Icon$/, '');
  return pascalToKebab(withoutIcon);
}

function estimateGzipSize(content: string): number {
  // Rough estimate: ~30% of original size when gzipped
  return Math.round(Buffer.from(content, 'utf-8').length * 0.3);
}

// ===== Parser =====

/**
 * Parse HugeIcons JavaScript file and extract icon definitions
 */
function parseHugeIconsFile(filePath: string): Map<string, HugeIconElement[]> {
  const content = readFileSync(filePath, 'utf-8');
  const icons = new Map<string, HugeIconElement[]>();

  // Match: const IconName = /*#__PURE__*/ [...];
  const iconRegex = /const\s+(\w+Icon)\s*=\s*\/\*#__PURE__\*\/\s*\[([\s\S]*?)\];/g;

  let match;
  let iconCount = 0;

  while ((match = iconRegex.exec(content)) !== null) {
    const [, iconName, arrayContent] = match;

    try {
      const elements = parseIconArray(arrayContent);
      icons.set(iconName, elements);
      iconCount++;

      if (iconCount % 500 === 0) {
        process.stdout.write(`\r   Parsed ${iconCount} icons...`);
      }
    } catch (error) {
      console.warn(`\n⚠️  Failed to parse icon "${iconName}":`, error instanceof Error ? error.message : error);
    }
  }

  if (iconCount > 0) {
    process.stdout.write(`\r   Parsed ${iconCount} icons    \n`);
  }

  return icons;
}

/**
 * Parse icon array: [["tag", {...}], ...]
 * Manual parsing with proper bracket matching
 */
function parseIconArray(arrayStr: string): HugeIconElement[] {
  const elements: HugeIconElement[] = [];

  // The arrayStr is the content BETWEEN the outer brackets from the regex match
  // e.g., '  ["path", {...}],\n  ["circle", {...}]  '
  // So we DON'T need to remove brackets - they're not there!
  let str = arrayStr.trim();

  if (!str) return elements;

  let pos = 0;
  while (pos < str.length) {
    // Skip whitespace, newlines, and commas
    while (pos < str.length && /[\s,]/.test(str[pos])) {
      pos++;
    }

    if (pos >= str.length) break;

    // Each element should start with '['
    if (str[pos] !== '[') {
      pos++;
      continue;
    }

    // Find the closing ']' for this element, respecting nested braces/brackets and strings
    const start = pos;
    let depth = 0;
    let inString = false;
    let stringChar = '';

    while (pos < str.length) {
      const char = str[pos];
      const prevChar = pos > 0 ? str[pos - 1] : '';

      // Handle string boundaries
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }

      if (!inString) {
        if (char === '[' || char === '{') depth++;
        if (char === ']' || char === '}') depth--;

        // Found the closing bracket for this element
        if (depth === 0 && char === ']') {
          const elementStr = str.substring(start, pos + 1);
          const element = parseElement(elementStr);
          if (element) {
            elements.push(element);
          }
          pos++;  // Move past the ']'
          break;
        }
      }

      pos++;
    }

    // Safety: if we didn't find a closing bracket, move on
    if (depth !== 0) {
      break;
    }
  }

  return elements;
}

/**
 * Parse single element: ["tag", {attrs}]
 */
function parseElement(elementStr: string): HugeIconElement | null {
  elementStr = elementStr.trim();

  // Must start with [ and end with ]
  if (!elementStr.startsWith('[') || !elementStr.endsWith(']')) {
    return null;
  }

  // Remove outer brackets
  const inner = elementStr.slice(1, -1).trim();

  // Find the tag name (first string)
  const tagMatch = inner.match(/^["'](\w+)["']\s*,/);
  if (!tagMatch) {
    return null;
  }

  const tag = tagMatch[1];
  const afterTag = inner.slice(tagMatch[0].length).trim();

  // The rest should be the attributes object
  if (!afterTag.startsWith('{') || !afterTag.endsWith('}')) {
    return null;
  }

  try {
    // Parse attributes using Function (safer than eval)
    const attrs = new Function(`return ${afterTag}`)() as Record<string, string>;
    return { tag, attrs };
  } catch (error) {
    // Silently fail - some icons may have unusual formatting
    return null;
  }
}

// ===== Transformation =====

/**
 * Transform HugeIcons to Aether format with preset-specific optimizations
 */
function transformToAether(
  iconName: string,
  elements: HugeIconElement[],
  preset: 'stroke' | 'duotone' | 'twotone'
): { definition: IconDefinition; pathsMerged: number } {
  const normalizedName = normalizeIconName(iconName);
  let pathsMerged = 0;

  // Apply preset-specific transformations
  let optimizedElements = elements;
  if (preset === 'duotone') {
    const result = mergeDuplicatePaths(elements);
    optimizedElements = result.elements;
    pathsMerged = result.merged;
  }

  // Build SVG content
  const svgElements = optimizedElements
    .map((el) => buildSvgElement(el, preset))
    .join('\n    ');

  const content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${DEFAULT_VIEW_BOX}" fill="none">\n    ${svgElements}\n  </svg>`;

  // Collect metadata
  const hasOpacity = elements.some((el) => el.attrs.opacity);
  const hasFill = elements.some((el) => el.attrs.fill);
  const hasFillRule = elements.some((el) => el.attrs.fillRule);

  const definition: IconDefinition = {
    id: normalizedName,
    content,
    viewBox: DEFAULT_VIEW_BOX,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    metadata: {
      preset,
      originalName: iconName,
      elementsCount: elements.length,
      hasOpacity,
      hasFill,
      ...(hasFillRule && { hasFillRule }),
    },
  };

  return { definition, pathsMerged };
}

/**
 * Merge duplicate paths in duotone preset
 * Duotone often has same path twice: once with fill, once with stroke
 */
function mergeDuplicatePaths(elements: HugeIconElement[]): { elements: HugeIconElement[]; merged: number } {
  const pathMap = new Map<string, HugeIconElement[]>();
  const circleMap = new Map<string, HugeIconElement[]>();
  const otherElements: HugeIconElement[] = [];

  // Group elements by their path data or circle coordinates
  for (const el of elements) {
    if (el.tag === 'path' && el.attrs.d) {
      const key = el.attrs.d;
      if (!pathMap.has(key)) {
        pathMap.set(key, []);
      }
      pathMap.get(key)!.push(el);
    } else if (el.tag === 'circle' && el.attrs.cx && el.attrs.cy && el.attrs.r) {
      const key = `${el.attrs.cx},${el.attrs.cy},${el.attrs.r}`;
      if (!circleMap.has(key)) {
        circleMap.set(key, []);
      }
      circleMap.get(key)!.push(el);
    } else {
      otherElements.push(el);
    }
  }

  const mergedElements: HugeIconElement[] = [];
  let mergedCount = 0;

  // Merge paths with same 'd' attribute
  for (const [d, group] of pathMap) {
    if (group.length > 1) {
      // Merge attributes from all elements
      const merged: HugeIconElement = {
        tag: 'path',
        attrs: { d },
      };

      for (const el of group) {
        Object.assign(merged.attrs, el.attrs);
        delete merged.attrs.key; // Remove React key
      }

      mergedElements.push(merged);
      mergedCount += group.length - 1;
    } else {
      mergedElements.push(group[0]);
    }
  }

  // Merge circles with same position/size
  for (const [key, group] of circleMap) {
    if (group.length > 1) {
      const merged: HugeIconElement = {
        tag: 'circle',
        attrs: { ...group[0].attrs },
      };

      for (const el of group) {
        Object.assign(merged.attrs, el.attrs);
        delete merged.attrs.key;
      }

      mergedElements.push(merged);
      mergedCount += group.length - 1;
    } else {
      mergedElements.push(group[0]);
    }
  }

  // Add other elements
  mergedElements.push(...otherElements);

  return { elements: mergedElements, merged: mergedCount };
}

/**
 * Build SVG element string with optimization
 */
function buildSvgElement(element: HugeIconElement, preset: string): string {
  const { tag, attrs } = element;
  const optimized = optimizeAttributes(attrs, preset);

  // Build attribute string
  const attrStr = Object.entries(optimized)
    .map(([key, value]) => {
      const kebabKey = camelToKebab(key);
      return `${kebabKey}="${value}"`;
    })
    .join(' ');

  // Self-closing for common SVG elements
  const selfClosing = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'];

  if (selfClosing.includes(tag)) {
    return attrStr ? `<${tag} ${attrStr} />` : `<${tag} />`;
  }

  return attrStr ? `<${tag} ${attrStr}></${tag}>` : `<${tag}></${tag}>`;
}

/**
 * Optimize attributes by removing defaults
 */
function optimizeAttributes(attrs: Record<string, string>, preset: string): Record<string, string> {
  const optimized: Record<string, string> = {};

  for (const [key, value] of Object.entries(attrs)) {
    // Always remove React key
    if (key === 'key') continue;

    // Remove default stroke for all presets
    if (key === 'stroke' && value === 'currentColor') continue;

    // Remove default strokeWidth
    if (key === 'strokeWidth' && value === '1.5') continue;

    // Keep all other attributes
    optimized[key] = value;
  }

  return optimized;
}

// ===== File Generation =====

/**
 * Generate individual icon file
 */
function generateIconFile(iconName: string, definition: IconDefinition, outputDir: string): void {
  const fileName = `${definition.id}.ts`;
  const filePath = join(outputDir, fileName);

  const fileContent = `/**
 * ${definition.metadata.originalName}
 * Preset: ${definition.metadata.preset}
 * Auto-generated from HugeIcons
 */

import type { IconDefinition } from '../../../IconRegistry.js';

export const ${iconName}: IconDefinition = ${JSON.stringify(definition, null, 2)};
`;

  writeFileSync(filePath, fileContent, 'utf-8');
}

/**
 * Generate index file with exports
 */
function generateIndexFile(icons: Map<string, IconDefinition>, outputDir: string, preset: string): void {
  const indexPath = join(outputDir, 'index.ts');

  const exports = Array.from(icons.entries())
    .map(([name, def]) => `export * from './${def.id}.js';`)
    .join('\n');

  const iconList = Array.from(icons.keys()).map(name => `  '${name}'`).join(',\n');

  const content = `/**
 * HugeIcons ${preset} preset
 * Total icons: ${icons.size}
 * Auto-generated from HugeIcons
 */

${exports}

/**
 * All icon names in this preset
 */
export const HUGEICONS_${preset.toUpperCase()}_ICONS = [
${iconList}
] as const;

/**
 * Icon metadata
 */
export const HUGEICONS_${preset.toUpperCase()}_METADATA = {
  preset: '${preset}',
  count: ${icons.size},
  license: 'CC BY 4.0',
  source: 'https://hugeicons.com'
} as const;
`;

  writeFileSync(indexPath, content, 'utf-8');
}

// ===== Main Transform Function =====

/**
 * Transform a single preset
 */
function transformPreset(config: PresetConfig): TransformStats {
  const startTime = Date.now();
  const stats: TransformStats = {
    preset: config.name,
    totalIcons: 0,
    processedIcons: 0,
    skippedIcons: 0,
    errors: [],
    originalSize: 0,
    optimizedSize: 0,
    duration: 0,
    pathsMerged: 0,
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎨 Processing ${config.name.toUpperCase()} preset`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Input:  ${config.inputPath}`);
  console.log(`   Output: ${config.outputPath}`);
  console.log();

  // Create output directory
  mkdirSync(config.outputPath, { recursive: true });

  // Parse icons
  console.log('📖 Parsing HugeIcons file...');
  const rawIcons = parseHugeIconsFile(config.inputPath);
  stats.totalIcons = rawIcons.size;
  console.log(`   Found ${stats.totalIcons} icons\n`);

  // Transform icons
  console.log('🔄 Transforming icons...');
  const transformedIcons = new Map<string, IconDefinition>();
  let processed = 0;

  for (const [iconName, elements] of rawIcons) {
    try {
      const { definition, pathsMerged } = transformToAether(iconName, elements, config.name);

      // Calculate sizes
      const originalSize = JSON.stringify(elements).length;
      const optimizedSize = definition.content.length;

      stats.originalSize += originalSize;
      stats.optimizedSize += optimizedSize;
      stats.pathsMerged += pathsMerged;

      transformedIcons.set(iconName, definition);
      stats.processedIcons++;
      processed++;

      if (processed % 500 === 0) {
        process.stdout.write(`\r   Transformed ${processed}/${stats.totalIcons} icons...`);
      }
    } catch (error) {
      stats.skippedIcons++;
      stats.errors.push({
        icon: iconName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  process.stdout.write(`\r   Transformed ${stats.processedIcons} icons    \n\n`);

  // Generate files
  console.log('📝 Generating TypeScript files...');
  let fileCount = 0;

  for (const [iconName, definition] of transformedIcons) {
    generateIconFile(iconName, definition, config.outputPath);
    fileCount++;

    if (fileCount % 500 === 0) {
      process.stdout.write(`\r   Generated ${fileCount}/${stats.processedIcons} files...`);
    }
  }

  process.stdout.write(`\r   Generated ${fileCount} files    \n`);

  // Generate index
  console.log('📋 Generating index file...');
  generateIndexFile(transformedIcons, config.outputPath, config.name);
  console.log('   ✓ Index file created');

  stats.duration = Date.now() - startTime;

  return stats;
}

/**
 * Transform all presets
 */
function transformAll(): AllStats {
  const allStartTime = Date.now();
  const presetStats: TransformStats[] = [];

  console.log('\n' + '='.repeat(60));
  console.log('🚀 HugeIcons to Aether Transformation');
  console.log('='.repeat(60));
  console.log(`   Transforming ${PRESETS.length} presets (stroke, duotone, twotone)`);
  console.log(`   Expected: ~4,559 icons per preset = 13,677 total`);
  console.log('='.repeat(60));

  // Transform each preset
  for (const preset of PRESETS) {
    const stats = transformPreset(preset);
    presetStats.push(stats);
  }

  // Calculate totals
  const allStats: AllStats = {
    presets: presetStats,
    totalIcons: presetStats.reduce((sum, s) => sum + s.processedIcons, 0),
    totalDuration: Date.now() - allStartTime,
    totalOriginalSize: presetStats.reduce((sum, s) => sum + s.originalSize, 0),
    totalOptimizedSize: presetStats.reduce((sum, s) => sum + s.optimizedSize, 0),
  };

  return allStats;
}

// ===== Reporting =====

/**
 * Print comprehensive statistics
 */
function printReport(stats: AllStats): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 TRANSFORMATION COMPLETE');
  console.log('='.repeat(60));
  console.log();

  // Per-preset stats
  for (const preset of stats.presets) {
    console.log(`${preset.preset.toUpperCase()} Preset:`);
    console.log(`   Icons processed:     ${preset.processedIcons.toLocaleString()}`);
    console.log(`   Icons skipped:       ${preset.skippedIcons}`);
    console.log(`   Errors:              ${preset.errors.length}`);
    if (preset.preset === 'duotone') {
      console.log(`   Paths merged:        ${preset.pathsMerged.toLocaleString()}`);
    }
    console.log(`   Original size:       ${(preset.originalSize / 1024).toFixed(2)} KB`);
    console.log(`   Optimized size:      ${(preset.optimizedSize / 1024).toFixed(2)} KB`);
    const reduction = ((1 - preset.optimizedSize / preset.originalSize) * 100).toFixed(1);
    console.log(`   Size reduction:      ${reduction}%`);
    console.log(`   Duration:            ${(preset.duration / 1000).toFixed(2)}s`);
    console.log();
  }

  // Overall stats
  console.log('OVERALL:');
  console.log(`   Total icons:         ${stats.totalIcons.toLocaleString()}`);
  console.log(`   Total original:      ${(stats.totalOriginalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Total optimized:     ${(stats.totalOptimizedSize / 1024 / 1024).toFixed(2)} MB`);
  const totalReduction = ((1 - stats.totalOptimizedSize / stats.totalOriginalSize) * 100).toFixed(1);
  console.log(`   Total reduction:     ${totalReduction}%`);
  console.log(`   Total duration:      ${(stats.totalDuration / 1000).toFixed(2)}s`);
  console.log();

  // Errors
  const totalErrors = stats.presets.reduce((sum, p) => sum + p.errors.length, 0);
  if (totalErrors > 0) {
    console.log('⚠️  ERRORS:');
    for (const preset of stats.presets) {
      if (preset.errors.length > 0) {
        console.log(`   ${preset.preset}:`);
        preset.errors.slice(0, 5).forEach(({ icon, error }) => {
          console.log(`      - ${icon}: ${error}`);
        });
        if (preset.errors.length > 5) {
          console.log(`      ... and ${preset.errors.length - 5} more`);
        }
      }
    }
    console.log();
  }

  console.log('='.repeat(60));
  console.log('✅ All transformations complete!');
  console.log('='.repeat(60));
  console.log();

  // Save report
  saveReport(stats);
}

/**
 * Save detailed report to file
 */
function saveReport(stats: AllStats): void {
  const reportPath = join(__dirname, 'TRANSFORMATION-REPORT.md');

  const report = `# HugeIcons Transformation Report

Generated: ${new Date().toISOString()}

## Summary

- **Total icons processed:** ${stats.totalIcons.toLocaleString()}
- **Total presets:** ${stats.presets.length}
- **Total duration:** ${(stats.totalDuration / 1000).toFixed(2)}s
- **Size reduction:** ${((1 - stats.totalOptimizedSize / stats.totalOriginalSize) * 100).toFixed(1)}%

## Preset Statistics

${stats.presets.map(p => `### ${p.preset.toUpperCase()}

- **Icons processed:** ${p.processedIcons.toLocaleString()}
- **Icons skipped:** ${p.skippedIcons}
- **Errors:** ${p.errors.length}${p.preset === 'duotone' ? `\n- **Paths merged:** ${p.pathsMerged.toLocaleString()}` : ''}
- **Original size:** ${(p.originalSize / 1024).toFixed(2)} KB
- **Optimized size:** ${(p.optimizedSize / 1024).toFixed(2)} KB
- **Size reduction:** ${((1 - p.optimizedSize / p.originalSize) * 100).toFixed(1)}%
- **Duration:** ${(p.duration / 1000).toFixed(2)}s
`).join('\n')}

## File Locations

${stats.presets.map(p => `### ${p.preset}
- \`packages/aether/src/svg/icons/presets/hugeicons/${p.preset}/\`
- ${p.processedIcons.toLocaleString()} icon files
- 1 index file
`).join('\n')}

## Errors

${stats.presets.flatMap(p => p.errors).length === 0 ? 'No errors encountered.' : stats.presets.map(p => p.errors.length > 0 ? `### ${p.preset}\n${p.errors.map(e => `- **${e.icon}**: ${e.error}`).join('\n')}` : '').filter(Boolean).join('\n\n')}

---

*Auto-generated by transform-hugeicons.ts*
`;

  writeFileSync(reportPath, report, 'utf-8');
  console.log(`📄 Detailed report saved to: ${reportPath}\n`);
}

// ===== Entry Point =====

function main(): void {
  try {
    const stats = transformAll();
    printReport(stats);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Transformation failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { transformAll, transformPreset };
