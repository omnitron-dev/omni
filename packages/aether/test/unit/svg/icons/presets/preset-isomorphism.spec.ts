/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';

describe('Icon Presets Isomorphism', () => {
  const ICONS_DIR = join(process.cwd(), 'src/svg/icons/presets');
  const PRESETS = ['stroke', 'duotone', 'twotone'] as const;
  const EXPECTED_ICON_COUNT = 4559;

  // Cache icon names for all presets
  const presetIconNames: Record<string, Set<string>> = {};

  beforeAll(() => {
    console.log('\n=== Loading Icon Names from All Presets ===\n');

    for (const preset of PRESETS) {
      const presetDir = join(ICONS_DIR, preset);
      const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      // Extract icon names (filename without .ts extension)
      const iconNames = new Set(files.map((f) => f.replace('.ts', '')));
      presetIconNames[preset] = iconNames;

      console.log(`${preset}: ${iconNames.size} icons`);
    }

    console.log('\n===========================================\n');
  });

  describe('Icon Count Validation', () => {
    it('should have exactly 4,559 icons in stroke preset', () => {
      const strokeCount = presetIconNames.stroke.size;
      expect(strokeCount).toBe(EXPECTED_ICON_COUNT);
    });

    it('should have exactly 4,559 icons in duotone preset', () => {
      const duotoneCount = presetIconNames.duotone.size;
      expect(duotoneCount).toBe(EXPECTED_ICON_COUNT);
    });

    it('should have exactly 4,559 icons in twotone preset', () => {
      const twotoneCount = presetIconNames.twotone.size;
      expect(twotoneCount).toBe(EXPECTED_ICON_COUNT);
    });

    it('should have same icon count across all presets', () => {
      const counts = PRESETS.map((preset) => presetIconNames[preset].size);
      const uniqueCounts = new Set(counts);

      expect(uniqueCounts.size).toBe(1);
      expect([...uniqueCounts][0]).toBe(EXPECTED_ICON_COUNT);
    });
  });

  describe('Icon Name Isomorphism', () => {
    it('should have identical icon names across all presets', () => {
      const strokeIcons = [...presetIconNames.stroke].sort();
      const duotoneIcons = [...presetIconNames.duotone].sort();
      const twotoneIcons = [...presetIconNames.twotone].sort();

      // Generate detailed diff report if there's a mismatch
      const strokeSet = new Set(strokeIcons);
      const duotoneSet = new Set(duotoneIcons);
      const twotoneSet = new Set(twotoneIcons);

      const missingFromDuotone = strokeIcons.filter((icon) => !duotoneSet.has(icon));
      const missingFromTwotone = strokeIcons.filter((icon) => !twotoneSet.has(icon));
      const extraInDuotone = duotoneIcons.filter((icon) => !strokeSet.has(icon));
      const extraInTwotone = twotoneIcons.filter((icon) => !strokeSet.has(icon));

      if (
        missingFromDuotone.length > 0 ||
        missingFromTwotone.length > 0 ||
        extraInDuotone.length > 0 ||
        extraInTwotone.length > 0
      ) {
        console.error('\n❌ PRESET ISOMORPHISM VIOLATION DETECTED\n');
        console.error('='.repeat(80));

        if (missingFromDuotone.length > 0) {
          console.error(`\n🔴 Missing from DUOTONE (${missingFromDuotone.length} icons):`);
          console.error(missingFromDuotone.slice(0, 20).join(', '));
          if (missingFromDuotone.length > 20) {
            console.error(`... and ${missingFromDuotone.length - 20} more`);
          }
        }

        if (missingFromTwotone.length > 0) {
          console.error(`\n🔴 Missing from TWOTONE (${missingFromTwotone.length} icons):`);
          console.error(missingFromTwotone.slice(0, 20).join(', '));
          if (missingFromTwotone.length > 20) {
            console.error(`... and ${missingFromTwotone.length - 20} more`);
          }
        }

        if (extraInDuotone.length > 0) {
          console.error(`\n🟡 Extra in DUOTONE (${extraInDuotone.length} icons):`);
          console.error(extraInDuotone.slice(0, 20).join(', '));
          if (extraInDuotone.length > 20) {
            console.error(`... and ${extraInDuotone.length - 20} more`);
          }
        }

        if (extraInTwotone.length > 0) {
          console.error(`\n🟡 Extra in TWOTONE (${extraInTwotone.length} icons):`);
          console.error(extraInTwotone.slice(0, 20).join(', '));
          if (extraInTwotone.length > 20) {
            console.error(`... and ${extraInTwotone.length - 20} more`);
          }
        }

        console.error('\n' + '='.repeat(80) + '\n');
      }

      // These assertions will fail with clear messages if there are differences
      expect(strokeIcons).toEqual(duotoneIcons);
      expect(strokeIcons).toEqual(twotoneIcons);
      expect(duotoneIcons).toEqual(twotoneIcons);
    });

    it('should have no extra icons in any preset', () => {
      const strokeIcons = presetIconNames.stroke;
      const duotoneIcons = presetIconNames.duotone;
      const twotoneIcons = presetIconNames.twotone;

      // Create union of all icon names
      const allIcons = new Set([...strokeIcons, ...duotoneIcons, ...twotoneIcons]);

      // Each preset should have exactly the same icons as the union
      expect(strokeIcons.size).toBe(allIcons.size);
      expect(duotoneIcons.size).toBe(allIcons.size);
      expect(twotoneIcons.size).toBe(allIcons.size);
    });

    it('should have no missing icons in any preset', () => {
      const strokeIcons = presetIconNames.stroke;
      const duotoneIcons = presetIconNames.duotone;
      const twotoneIcons = presetIconNames.twotone;

      // Every icon in stroke should be in duotone and twotone
      for (const icon of strokeIcons) {
        expect(duotoneIcons.has(icon)).toBe(true);
        expect(twotoneIcons.has(icon)).toBe(true);
      }

      // Every icon in duotone should be in stroke and twotone
      for (const icon of duotoneIcons) {
        expect(strokeIcons.has(icon)).toBe(true);
        expect(twotoneIcons.has(icon)).toBe(true);
      }

      // Every icon in twotone should be in stroke and duotone
      for (const icon of twotoneIcons) {
        expect(strokeIcons.has(icon)).toBe(true);
        expect(duotoneIcons.has(icon)).toBe(true);
      }
    });
  });

  describe('Detailed Mismatch Reporting', () => {
    it('should report icons missing from stroke preset', () => {
      const strokeIcons = presetIconNames.stroke;
      const duotoneIcons = presetIconNames.duotone;
      const twotoneIcons = presetIconNames.twotone;

      const missingFromStroke = [...duotoneIcons, ...twotoneIcons].filter((icon) => !strokeIcons.has(icon));

      const uniqueMissing = [...new Set(missingFromStroke)].sort();

      if (uniqueMissing.length > 0) {
        console.error(`\n❌ Icons missing from STROKE: ${uniqueMissing.length}`);
        console.error(uniqueMissing.slice(0, 50).join(', '));
      }

      expect(uniqueMissing.length).toBe(0);
    });

    it('should report icons missing from duotone preset', () => {
      const strokeIcons = presetIconNames.stroke;
      const duotoneIcons = presetIconNames.duotone;
      const twotoneIcons = presetIconNames.twotone;

      const missingFromDuotone = [...strokeIcons, ...twotoneIcons].filter((icon) => !duotoneIcons.has(icon));

      const uniqueMissing = [...new Set(missingFromDuotone)].sort();

      if (uniqueMissing.length > 0) {
        console.error(`\n❌ Icons missing from DUOTONE: ${uniqueMissing.length}`);
        console.error(uniqueMissing.slice(0, 50).join(', '));
      }

      expect(uniqueMissing.length).toBe(0);
    });

    it('should report icons missing from twotone preset', () => {
      const strokeIcons = presetIconNames.stroke;
      const duotoneIcons = presetIconNames.duotone;
      const twotoneIcons = presetIconNames.twotone;

      const missingFromTwotone = [...strokeIcons, ...duotoneIcons].filter((icon) => !twotoneIcons.has(icon));

      const uniqueMissing = [...new Set(missingFromTwotone)].sort();

      if (uniqueMissing.length > 0) {
        console.error(`\n❌ Icons missing from TWOTONE: ${uniqueMissing.length}`);
        console.error(uniqueMissing.slice(0, 50).join(', '));
      }

      expect(uniqueMissing.length).toBe(0);
    });

    it('should report icons only in specific presets', () => {
      const strokeIcons = presetIconNames.stroke;
      const duotoneIcons = presetIconNames.duotone;
      const twotoneIcons = presetIconNames.twotone;

      // Icons only in stroke
      const onlyInStroke = [...strokeIcons].filter((icon) => !duotoneIcons.has(icon) && !twotoneIcons.has(icon));

      // Icons only in duotone
      const onlyInDuotone = [...duotoneIcons].filter((icon) => !strokeIcons.has(icon) && !twotoneIcons.has(icon));

      // Icons only in twotone
      const onlyInTwotone = [...twotoneIcons].filter((icon) => !strokeIcons.has(icon) && !duotoneIcons.has(icon));

      if (onlyInStroke.length > 0) {
        console.error(`\n🔴 Icons ONLY in STROKE: ${onlyInStroke.length}`);
        console.error(onlyInStroke.slice(0, 20).join(', '));
      }

      if (onlyInDuotone.length > 0) {
        console.error(`\n🔴 Icons ONLY in DUOTONE: ${onlyInDuotone.length}`);
        console.error(onlyInDuotone.slice(0, 20).join(', '));
      }

      if (onlyInTwotone.length > 0) {
        console.error(`\n🔴 Icons ONLY in TWOTONE: ${onlyInTwotone.length}`);
        console.error(onlyInTwotone.slice(0, 20).join(', '));
      }

      expect(onlyInStroke.length).toBe(0);
      expect(onlyInDuotone.length).toBe(0);
      expect(onlyInTwotone.length).toBe(0);
    });

    it('should generate intersection report', () => {
      const strokeIcons = presetIconNames.stroke;
      const duotoneIcons = presetIconNames.duotone;
      const twotoneIcons = presetIconNames.twotone;

      // Calculate intersections
      const strokeDuotone = [...strokeIcons].filter((icon) => duotoneIcons.has(icon));
      const strokeTwotone = [...strokeIcons].filter((icon) => twotoneIcons.has(icon));
      const duotoneTwotone = [...duotoneIcons].filter((icon) => twotoneIcons.has(icon));

      // Calculate full intersection (icons in ALL presets)
      const allThree = [...strokeIcons].filter((icon) => duotoneIcons.has(icon) && twotoneIcons.has(icon));

      console.log('\n=== Intersection Report ===');
      console.log(`Stroke ∩ Duotone: ${strokeDuotone.length} icons`);
      console.log(`Stroke ∩ Twotone: ${strokeTwotone.length} icons`);
      console.log(`Duotone ∩ Twotone: ${duotoneTwotone.length} icons`);
      console.log(`All Three: ${allThree.length} icons`);
      console.log('===========================\n');

      // For perfect isomorphism, all intersections should equal total count
      expect(strokeDuotone.length).toBe(EXPECTED_ICON_COUNT);
      expect(strokeTwotone.length).toBe(EXPECTED_ICON_COUNT);
      expect(duotoneTwotone.length).toBe(EXPECTED_ICON_COUNT);
      expect(allThree.length).toBe(EXPECTED_ICON_COUNT);
    });

    it('should generate union report', () => {
      const strokeIcons = presetIconNames.stroke;
      const duotoneIcons = presetIconNames.duotone;
      const twotoneIcons = presetIconNames.twotone;

      // Calculate union
      const union = new Set([...strokeIcons, ...duotoneIcons, ...twotoneIcons]);

      console.log('\n=== Union Report ===');
      console.log(`Total unique icons across all presets: ${union.size}`);
      console.log(`Expected: ${EXPECTED_ICON_COUNT}`);
      console.log(`Difference: ${union.size - EXPECTED_ICON_COUNT}`);
      console.log('====================\n');

      // For perfect isomorphism, union should equal expected count
      expect(union.size).toBe(EXPECTED_ICON_COUNT);
    });
  });

  describe('File Naming Consistency', () => {
    it('should have kebab-case filenames', () => {
      for (const preset of PRESETS) {
        const icons = [...presetIconNames[preset]];
        const invalidNames = icons.filter((name) => {
          // Valid kebab-case: lowercase letters, numbers, and hyphens
          return !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
        });

        if (invalidNames.length > 0) {
          console.error(`\n❌ Invalid filenames in ${preset}:`);
          console.error(invalidNames.slice(0, 20).join(', '));
        }

        expect(invalidNames.length).toBe(0);
      }
    });

    it('should not have duplicate icon names (case-insensitive)', () => {
      for (const preset of PRESETS) {
        const icons = [...presetIconNames[preset]];
        const lowercaseNames = icons.map((name) => name.toLowerCase());
        const uniqueNames = new Set(lowercaseNames);

        expect(uniqueNames.size).toBe(icons.length);
      }
    });

    it('should not have index.ts in icon name sets', () => {
      for (const preset of PRESETS) {
        const icons = presetIconNames[preset];

        expect(icons.has('index')).toBe(false);
      }
    });
  });

  describe('Performance Validation', () => {
    it('should load all icon names in under 5 seconds', () => {
      const startTime = Date.now();

      const tempIconNames: Record<string, Set<string>> = {};

      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
        tempIconNames[preset] = new Set(files.map((f) => f.replace('.ts', '')));
      }

      const elapsed = Date.now() - startTime;

      console.log(`\nLoaded ${PRESETS.length} presets in ${elapsed}ms`);

      expect(elapsed).toBeLessThan(5000);
    });
  });
});
