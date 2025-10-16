/**
 * Theme Tests
 * Validate all theme configurations and contrast ratios
 */

import { describe, it, expect } from 'vitest';
import {
  defaultTheme,
  minimalTheme,
  githubTheme,
  darkTheme,
  highContrastTheme,
  allThemes,
} from '../../../../src/components/editor/theming/presets';
import type { Theme } from '../../../../src/components/editor/theming/types';

/**
 * Calculate relative luminance
 */
function getLuminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Parse color to RGB
 */
function parseColor(color: string): [number, number, number] | null {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b];
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r, g, b];
    }
  }

  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1], 10),
      parseInt(rgbMatch[2], 10),
      parseInt(rgbMatch[3], 10),
    ];
  }

  return null;
}

/**
 * Calculate contrast ratio
 */
function calculateContrast(color1: string, color2: string): number {
  const lum1 = getLuminance(color1);
  const lum2 = getLuminance(color2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

describe('Theme Presets', () => {
  describe('Theme Structure', () => {
    it.each(allThemes)('$metadata.name should have complete structure', (theme) => {
      // Metadata
      expect(theme.metadata).toBeDefined();
      expect(theme.metadata.name).toBeTruthy();
      expect(theme.metadata.displayName).toBeTruthy();
      expect(theme.metadata.author).toBeTruthy();
      expect(theme.metadata.version).toBeTruthy();
      expect(theme.metadata.description).toBeTruthy();
      expect(typeof theme.metadata.isDark).toBe('boolean');
      expect(typeof theme.metadata.isHighContrast).toBe('boolean');

      // Colors
      expect(theme.colors).toBeDefined();
      expect(theme.colors.primary).toBeTruthy();
      expect(theme.colors.background).toBeTruthy();
      expect(theme.colors.text).toBeTruthy();
      expect(theme.colors.border).toBeTruthy();

      // Typography
      expect(theme.typography).toBeDefined();
      expect(theme.typography.fontFamily).toBeTruthy();
      expect(theme.typography.fontFamilyMono).toBeTruthy();

      // Spacing
      expect(theme.spacing).toBeDefined();
      expect(theme.spacing.xs).toBeTruthy();
      expect(theme.spacing.sm).toBeTruthy();
      expect(theme.spacing.md).toBeTruthy();

      // Border radius
      expect(theme.borderRadius).toBeDefined();

      // Shadows
      expect(theme.shadows).toBeDefined();

      // Z-index
      expect(theme.zIndex).toBeDefined();

      // Animation
      expect(theme.animation).toBeDefined();

      // Breakpoints
      expect(theme.breakpoints).toBeDefined();
    });
  });

  describe('WCAG AA Contrast Requirements', () => {
    describe('Default Theme', () => {
      it('should meet AA contrast for body text', () => {
        const contrast = calculateContrast(
          defaultTheme.colors.text,
          defaultTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('should meet AA contrast for text on surface', () => {
        const contrast = calculateContrast(
          defaultTheme.colors.text,
          defaultTheme.colors.surface
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('should meet AA contrast for primary color', () => {
        const contrast = calculateContrast(
          defaultTheme.colors.primary,
          defaultTheme.colors.surface
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('should meet AA contrast for links', () => {
        const contrast = calculateContrast(
          defaultTheme.colors.primary,
          defaultTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });
    });

    describe('Minimal Theme', () => {
      it('should meet AAA contrast for body text', () => {
        const contrast = calculateContrast(
          minimalTheme.colors.text,
          minimalTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(7);
      });

      it('should meet AA contrast for secondary text', () => {
        const contrast = calculateContrast(
          minimalTheme.colors.textSecondary,
          minimalTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });
    });

    describe('GitHub Theme', () => {
      it('should meet AA contrast for body text', () => {
        const contrast = calculateContrast(
          githubTheme.colors.text,
          githubTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('should meet AA contrast for secondary text', () => {
        const contrast = calculateContrast(
          githubTheme.colors.textSecondary,
          githubTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('should meet AA contrast for primary color', () => {
        const contrast = calculateContrast(
          githubTheme.colors.primary,
          githubTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });
    });

    describe('Dark Theme', () => {
      it('should meet AA contrast for body text', () => {
        const contrast = calculateContrast(
          darkTheme.colors.text,
          darkTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('should meet AA contrast for text on surface', () => {
        const contrast = calculateContrast(
          darkTheme.colors.text,
          darkTheme.colors.surface
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('should meet AA contrast for primary color', () => {
        const contrast = calculateContrast(
          darkTheme.colors.primary,
          darkTheme.colors.surface
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('should meet AA contrast for secondary text', () => {
        const contrast = calculateContrast(
          darkTheme.colors.textSecondary,
          darkTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });
    });

    describe('High Contrast Theme', () => {
      it('should meet AAA contrast for all text', () => {
        const contrast = calculateContrast(
          highContrastTheme.colors.text,
          highContrastTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(7);
      });

      it('should meet AAA contrast for primary color', () => {
        const contrast = calculateContrast(
          highContrastTheme.colors.primary,
          highContrastTheme.colors.background
        );
        expect(contrast).toBeGreaterThanOrEqual(7);
      });

      it('should meet high contrast for selection', () => {
        const contrast = calculateContrast(
          highContrastTheme.colors.selection,
          highContrastTheme.colors.selectionBg
        );
        expect(contrast).toBeGreaterThanOrEqual(7);
      });
    });
  });

  describe('Semantic Colors', () => {
    it.each(allThemes)('$metadata.name should have semantic colors', (theme) => {
      expect(theme.colors.success).toBeTruthy();
      expect(theme.colors.successBg).toBeTruthy();
      expect(theme.colors.warning).toBeTruthy();
      expect(theme.colors.warningBg).toBeTruthy();
      expect(theme.colors.error).toBeTruthy();
      expect(theme.colors.errorBg).toBeTruthy();
      expect(theme.colors.info).toBeTruthy();
      expect(theme.colors.infoBg).toBeTruthy();
    });

    it.each(allThemes)('$metadata.name semantic colors should meet AA contrast', (theme) => {
      const successContrast = calculateContrast(theme.colors.success, theme.colors.successBg);
      const warningContrast = calculateContrast(theme.colors.warning, theme.colors.warningBg);
      const errorContrast = calculateContrast(theme.colors.error, theme.colors.errorBg);
      const infoContrast = calculateContrast(theme.colors.info, theme.colors.infoBg);

      expect(successContrast).toBeGreaterThanOrEqual(3); // Large text requirement
      expect(warningContrast).toBeGreaterThanOrEqual(3);
      expect(errorContrast).toBeGreaterThanOrEqual(3);
      expect(infoContrast).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Code Syntax Highlighting', () => {
    it.each(allThemes)('$metadata.name should have code colors', (theme) => {
      expect(theme.colors.codeBackground).toBeTruthy();
      expect(theme.colors.codeBorder).toBeTruthy();
      expect(theme.colors.codeText).toBeTruthy();
      expect(theme.colors.codeKeyword).toBeTruthy();
      expect(theme.colors.codeString).toBeTruthy();
      expect(theme.colors.codeComment).toBeTruthy();
      expect(theme.colors.codeNumber).toBeTruthy();
      expect(theme.colors.codeOperator).toBeTruthy();
    });

    it.each(allThemes)('$metadata.name code text should be readable', (theme) => {
      const contrast = calculateContrast(
        theme.colors.codeText,
        theme.colors.codeBackground
      );
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('Typography', () => {
    it.each(allThemes)('$metadata.name should have complete typography', (theme) => {
      // Font families
      expect(theme.typography.fontFamily).toBeTruthy();
      expect(theme.typography.fontFamilyMono).toBeTruthy();
      expect(theme.typography.fontFamilyHeading).toBeTruthy();

      // Font sizes
      expect(theme.typography.fontSizeXs).toBeTruthy();
      expect(theme.typography.fontSizeSm).toBeTruthy();
      expect(theme.typography.fontSizeBase).toBeTruthy();
      expect(theme.typography.fontSizeLg).toBeTruthy();

      // Font weights
      expect(theme.typography.fontWeightNormal).toBeTruthy();
      expect(theme.typography.fontWeightBold).toBeTruthy();

      // Line heights
      expect(theme.typography.lineHeightTight).toBeTruthy();
      expect(theme.typography.lineHeightBase).toBeTruthy();
      expect(theme.typography.lineHeightRelaxed).toBeTruthy();
    });
  });

  describe('Animation', () => {
    it.each(allThemes)('$metadata.name should have animation settings', (theme) => {
      expect(theme.animation.durationFast).toBeTruthy();
      expect(theme.animation.durationBase).toBeTruthy();
      expect(theme.animation.durationSlow).toBeTruthy();
      expect(theme.animation.easingLinear).toBeTruthy();
      expect(theme.animation.easingIn).toBeTruthy();
      expect(theme.animation.easingOut).toBeTruthy();
    });

    it('high contrast theme should have no animations', () => {
      expect(highContrastTheme.animation.durationFast).toBe('0ms');
      expect(highContrastTheme.animation.durationBase).toBe('0ms');
      expect(highContrastTheme.animation.durationSlow).toBe('0ms');
    });
  });

  describe('Z-Index Scale', () => {
    it.each(allThemes)('$metadata.name should have proper z-index layering', (theme) => {
      expect(theme.zIndex.base).toBeLessThan(theme.zIndex.dropdown);
      expect(theme.zIndex.dropdown).toBeLessThan(theme.zIndex.sticky);
      expect(theme.zIndex.sticky).toBeLessThan(theme.zIndex.fixed);
      expect(theme.zIndex.fixed).toBeLessThan(theme.zIndex.modal);
      expect(theme.zIndex.modal).toBeLessThan(theme.zIndex.popover);
      expect(theme.zIndex.popover).toBeLessThan(theme.zIndex.tooltip);
      expect(theme.zIndex.tooltip).toBeLessThan(theme.zIndex.toast);
    });
  });

  describe('Theme Metadata', () => {
    it('should have unique theme names', () => {
      const names = allThemes.map(t => t.metadata.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should properly identify dark themes', () => {
      expect(defaultTheme.metadata.isDark).toBe(false);
      expect(minimalTheme.metadata.isDark).toBe(false);
      expect(githubTheme.metadata.isDark).toBe(false);
      expect(darkTheme.metadata.isDark).toBe(true);
      expect(highContrastTheme.metadata.isDark).toBe(false);
    });

    it('should properly identify high contrast themes', () => {
      expect(defaultTheme.metadata.isHighContrast).toBe(false);
      expect(minimalTheme.metadata.isHighContrast).toBe(false);
      expect(githubTheme.metadata.isHighContrast).toBe(false);
      expect(darkTheme.metadata.isHighContrast).toBe(false);
      expect(highContrastTheme.metadata.isHighContrast).toBe(true);
    });
  });

  describe('Color Consistency', () => {
    it.each(allThemes)('$metadata.name should have consistent hover states', (theme) => {
      // Surface hover should be different from surface
      expect(theme.colors.surfaceHover).not.toBe(theme.colors.surface);

      // Border hover should be different from border
      expect(theme.colors.borderHover).not.toBe(theme.colors.border);
    });

    it.each(allThemes)('$metadata.name text colors should be distinguishable', (theme) => {
      expect(theme.colors.text).not.toBe(theme.colors.textSecondary);
      expect(theme.colors.textSecondary).not.toBe(theme.colors.textTertiary);
    });
  });

  describe('Spacing Scale', () => {
    it.each(allThemes)('$metadata.name should have progressive spacing', (theme) => {
      const spacingValues = [
        parseFloat(theme.spacing.xs),
        parseFloat(theme.spacing.sm),
        parseFloat(theme.spacing.md),
        parseFloat(theme.spacing.lg),
        parseFloat(theme.spacing.xl),
      ];

      for (let i = 1; i < spacingValues.length; i++) {
        expect(spacingValues[i]).toBeGreaterThan(spacingValues[i - 1]);
      }
    });
  });

  describe('Border Radius', () => {
    it('minimal theme should have minimal border radius', () => {
      expect(minimalTheme.borderRadius.sm).toBe('0');
      expect(minimalTheme.borderRadius.base).toBe('0');
    });

    it('high contrast theme should have no border radius', () => {
      expect(highContrastTheme.borderRadius.sm).toBe('0');
      expect(highContrastTheme.borderRadius.base).toBe('0');
      expect(highContrastTheme.borderRadius.md).toBe('0');
      expect(highContrastTheme.borderRadius.lg).toBe('0');
    });
  });
});
