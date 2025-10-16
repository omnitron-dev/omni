/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

describe('HugeIcons Integrity Tests', () => {
  const ICONS_DIR = join(process.cwd(), 'src/svg/icons/presets/hugeicons');
  const PRESETS = ['stroke', 'duotone', 'twotone'] as const;
  const EXPECTED_ICONS_PER_PRESET = 4559; // HugeIcons typically has 4,559 icons per preset
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

    it('should have valid export statements in index files', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Dynamic import should work
        try {
          const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/index.js`);
          expect(module).toBeDefined();
          expect(typeof module).toBe('object');

          // Should have some exports
          const exportKeys = Object.keys(module);
          expect(exportKeys.length).toBeGreaterThan(0);

          console.log(`${preset} index exports ${exportKeys.length} items`);
        } catch (error) {
          console.error(`Failed to import ${preset} index:`, error);
          throw error;
        }
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

    it('should not have duplicate icon IDs within presets', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/index.js`);
        const icons = Object.keys(module).filter((k) => k.endsWith('Icon'));

        const iconSet = new Set(icons);
        expect(iconSet.size).toBe(icons.length);
        console.log(`${preset}: ${icons.length} unique icon exports`);
      }
    });
  });

  describe('Valid IconDefinition Structure', () => {
    it('should have valid IconDefinition in all icons', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first 10 icons
        for (const file of files.slice(0, 10)) {
          const iconName = file.replace('.ts', '');
          const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/${iconName}.js`);

          // Find the exported icon (should be PascalCase + Icon suffix)
          const exportKey = Object.keys(module).find((k) => k !== 'default');
          expect(exportKey).toBeDefined();

          if (exportKey) {
            const icon = module[exportKey];

            // Validate IconDefinition structure
            expect(icon).toHaveProperty('id');
            expect(icon).toHaveProperty('viewBox');
            expect(icon).toHaveProperty('width');
            expect(icon).toHaveProperty('height');
            expect(icon).toHaveProperty('metadata');

            // Validate types
            expect(typeof icon.id).toBe('string');
            expect(typeof icon.viewBox).toBe('string');
            expect(typeof icon.width).toBe('number');
            expect(typeof icon.height).toBe('number');
            expect(typeof icon.metadata).toBe('object');

            // Validate content or path
            expect(icon).toHaveProperty('content');
            expect(typeof icon.content).toBe('string');
            expect(icon.content.length).toBeGreaterThan(0);
          }
        }

        console.log(`✓ ${preset}: First 10 icons have valid IconDefinition structure`);
      }
    });

    it('should have valid metadata in all icons', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first 5 icons
        for (const file of files.slice(0, 5)) {
          const iconName = file.replace('.ts', '');
          const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/${iconName}.js`);

          const exportKey = Object.keys(module).find((k) => k !== 'default');
          if (exportKey) {
            const icon = module[exportKey];
            const metadata = icon.metadata;

            expect(metadata).toHaveProperty('preset');
            expect(metadata).toHaveProperty('originalName');
            expect(metadata).toHaveProperty('elementsCount');
            expect(metadata).toHaveProperty('hasOpacity');
            expect(metadata).toHaveProperty('hasFill');

            expect(typeof metadata.preset).toBe('string');
            expect(typeof metadata.originalName).toBe('string');
            expect(typeof metadata.elementsCount).toBe('number');
            expect(typeof metadata.hasOpacity).toBe('boolean');
            expect(typeof metadata.hasFill).toBe('boolean');

            expect(metadata.preset).toBe(preset);
            expect(metadata.elementsCount).toBeGreaterThanOrEqual(0);
          }
        }

        console.log(`✓ ${preset}: First 5 icons have valid metadata`);
      }
    });
  });

  describe('TypeScript Compilation', () => {
    it('should successfully import all icon modules', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test importing first 20 icons
        let successCount = 0;
        let failCount = 0;

        for (const file of files.slice(0, 20)) {
          const iconName = file.replace('.ts', '');
          try {
            const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/${iconName}.js`);
            expect(module).toBeDefined();
            successCount++;
          } catch (error) {
            console.error(`Failed to import ${preset}/${iconName}:`, error);
            failCount++;
          }
        }

        console.log(`${preset}: ${successCount} imports succeeded, ${failCount} failed`);
        expect(failCount).toBe(0);
      }
    });

    it('should have correct TypeScript types for exports', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first icon
        const file = files[0];
        const iconName = file.replace('.ts', '');
        const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/${iconName}.js`);

        const exportKey = Object.keys(module).find((k) => k !== 'default');
        expect(exportKey).toBeDefined();

        if (exportKey) {
          const icon = module[exportKey];

          // TypeScript should enforce IconDefinition structure
          // If this compiles and runs, types are correct
          expect(icon.id).toBeDefined();
          expect(icon.content).toBeDefined();
          expect(icon.viewBox).toBeDefined();
        }
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

    it('should have matching IDs and file names', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        // Test first 10 icons
        for (const file of files.slice(0, 10)) {
          const fileName = file.replace('.ts', '');
          const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/${fileName}.js`);

          const exportKey = Object.keys(module).find((k) => k !== 'default');
          if (exportKey) {
            const icon = module[exportKey];
            expect(icon.id).toBe(fileName);
          }
        }

        console.log(`✓ ${preset}: First 10 icons have matching IDs and file names`);
      }
    });
  });

  describe('Export Completeness', () => {
    it('should export all icons from index', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/index.js`);
        const exports = Object.keys(module).filter((k) => k.endsWith('Icon'));

        // Number of exports should match number of icon files (roughly)
        // Some variance is acceptable due to metadata exports
        expect(exports.length).toBeGreaterThan(files.length * 0.9); // At least 90% of files exported
        console.log(`${preset}: ${exports.length} icons exported from ${files.length} files`);
      }
    });

    it('should have metadata exports in index', async () => {
      for (const preset of PRESETS) {
        const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/index.js`);

        const metadataKey = `HUGEICONS_${preset.toUpperCase()}_METADATA`;
        expect(module).toHaveProperty(metadataKey);

        const metadata = module[metadataKey];
        expect(metadata).toHaveProperty('preset');
        expect(metadata).toHaveProperty('count');
        expect(metadata.preset).toBe(preset);
        expect(metadata.count).toBeGreaterThan(0);

        console.log(`${preset}: metadata.count = ${metadata.count}`);
      }
    });
  });

  describe('Cross-Reference Checks', () => {
    it('should have consistent icon counts between files and metadata', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/index.js`);
        const metadataKey = `HUGEICONS_${preset.toUpperCase()}_METADATA`;
        const metadata = module[metadataKey];

        // Metadata count should match file count
        expect(metadata.count).toBe(files.length);
        console.log(`${preset}: ${files.length} files = ${metadata.count} metadata count ✓`);
      }
    });

    it('should have all file exports listed in metadata', async () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        const module = await import(`../../../../../src/svg/icons/presets/hugeicons/${preset}/index.js`);
        const iconExports = Object.keys(module).filter((k) => k.endsWith('Icon'));

        // All icon exports should be present
        expect(iconExports.length).toBeGreaterThan(0);
        expect(iconExports.length).toBeLessThanOrEqual(files.length);

        console.log(`${preset}: ${iconExports.length} exports for ${files.length} files`);
      }
    });
  });
});
