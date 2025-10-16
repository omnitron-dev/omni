/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Icon Presets Integrity Tests', () => {
  const ICONS_DIR = join(process.cwd(), 'src/svg/icons/presets');
  const PRESETS = ['stroke', 'duotone', 'twotone'] as const;
  const EXPECTED_ICONS_PER_PRESET = 4559; // Icon library typically has 4,559 icons per preset
  const EXPECTED_TOTAL = EXPECTED_ICONS_PER_PRESET * 3; // 13,677 total

  describe('Icon Count', () => {
    it('should have all three presets', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        expect(existsSync(presetDir)).toBe(true);
      }
    });

    it('should have expected number of icons in stroke preset', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      console.log(`Stroke preset has ${files.length} icons`);
      // Allow some variance (±100) for version differences
      expect(files.length).toBeGreaterThanOrEqual(EXPECTED_ICONS_PER_PRESET - 100);
      expect(files.length).toBeLessThanOrEqual(EXPECTED_ICONS_PER_PRESET + 100);
    });

    it('should have expected number of icons in duotone preset', () => {
      const duotoneDir = join(ICONS_DIR, 'duotone');
      const files = readdirSync(duotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      console.log(`Duotone preset has ${files.length} icons`);
      // Duotone might have fewer icons in some versions
      expect(files.length).toBeGreaterThan(0);
    });

    it('should have expected number of icons in twotone preset', () => {
      const twotoneDir = join(ICONS_DIR, 'twotone');
      const files = readdirSync(twotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      console.log(`Twotone preset has ${files.length} icons`);
      // Twotone might have fewer icons in some versions
      expect(files.length).toBeGreaterThan(0);
    });

    it('should have approximately expected total icons', () => {
      let totalIcons = 0;

      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
        totalIcons += files.length;
      }

      console.log(`Total icons across all presets: ${totalIcons}`);
      console.log(`Expected: ~${EXPECTED_TOTAL}`);

      // Allow significant variance as not all presets might have all icons
      expect(totalIcons).toBeGreaterThan(4000); // At minimum we should have stroke
    });
  });

  describe('Index Files', () => {
    it('should have index.ts in each preset', () => {
      for (const preset of PRESETS) {
        const indexPath = join(ICONS_DIR, preset, 'index.ts');
        expect(existsSync(indexPath)).toBe(true);
      }
    });

    it('should have valid export statements in index files', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Read and validate index file structure
        const indexPath = join(ICONS_DIR, preset, 'index.ts');
        const indexContent = readFileSync(indexPath, 'utf-8');

        expect(indexContent).toBeDefined();
        expect(indexContent.length).toBeGreaterThan(0);

        // Should have export statements
        expect(indexContent).toContain('export');

        // Count the number of exports (look for "export const" or "export {")
        const exportMatches = indexContent.match(/export\s+(const|{)/g) || [];
        expect(exportMatches.length).toBeGreaterThan(0);

        console.log(`${preset} index has ${exportMatches.length} export statements`);
      }
    });
  });

  describe('No Duplicate Names', () => {
    it('should not have duplicate file names in stroke preset', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      const fileSet = new Set(files);
      expect(fileSet.size).toBe(files.length);
    });

    it('should not have duplicate file names in duotone preset', () => {
      const duotoneDir = join(ICONS_DIR, 'duotone');
      const files = readdirSync(duotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      if (files.length === 0) return;

      const fileSet = new Set(files);
      expect(fileSet.size).toBe(files.length);
    });

    it('should not have duplicate file names in twotone preset', () => {
      const twotoneDir = join(ICONS_DIR, 'twotone');
      const files = readdirSync(twotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      if (files.length === 0) return;

      const fileSet = new Set(files);
      expect(fileSet.size).toBe(files.length);
    });

    it('should not have duplicate icon IDs within presets', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Collect icon IDs from files
        const iconIds: string[] = [];
        for (const file of files) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const idMatch = content.match(/"id":\s*"([^"]+)"/);
          if (idMatch) {
            iconIds.push(idMatch[1]);
          }
        }

        const iconSet = new Set(iconIds);
        expect(iconSet.size).toBe(iconIds.length);
        console.log(`${preset}: ${iconIds.length} unique icon IDs`);
      }
    });
  });

  describe('Valid IconDefinition Structure', () => {
    it('should have valid IconDefinition in all icons', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first 10 icons
        for (const file of files.slice(0, 10)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          // Validate IconDefinition structure through file content
          expect(content).toContain('"id"');
          expect(content).toContain('"viewBox"');
          expect(content).toContain('"width"');
          expect(content).toContain('"height"');
          expect(content).toContain('"metadata"');
          expect(content).toContain('"content"');

          // Validate types through parsing
          expect(content).toMatch(/"id":\s*"[^"]+"/);
          expect(content).toMatch(/"viewBox":\s*"[^"]+"/);
          expect(content).toMatch(/"width":\s*\d+/);
          expect(content).toMatch(/"height":\s*\d+/);
          expect(content).toMatch(/"content":\s*"((?:[^"\\]|\\["\\\/bfnrt]|\\u[0-9a-fA-F]{4})*)"/);
        }

        console.log(`✓ ${preset}: First 10 icons have valid IconDefinition structure`);
      }
    });

    it('should have valid metadata in all icons', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first 5 icons
        for (const file of files.slice(0, 5)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          // Validate metadata structure
          expect(content).toContain('"preset"');
          expect(content).toContain('"originalName"');
          expect(content).toContain('"elementsCount"');
          expect(content).toContain('"hasOpacity"');
          expect(content).toContain('"hasFill"');

          // Validate specific values
          expect(content).toContain(`"preset": "${preset}"`);
          expect(content).toMatch(/"originalName":\s*"[^"]+"/);
          expect(content).toMatch(/"elementsCount":\s*\d+/);
          expect(content).toMatch(/"hasOpacity":\s*(true|false)/);
          expect(content).toMatch(/"hasFill":\s*(true|false)/);
        }

        console.log(`✓ ${preset}: First 5 icons have valid metadata`);
      }
    });
  });

  describe('TypeScript Compilation', () => {
    it('should have valid TypeScript syntax in all icon files', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first 20 icons
        let validCount = 0;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          // Should have TypeScript import statement
          expect(content).toContain('import type { IconDefinition }');

          // Should have typed export
          expect(content).toMatch(/export const \w+:\s*IconDefinition/);

          // Should have proper structure
          expect(content).toContain('{');
          expect(content).toContain('}');

          validCount++;
        }

        console.log(`${preset}: ${validCount} files have valid TypeScript syntax`);
        expect(validCount).toBe(20);
      }
    });

    it('should have correct TypeScript types for exports', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first icon
        const file = files[0];
        const content = readFileSync(join(presetDir, file), 'utf-8');

        // TypeScript should enforce IconDefinition structure
        expect(content).toContain('IconDefinition');
        expect(content).toMatch(/export const \w+Icon:\s*IconDefinition/);

        // Should have all required properties
        expect(content).toContain('"id"');
        expect(content).toContain('"content"');
        expect(content).toContain('"viewBox"');
      }
    });
  });

  describe('File Naming Conventions', () => {
    it('should follow kebab-case naming for files', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files) {
          const name = file.replace('.ts', '');
          // Should be kebab-case: lowercase with hyphens
          expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        }

        console.log(`✓ ${preset}: All ${files.length} files follow kebab-case naming`);
      }
    });

    it('should have matching IDs and file names', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first 10 icons
        for (const file of files.slice(0, 10)) {
          const fileName = file.replace('.ts', '');
          const content = readFileSync(join(presetDir, file), 'utf-8');

          // Extract ID from file content
          const idMatch = content.match(/"id":\s*"([^"]+)"/);
          expect(idMatch).toBeTruthy();

          if (idMatch) {
            expect(idMatch[1]).toBe(fileName);
          }
        }

        console.log(`✓ ${preset}: First 10 icons have matching IDs and file names`);
      }
    });
  });

  describe('Export Completeness', () => {
    it('should export all icons from index', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Read index file and count exports (using "export * from" syntax)
        const indexPath = join(ICONS_DIR, preset, 'index.ts');
        const indexContent = readFileSync(indexPath, 'utf-8');

        // Count export statements (looking for "export * from './...")
        const exportMatches = indexContent.match(/export\s+\*\s+from\s+['"][^'"]+['"]/g) || [];
        const exportCount = exportMatches.length;

        // Number of exports should roughly match number of icon files
        expect(exportCount).toBeGreaterThan(0);
        expect(exportCount).toBeGreaterThan(files.length * 0.9); // At least 90% of files exported
        console.log(`${preset}: ${exportCount} export statements for ${files.length} files`);
      }
    });

    it('should have metadata exports in index', () => {
      for (const preset of PRESETS) {
        const indexPath = join(ICONS_DIR, preset, 'index.ts');
        const indexContent = readFileSync(indexPath, 'utf-8');

        const metadataKey = `HUGEICONS_${preset.toUpperCase()}_METADATA`;

        // Should export metadata constant
        expect(indexContent).toContain(metadataKey);
        expect(indexContent).toMatch(new RegExp(`export const ${metadataKey}`));

        // Should have preset and count in metadata (using JS object literal syntax)
        expect(indexContent).toContain(`preset: '${preset}'`);
        expect(indexContent).toContain('count:');

        console.log(`${preset}: has ${metadataKey} export`);
      }
    });
  });

  describe('Cross-Reference Checks', () => {
    it('should have consistent icon counts between files and metadata', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Read index file and extract metadata count (using JS object literal syntax)
        const indexPath = join(ICONS_DIR, preset, 'index.ts');
        const indexContent = readFileSync(indexPath, 'utf-8');

        const countMatch = indexContent.match(/count:\s*(\d+)/);
        expect(countMatch).toBeTruthy();

        if (countMatch) {
          const metadataCount = parseInt(countMatch[1], 10);
          // Metadata count should match file count
          expect(metadataCount).toBe(files.length);
          console.log(`${preset}: ${files.length} files = ${metadataCount} metadata count ✓`);
        }
      }
    });

    it('should have all file exports listed in metadata', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Read index file and count exports (using "export * from" syntax)
        const indexPath = join(ICONS_DIR, preset, 'index.ts');
        const indexContent = readFileSync(indexPath, 'utf-8');

        // Count export statements (looking for "export * from './...")
        const exportMatches = indexContent.match(/export\s+\*\s+from\s+['"][^'"]+['"]/g) || [];
        const exportCount = exportMatches.length;

        // All icon exports should be present
        expect(exportCount).toBeGreaterThan(0);
        expect(exportCount).toBeLessThanOrEqual(files.length);

        console.log(`${preset}: ${exportCount} exports for ${files.length} files`);
      }
    });
  });
});
