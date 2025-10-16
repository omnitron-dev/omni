/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('HugeIcons Completeness Tests', () => {
  const ICONS_DIR = join(process.cwd(), 'src/svg/icons/presets/hugeicons');
  const PRESETS = ['stroke', 'duotone', 'twotone'] as const;

  /**
   * Extract SVG content from icon file
   */
  function extractSVGContent(content: string): string {
    const match = content.match(/"content":\s*"((?:[^"\\]|\\\\.)*)"/);
    if (!match) throw new Error('Could not extract SVG content');
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }

  /**
   * Validate SVG path 'd' attribute
   */
  function isValidPathData(d: string): boolean {
    // Valid path commands: M, L, H, V, C, S, Q, T, A, Z (case insensitive)
    const pathCommandRegex = /^[MLHVCSQTAZmlhvcsqtaz0-9\s.,\-]+$/;
    return pathCommandRegex.test(d) && d.length > 0;
  }

  describe('SVG Data Validity', () => {
    it('should have valid path d attributes', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        let validCount = 0;
        let invalidCount = 0;

        for (const file of files.slice(0, 50)) {
          // Test first 50 icons
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          const pathMatches = [...svg.matchAll(/d=\\"([^"]+)\\"/g)];

          for (const match of pathMatches) {
            const d = match[1];
            if (isValidPathData(d)) {
              validCount++;
            } else {
              invalidCount++;
              console.warn(`Invalid path in ${preset}/${file}: ${d.substring(0, 50)}...`);
            }
          }
        }

        console.log(`${preset}: ${validCount} valid paths, ${invalidCount} invalid`);
        expect(invalidCount).toBe(0);
      }
    });

    it('should have valid circle attributes', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          const circleMatches = [...svg.matchAll(/<circle[^>]*>/g)];

          for (const match of circleMatches) {
            const circle = match[0];

            // If it has cx, cy, r they should be valid numbers
            const cxMatch = circle.match(/cx=\\"([^"]+)\\"/);
            const cyMatch = circle.match(/cy=\\"([^"]+)\\"/);
            const rMatch = circle.match(/r=\\"([^"]+)\\"/);

            if (cxMatch) {
              const cx = parseFloat(cxMatch[1]);
              expect(isNaN(cx)).toBe(false);
            }

            if (cyMatch) {
              const cy = parseFloat(cyMatch[1]);
              expect(isNaN(cy)).toBe(false);
            }

            if (rMatch) {
              const r = parseFloat(rMatch[1]);
              expect(isNaN(r)).toBe(false);
              expect(r).toBeGreaterThan(0);
            }
          }
        }
      }
    });

    it('should not have empty path data', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 50)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          const pathMatches = [...svg.matchAll(/d=\\"([^"]*)\\"/g)];

          for (const match of pathMatches) {
            const d = match[1];
            expect(d.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('Numeric Ranges', () => {
    it('should have strokeWidth in valid range', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 50)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          const strokeWidthMatches = [...svg.matchAll(/stroke-width=\\"([^"]+)\\"/g)];

          for (const match of strokeWidthMatches) {
            const strokeWidth = parseFloat(match[1]);
            expect(isNaN(strokeWidth)).toBe(false);
            expect(strokeWidth).toBeGreaterThan(0);
            expect(strokeWidth).toBeLessThanOrEqual(10); // Reasonable upper bound
          }
        }
      }
    });

    it('should have opacity in valid range (0-1)', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 50)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          const opacityMatches = [...svg.matchAll(/opacity=\\"([^"]+)\\"/g)];

          for (const match of opacityMatches) {
            const opacity = parseFloat(match[1]);
            expect(isNaN(opacity)).toBe(false);
            expect(opacity).toBeGreaterThanOrEqual(0);
            expect(opacity).toBeLessThanOrEqual(1);
          }
        }
      }
    });

    it('should have valid width and height', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          const widthMatch = content.match(/"width":\s*(\d+)/);
          const heightMatch = content.match(/"height":\s*(\d+)/);

          expect(widthMatch).toBeTruthy();
          expect(heightMatch).toBeTruthy();

          if (widthMatch && heightMatch) {
            const width = parseInt(widthMatch[1], 10);
            const height = parseInt(heightMatch[1], 10);

            expect(width).toBe(24);
            expect(height).toBe(24);
          }
        }
      }
    });
  });

  describe('Required Attributes', () => {
    it('should have id attribute', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          expect(content).toContain('"id":');

          const idMatch = content.match(/"id":\s*"([^"]+)"/);
          expect(idMatch).toBeTruthy();
          if (idMatch) {
            expect(idMatch[1].length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should have content attribute', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          expect(content).toContain('"content":');

          const contentMatch = content.match(/"content":\s*"((?:[^"\\]|\\\\.)*)"/);
          expect(contentMatch).toBeTruthy();
          if (contentMatch) {
            expect(contentMatch[1].length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should have viewBox attribute', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          expect(content).toContain('"viewBox":');

          const viewBoxMatch = content.match(/"viewBox":\s*"([^"]+)"/);
          expect(viewBoxMatch).toBeTruthy();
          if (viewBoxMatch) {
            expect(viewBoxMatch[1]).toBe('0 0 24 24');
          }
        }
      }
    });

    it('should have metadata object', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          expect(content).toContain('"metadata":');
          expect(content).toContain('"preset":');
          expect(content).toContain('"originalName":');
          expect(content).toContain('"elementsCount":');
        }
      }
    });
  });

  describe('Metadata Presence', () => {
    it('should have preset metadata', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 10)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          expect(content).toContain(`"preset": "${preset}"`);
        }
      }
    });

    it('should have originalName metadata', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 10)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          const originalNameMatch = content.match(/"originalName":\s*"([^"]+)"/);
          expect(originalNameMatch).toBeTruthy();
          if (originalNameMatch) {
            expect(originalNameMatch[1].length).toBeGreaterThan(0);
            expect(originalNameMatch[1]).toMatch(/Icon$/); // Should end with "Icon"
          }
        }
      }
    });

    it('should have elementsCount metadata', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 10)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          const elementsCountMatch = content.match(/"elementsCount":\s*(\d+)/);
          expect(elementsCountMatch).toBeTruthy();
          if (elementsCountMatch) {
            const count = parseInt(elementsCountMatch[1], 10);
            expect(count).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });

    it('should have hasOpacity and hasFill metadata', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 10)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          expect(content).toContain('"hasOpacity":');
          expect(content).toContain('"hasFill":');

          const hasOpacityMatch = content.match(/"hasOpacity":\s*(true|false)/);
          const hasFillMatch = content.match(/"hasFill":\s*(true|false)/);

          expect(hasOpacityMatch).toBeTruthy();
          expect(hasFillMatch).toBeTruthy();
        }
      }
    });
  });

  describe('ViewBox Consistency', () => {
    it('should use standard 24x24 viewBox', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 50)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          // Check definition viewBox
          expect(content).toContain('"viewBox": "0 0 24 24"');

          // Check SVG viewBox
          const svg = extractSVGContent(content);
          expect(svg).toContain('viewBox="0 0 24 24"');
        }

        console.log(`✓ ${preset}: All tested icons use 24x24 viewBox`);
      }
    });

    it('should have matching viewBox in definition and SVG', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          const viewBoxDefMatch = content.match(/"viewBox":\s*"([^"]+)"/);
          const svg = extractSVGContent(content);
          const viewBoxSvgMatch = svg.match(/viewBox=\\"([^"]+)\\"/);

          expect(viewBoxDefMatch).toBeTruthy();
          expect(viewBoxSvgMatch).toBeTruthy();

          if (viewBoxDefMatch && viewBoxSvgMatch) {
            expect(viewBoxDefMatch[1]).toBe(viewBoxSvgMatch[1]);
          }
        }
      }
    });
  });

  describe('SVG Namespace and Structure', () => {
    it('should have proper SVG xmlns', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        }
      }
    });

    it('should have fill="none" on root svg', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          // Root svg should have fill="none" (for stroke-based icons)
          const svgTagMatch = svg.match(/<svg[^>]*>/);
          if (svgTagMatch) {
            expect(svgTagMatch[0]).toContain('fill="none"');
          }
        }
      }
    });

    it('should have well-formed SVG structure', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          // Should start with <svg and end with </svg>
          expect(svg.trimStart()).toMatch(/^<svg/);
          expect(svg.trimEnd()).toMatch(/<\/svg>$/);

          // Should have matching opening and closing tags
          const openTags = svg.match(/<svg[^>]*>/g)?.length || 0;
          const closeTags = svg.match(/<\/svg>/g)?.length || 0;
          expect(openTags).toBe(closeTags);
        }
      }
    });
  });

  describe('Data Integrity', () => {
    it('should not have corrupted JSON', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 50)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          // Extract the JSON part
          const jsonMatch = content.match(/=\s*(\{[\s\S]*\});/);
          expect(jsonMatch).toBeTruthy();

          if (jsonMatch) {
            expect(() => JSON.parse(jsonMatch[1])).not.toThrow();
          }
        }
      }
    });

    it('should not have malformed escape sequences', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 50)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');

          // Check for common escape sequence issues
          expect(content).not.toContain('\\\\\\"'); // Triple escape
          expect(content).not.toContain('\\\\n'); // Double backslash-n
        }
      }
    });

    it('should have consistent quote escaping', () => {
      for (const preset of PRESETS) {
        const presetDir = join(ICONS_DIR, preset);
        const files = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

        if (files.length === 0) continue;

        for (const file of files.slice(0, 20)) {
          const content = readFileSync(join(presetDir, file), 'utf-8');
          const svg = extractSVGContent(content);

          // SVG content should use escaped quotes consistently
          expect(svg).not.toContain('"'); // Should not have unescaped quotes
        }
      }
    });
  });
});
