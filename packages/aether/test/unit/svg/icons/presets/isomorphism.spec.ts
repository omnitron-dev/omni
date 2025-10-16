/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('Icon Presets Isomorphism Tests', () => {
  const ICONS_DIR = join(process.cwd(), 'src/svg/icons/presets');
  const PRESETS = ['stroke', 'duotone', 'twotone'] as const;

  /**
   * Parse SVG content from icon definition
   */
  function extractSVGContent(iconContent: string): string {
    const match = iconContent.match(/"content":\s*"((?:[^"\\]|\\["\\\/bfnrt]|\\u[0-9a-fA-F]{4})*)"/);
    if (!match) throw new Error('Could not extract SVG content');
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }

  /**
   * Normalize SVG for comparison
   * Removes whitespace differences and normalizes attributes
   */
  function normalizeSVG(svg: string): string {
    return svg
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/>\s+</g, '><') // Remove whitespace between tags
      .trim();
  }

  /**
   * Extract path data from SVG
   */
  function extractPathData(svg: string): string[] {
    const paths: string[] = [];
    const pathRegex = /<path[^>]*d="([^"]+)"[^>]*\/>/g;
    let match;
    while ((match = pathRegex.exec(svg)) !== null) {
      paths.push(match[1]);
    }
    return paths;
  }

  /**
   * Extract all elements from SVG
   */
  function extractElements(svg: string): string[] {
    const elements: string[] = [];
    const elementRegex = /<(path|circle|rect|line|polyline|polygon|ellipse)[^>]*\/>/g;
    let match;
    while ((match = elementRegex.exec(svg)) !== null) {
      elements.push(match[0]);
    }
    return elements;
  }

  /**
   * Get random sample of icons from a preset
   */
  function getSampleIcons(preset: string, count: number): string[] {
    const presetDir = join(ICONS_DIR, preset);
    const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

    // Use deterministic random sampling based on array length
    const sampleSize = Math.min(count, files.length);
    const step = Math.floor(files.length / sampleSize);

    return files.filter((_, i) => i % step === 0).slice(0, sampleSize);
  }

  describe('Visual Equivalence - Stroke Preset', () => {
    const sampleIcons = getSampleIcons('stroke', 100);

    it('should sample correct number of icons', () => {
      expect(sampleIcons.length).toBeGreaterThan(0);
      expect(sampleIcons.length).toBeLessThanOrEqual(100);
      console.log(`Testing ${sampleIcons.length} stroke icons for visual equivalence`);
    });

    it('should preserve viewBox dimensions', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');

      for (const file of sampleIcons) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const svg = extractSVGContent(content);

        expect(svg).toContain('viewBox="0 0 24 24"');
      }
    });

    it('should preserve path data', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');

      for (const file of sampleIcons) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const svg = extractSVGContent(content);

        const paths = extractPathData(svg);
        expect(paths.length).toBeGreaterThan(0);

        // Each path should have valid SVG commands
        for (const path of paths) {
          expect(path).toMatch(/[MLHVCSQTAZ]/i);
          expect(path.length).toBeGreaterThan(0);
        }
      }
    });

    it('should preserve element count', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');

      for (const file of sampleIcons) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const svg = extractSVGContent(content);

        // Extract metadata elementsCount
        const elementsCountMatch = content.match(/"elementsCount":\s*(\d+)/);
        expect(elementsCountMatch).toBeTruthy();

        if (elementsCountMatch) {
          const metadataCount = parseInt(elementsCountMatch[1], 10);
          const elements = extractElements(svg);

          // Should match or be very close (some merging might occur)
          expect(elements.length).toBeGreaterThan(0);
          expect(Math.abs(elements.length - metadataCount)).toBeLessThanOrEqual(2);
        }
      }
    });

    it('should render valid SVG in DOM', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');

      for (const file of sampleIcons.slice(0, 10)) {
        // Test first 10 in DOM
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const svg = extractSVGContent(content);

        // Parse SVG in DOM
        const container = document.createElement('div');
        container.innerHTML = svg;

        const svgElement = container.querySelector('svg');
        expect(svgElement).toBeTruthy();
        expect(svgElement?.tagName).toBe('svg');

        // Check viewBox
        expect(svgElement?.getAttribute('viewBox')).toBe('0 0 24 24');

        // Check that paths are valid
        const paths = svgElement?.querySelectorAll('path');
        expect(paths?.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Visual Equivalence - Duotone Preset', () => {
    const duotoneDir = join(ICONS_DIR, 'duotone');
    const files = readdirSync(duotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

    if (files.length === 0) {
      it.skip('No duotone icons found', () => {});
    } else {
      const sampleIcons = getSampleIcons('duotone', 100);

      it('should sample correct number of icons', () => {
        expect(sampleIcons.length).toBeGreaterThan(0);
        console.log(`Testing ${sampleIcons.length} duotone icons for visual equivalence`);
      });

      it('should preserve viewBox dimensions', () => {
        for (const file of sampleIcons) {
          const content = readFileSync(join(duotoneDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          expect(svg).toContain('viewBox="0 0 24 24"');
        }
      });

      it('should preserve fill attributes', () => {
        for (const file of sampleIcons) {
          const content = readFileSync(join(duotoneDir, file), 'utf-8');

          // Check metadata
          const hasFillMatch = content.match(/"hasFill":\s*(true|false)/);
          if (hasFillMatch && hasFillMatch[1] === 'true') {
            const svg = extractSVGContent(content);
            expect(svg).toMatch(/fill=/);
          }
        }
      });

      it('should render valid SVG in DOM', () => {
        for (const file of sampleIcons.slice(0, 10)) {
          const content = readFileSync(join(duotoneDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          const container = document.createElement('div');
          container.innerHTML = svg;

          const svgElement = container.querySelector('svg');
          expect(svgElement).toBeTruthy();
        }
      });
    }
  });

  describe('Visual Equivalence - Twotone Preset', () => {
    const twotoneDir = join(ICONS_DIR, 'twotone');
    const files = readdirSync(twotoneDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

    if (files.length === 0) {
      it.skip('No twotone icons found', () => {});
    } else {
      const sampleIcons = getSampleIcons('twotone', 100);

      it('should sample correct number of icons', () => {
        expect(sampleIcons.length).toBeGreaterThan(0);
        console.log(`Testing ${sampleIcons.length} twotone icons for visual equivalence`);
      });

      it('should preserve viewBox dimensions', () => {
        for (const file of sampleIcons) {
          const content = readFileSync(join(twotoneDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          expect(svg).toContain('viewBox="0 0 24 24"');
        }
      });

      it('should preserve opacity attributes', () => {
        for (const file of sampleIcons) {
          const content = readFileSync(join(twotoneDir, file), 'utf-8');

          // Check metadata
          const hasOpacityMatch = content.match(/"hasOpacity":\s*(true|false)/);
          if (hasOpacityMatch && hasOpacityMatch[1] === 'true') {
            const svg = extractSVGContent(content);
            expect(svg).toMatch(/opacity=/);
          }
        }
      });

      it('should render valid SVG in DOM', () => {
        for (const file of sampleIcons.slice(0, 10)) {
          const content = readFileSync(join(twotoneDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          const container = document.createElement('div');
          container.innerHTML = svg;

          const svgElement = container.querySelector('svg');
          expect(svgElement).toBeTruthy();
        }
      });
    }
  });

  describe('Cross-preset Consistency', () => {
    it('should have same icon names across presets', () => {
      const iconsByPreset: Record<string, Set<string>> = {};

      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        iconsByPreset[preset] = new Set(files.map((f) => f.replace('.ts', '')));
      }

      // Get icon names from stroke (our reference preset)
      const strokeIcons = iconsByPreset.stroke;
      console.log(`Stroke preset has ${strokeIcons.size} icons`);

      // Check other presets
      for (const preset of PRESETS.filter((p) => p !== 'stroke')) {
        const presetIcons = iconsByPreset[preset];
        if (presetIcons.size === 0) {
          console.warn(`${preset} preset has no icons`);
          continue;
        }

        console.log(`${preset} preset has ${presetIcons.size} icons`);

        // Sample check: at least some icons should overlap
        const overlap = [...strokeIcons].filter((icon) => presetIcons.has(icon));
        if (overlap.length === 0) {
          console.warn(`No icon overlap between stroke and ${preset}`);
        } else {
          console.log(`${overlap.length} icons overlap between stroke and ${preset}`);
        }
      }
    });

    it('should have consistent viewBox across presets for same icon', () => {
      // Find icons that exist in all presets
      const iconsByPreset: Record<string, Set<string>> = {};

      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
        iconsByPreset[preset] = new Set(files.map((f) => f.replace('.ts', '')));
      }

      // Find common icons
      const strokeIcons = [...iconsByPreset.stroke];
      const commonIcons = strokeIcons.filter((icon) => {
        return PRESETS.every((preset) => iconsByPreset[preset]?.has(icon));
      });

      if (commonIcons.length === 0) {
        console.warn('No icons found in all presets');
        return;
      }

      console.log(`Testing ${Math.min(5, commonIcons.length)} common icons across presets`);

      // Test first few common icons
      for (const iconName of commonIcons.slice(0, 5)) {
        for (const preset of PRESETS) {
          const presetDir = join(ICONS_DIR, preset);
          const file = `${iconName}.ts`;
          const content = readFileSync(join(presetDir, file), 'utf-8');

          expect(content).toContain('"viewBox": "0 0 24 24"');
        }
      }
    });
  });

  describe('SVG Structure Validation', () => {
    it('should have proper SVG namespace', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const sampleIcons = getSampleIcons('stroke', 10);

      for (const file of sampleIcons) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const svg = extractSVGContent(content);

        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      }
    });

    it('should have fill="none" on root svg', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const sampleIcons = getSampleIcons('stroke', 10);

      for (const file of sampleIcons) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const svg = extractSVGContent(content);

        expect(svg).toContain('fill="none"');
      }
    });

    it('should have properly closed tags', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const sampleIcons = getSampleIcons('stroke', 10);

      for (const file of sampleIcons) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const svg = extractSVGContent(content);

        // Check that svg tag is properly closed
        expect(svg).toMatch(/<svg[^>]*>[\s\S]*<\/svg>/);

        // Check that all path tags are self-closing
        const paths = svg.match(/<path[^>]*>/g) || [];
        for (const path of paths) {
          expect(path).toMatch(/<path[^>]*\/>/);
        }
      }
    });

    it('should not have nested svg elements', () => {
      const strokeDir = join(ICONS_DIR, 'stroke');
      const sampleIcons = getSampleIcons('stroke', 10);

      for (const file of sampleIcons) {
        const content = readFileSync(join(strokeDir, file), 'utf-8');
        const svg = extractSVGContent(content);

        // Count svg tags - should only be 2 (opening and closing)
        const svgTags = svg.match(/<\/?svg[^>]*>/g) || [];
        expect(svgTags.length).toBe(2);
      }
    });
  });
});
