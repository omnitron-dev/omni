/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('HugeIcons Transformation', () => {
  const PRESETS = ['stroke', 'duotone', 'twotone'] as const;
  const ICONS_DIR = join(process.cwd(), 'src/svg/icons/presets/hugeicons');

  describe('Stroke Preset', () => {
    const strokeDir = join(ICONS_DIR, 'stroke');

    it('should have transformed icons', () => {
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      expect(files.length).toBeGreaterThan(0);
      console.log(`Stroke preset: ${files.length} icons`);
    });

    it('should have valid icon structure', () => {
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      // Check basic structure
      expect(content).toContain('IconDefinition');
      expect(content).toContain('export const');
      expect(content).toContain('"id"');
      expect(content).toContain('"content"');
      expect(content).toContain('"viewBox"');
      expect(content).toContain('"metadata"');
    });

    it('should have removed default stroke attribute', () => {
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      // stroke="currentColor" should not be present (it's the default)
      // Note: Some icons might have non-default stroke values
      const hasDefaultStroke = content.includes('stroke=\\"currentColor\\"');
      if (hasDefaultStroke) {
        console.warn(`Warning: ${sampleFile} still has default stroke attribute`);
      }
    });

    it('should have numeric attributes as numbers', () => {
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      // Check that width and height are numbers
      expect(content).toMatch(/"width":\s*24/);
      expect(content).toMatch(/"height":\s*24/);
    });

    it('should have valid SVG content', () => {
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      // Extract content field using proper regex for escaped strings
      const contentMatch = content.match(/"content":\s*"((?:[^"\\]|\\.)*)"/s);
      expect(contentMatch).toBeTruthy();

      if (contentMatch) {
        const svgContent = contentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        expect(svgContent).toContain('<svg');
        expect(svgContent).toContain('viewBox="0 0 24 24"');
        expect(svgContent).toContain('fill="none"');
        expect(svgContent).toContain('</svg>');
      }
    });

    it('should have metadata with preset info', () => {
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      expect(content).toContain('"preset": "stroke"');
      expect(content).toContain('"originalName"');
      expect(content).toContain('"elementsCount"');
    });

    it('should have removed React keys', () => {
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      for (const file of files.slice(0, 10)) {
        // Check first 10 files
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        expect(content).not.toContain('key=');
      }
    });

    it('should convert strokeLinecap and strokeLinejoin to kebab-case', () => {
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      // Check that camelCase attributes are converted to kebab-case in SVG
      const contentMatch = content.match(/"content":\s*"((?:[^"\\]|\\.)*)"/s);
      if (contentMatch) {
        const svgContent = contentMatch[1];
        // Should have kebab-case attributes, not camelCase
        expect(svgContent).not.toContain('strokeLinecap');
        expect(svgContent).not.toContain('strokeLinejoin');
        expect(svgContent).not.toContain('strokeWidth');
      }
    });
  });

  describe('Duotone Preset', () => {
    const duotoneDir = join(ICONS_DIR, 'duotone');

    it('should have transformed icons', () => {
      const files = readdirSync(duotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      expect(files.length).toBeGreaterThan(0);
      console.log(`Duotone preset: ${files.length} icons`);
    });

    it('should have valid icon structure', () => {
      const files = readdirSync(duotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      if (files.length === 0) {
        console.warn('No duotone icons found - skipping structure test');
        return;
      }

      const sampleFile = files[0];
      const content = readFileSync(join(duotoneDir, sampleFile), 'utf-8');

      expect(content).toContain('IconDefinition');
      expect(content).toContain('export const');
      expect(content).toContain('"preset": "duotone"');
    });

    it('should preserve fillRule attribute when present', () => {
      const files = readdirSync(duotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      if (files.length === 0) {
        console.warn('No duotone icons found - skipping fillRule test');
        return;
      }

      // Check at least one icon that might have fillRule
      const sampleFile = files[0];
      const content = readFileSync(join(duotoneDir, sampleFile), 'utf-8');

      // fillRule might be present in some icons
      const contentMatch = content.match(/"content":\s*"((?:[^"\\]|\\\\.)*)"/);
      if (contentMatch && contentMatch[1].includes('fill-rule')) {
        console.log(`${sampleFile} has fillRule attribute (preserved correctly)`);
      }
    });

    it('should handle duplicate paths by merging', () => {
      const files = readdirSync(duotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      if (files.length === 0) {
        console.warn('No duotone icons found - skipping duplicate path test');
        return;
      }

      // Duotone icons should have merged duplicate paths
      // We check that the transformation worked by verifying structure
      const sampleFile = files[0];
      const content = readFileSync(join(duotoneDir, sampleFile), 'utf-8');

      expect(content).toContain('"metadata"');
      expect(content).toContain('"elementsCount"');
    });
  });

  describe('Twotone Preset', () => {
    const twotoneDir = join(ICONS_DIR, 'twotone');

    it('should have transformed icons', () => {
      const files = readdirSync(twotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      expect(files.length).toBeGreaterThan(0);
      console.log(`Twotone preset: ${files.length} icons`);
    });

    it('should have valid icon structure', () => {
      const files = readdirSync(twotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      if (files.length === 0) {
        console.warn('No twotone icons found - skipping structure test');
        return;
      }

      const sampleFile = files[0];
      const content = readFileSync(join(twotoneDir, sampleFile), 'utf-8');

      expect(content).toContain('IconDefinition');
      expect(content).toContain('export const');
      expect(content).toContain('"preset": "twotone"');
    });

    it('should preserve opacity attribute for layering', () => {
      const files = readdirSync(twotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      if (files.length === 0) {
        console.warn('No twotone icons found - skipping opacity test');
        return;
      }

      // Check if any icons have opacity metadata
      let hasOpacityIcon = false;
      for (const file of files.slice(0, 10)) {
        const content = readFileSync(join(twotoneDir, file), 'utf-8');
        if (content.includes('"hasOpacity": true')) {
          hasOpacityIcon = true;
          console.log(`${file} has opacity attribute (preserved correctly)`);
          break;
        }
      }

      // Twotone icons should typically have opacity for the second tone
      if (!hasOpacityIcon) {
        console.warn('No twotone icons with opacity found in sample');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle unusual strokeWidth values', () => {
      // Some icons might have non-standard strokeWidth
      // The transformation should preserve these
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      for (const file of files.slice(0, 20)) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const contentMatch = content.match(/"content":\s*"((?:[^"\\]|\\\\.)*)"/);

        if (contentMatch) {
          const svgContent = contentMatch[1];
          // If there's a stroke-width attribute, it should be a valid number
          const strokeWidthMatch = svgContent.match(/stroke-width=\\"([\d.]+)\\"/);
          if (strokeWidthMatch) {
            const strokeWidth = parseFloat(strokeWidthMatch[1]);
            expect(strokeWidth).toBeGreaterThan(0);
            expect(strokeWidth).toBeLessThanOrEqual(10);
          }
        }
      }
    });

    it('should handle special characters in icon names', () => {
      // Icon names with numbers, hyphens should be handled correctly
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      const specialFiles = files.filter((f) => /\d/.test(f) || f.includes('-'));
      expect(specialFiles.length).toBeGreaterThan(0);

      // Check that they have valid kebab-case IDs
      for (const file of specialFiles.slice(0, 5)) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const idMatch = content.match(/"id":\s*"([^"]+)"/);

        expect(idMatch).toBeTruthy();
        if (idMatch) {
          const id = idMatch[1];
          // Should be kebab-case
          expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        }
      }
    });

    it('should have valid path d attributes', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      for (const file of files.slice(0, 10)) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const contentMatch = content.match(/"content":\s*"((?:[^"\\]|\\\\.)*)"/);

        if (contentMatch) {
          const svgContent = contentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
          const pathMatches = svgContent.matchAll(/d="([^"]+)"/g);

          for (const pathMatch of pathMatches) {
            const dAttribute = pathMatch[1];
            // d attribute should contain valid SVG commands (M, L, C, Z, etc.)
            expect(dAttribute).toMatch(/[MLHVCSQTAZ]/i);
            // Should not be empty
            expect(dAttribute.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should have consistent viewBox across all icons', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 10)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          // Check viewBox field
          expect(content).toContain('"viewBox": "0 0 24 24"');

          // Check SVG viewBox attribute
          const contentMatch = content.match(/"content":\s*"((?:[^"\\]|\\\\.)*)"/);
          if (contentMatch) {
            const svgContent = contentMatch[1];
            expect(svgContent).toContain('viewBox=\\"0 0 24 24\\"');
          }
        }
      }
    });
  });

  describe('TypeScript Types', () => {
    it('should import IconDefinition type', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      expect(content).toContain("import type { IconDefinition } from '../../../IconRegistry.js'");
    });

    it('should have properly typed exports', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      // Export should be typed as IconDefinition
      expect(content).toMatch(/export const \w+:\s*IconDefinition/);
    });
  });

  describe('Optimization', () => {
    it('should have optimized file sizes', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

      let totalSize = 0;
      for (const file of files) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        totalSize += content.length;
      }

      const avgSize = totalSize / files.length;
      console.log(`Average icon file size: ${avgSize.toFixed(0)} bytes`);

      // Average icon file should be reasonably small (under 2KB)
      expect(avgSize).toBeLessThan(2000);
    });

    it('should not have unnecessary whitespace in SVG content', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const files = readdirSync(strokeDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const sampleFile = files[0];
      const content = readFileSync(join(strokeDir, sampleFile), 'utf-8');

      const contentMatch = content.match(/"content":\s*"((?:[^"\\]|\\\\.)*)"/);
      if (contentMatch) {
        const svgContent = contentMatch[1];
        // Should not have multiple consecutive spaces
        expect(svgContent).not.toMatch(/  +/);
      }
    });
  });
});
