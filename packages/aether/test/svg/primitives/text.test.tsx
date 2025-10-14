/**
 * Tests for SVG Text Primitives
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Text, TSpan, TextPath } from '../../../src/svg/primitives/text';
import { signal } from '../../../src/core/reactivity/signal';
import { render, cleanup, waitFor } from '../../test-utils';

describe('SVG Text Primitives', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Text', () => {
    it('should render basic text element', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>Hello World</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text).toBeTruthy();
      expect(text?.getAttribute('x')).toBe('10');
      expect(text?.getAttribute('y')).toBe('20');
      expect(text?.textContent).toBe('Hello World');
    });

    it('should support string coordinates', () => {
      const { container } = render(() => (
        <svg>
          <Text x="50%" y="50%">Centered</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('x')).toBe('50%');
      expect(text?.getAttribute('y')).toBe('50%');
    });

    it('should support reactive coordinates', async () => {
      const x = signal(10);
      const y = signal(20);

      const { container } = render(() => (
        <svg>
          <Text x={x} y={y}>Moving Text</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('x')).toBe('10');
      expect(text?.getAttribute('y')).toBe('20');

      x.set(50);
      y.set(100);

      await waitFor(() => {
        expect(text?.getAttribute('x')).toBe('50');
        expect(text?.getAttribute('y')).toBe('100');
      });
    });

    it('should apply dx and dy offsets', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} dx={5} dy={10}>Offset Text</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('dx')).toBe('5');
      expect(text?.getAttribute('dy')).toBe('10');
    });

    it('should support reactive offsets', async () => {
      const dx = signal(0);

      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} dx={dx}>Text</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('dx')).toBe('0');

      dx.set(15);

      await waitFor(() => {
        expect(text?.getAttribute('dx')).toBe('15');
      });
    });

    it('should apply rotate attribute', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} rotate="45">Rotated Text</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('rotate')).toBe('45');
    });

    it('should apply multiple rotation values', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} rotate="10 20 30 40">Each Letter Rotated</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('rotate')).toBe('10 20 30 40');
    });

    it('should support reactive rotate', async () => {
      const rotate = signal('0');

      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} rotate={rotate}>Text</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('rotate')).toBe('0');

      rotate.set('45');

      await waitFor(() => {
        expect(text?.getAttribute('rotate')).toBe('45');
      });
    });

    it('should apply textLength', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} textLength={200}>Stretched Text</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('textLength')).toBe('200');
    });

    it('should apply lengthAdjust', () => {
      const adjustMethods: Array<'spacing' | 'spacingAndGlyphs'> = [
        'spacing',
        'spacingAndGlyphs'
      ];

      adjustMethods.forEach((method) => {
        const { container } = render(() => (
          <svg>
            <Text x={10} y={20} textLength={200} lengthAdjust={method}>
              Text
            </Text>
          </svg>
        ));

        const text = container.querySelector('text');
        expect(text?.getAttribute('lengthAdjust')).toBe(method);
        cleanup();
      });
    });

    it('should support reactive textLength', async () => {
      const length = signal(100);

      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} textLength={length}>Text</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('textLength')).toBe('100');

      length.set(200);

      await waitFor(() => {
        expect(text?.getAttribute('textLength')).toBe('200');
      });
    });

    it('should apply styling attributes', () => {
      const { container } = render(() => (
        <svg>
          <Text
            x={10}
            y={20}
            fill="red"
            fontSize="20"
            fontFamily="Arial"
            fontWeight="bold"
          >
            Styled Text
          </Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('fill')).toBe('red');
      expect(text?.getAttribute('font-size')).toBe('20');
      expect(text?.getAttribute('font-family')).toBe('Arial');
      expect(text?.getAttribute('font-weight')).toBe('bold');
    });

    it('should render nested children', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            Plain text
            <TSpan fill="red">Red text</TSpan>
            more plain text
          </Text>
        </svg>
      ));

      const text = container.querySelector('text');
      const tspan = text?.querySelector('tspan');

      expect(text).toBeTruthy();
      expect(tspan).toBeTruthy();
      expect(tspan?.getAttribute('fill')).toBe('red');
    });
  });

  describe('TSpan', () => {
    it('should render basic tspan element', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            Text with <TSpan fill="blue">colored</TSpan> span
          </Text>
        </svg>
      ));

      const tspan = container.querySelector('tspan');
      expect(tspan).toBeTruthy();
      expect(tspan?.getAttribute('fill')).toBe('blue');
      expect(tspan?.textContent).toBe('colored');
    });

    it('should apply position attributes', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            <TSpan x={50} y={30}>Positioned Span</TSpan>
          </Text>
        </svg>
      ));

      const tspan = container.querySelector('tspan');
      expect(tspan?.getAttribute('x')).toBe('50');
      expect(tspan?.getAttribute('y')).toBe('30');
    });

    it('should apply offset attributes', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            <TSpan dx={5} dy={10}>Offset Span</TSpan>
          </Text>
        </svg>
      ));

      const tspan = container.querySelector('tspan');
      expect(tspan?.getAttribute('dx')).toBe('5');
      expect(tspan?.getAttribute('dy')).toBe('10');
    });

    it('should support reactive attributes', async () => {
      const x = signal(10);
      const fill = signal('red');

      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            <TSpan x={x} fill={fill}>Reactive Span</TSpan>
          </Text>
        </svg>
      ));

      const tspan = container.querySelector('tspan');
      expect(tspan?.getAttribute('x')).toBe('10');
      expect(tspan?.getAttribute('fill')).toBe('red');

      x.set(30);
      fill.set('blue');

      await waitFor(() => {
        expect(tspan?.getAttribute('x')).toBe('30');
        expect(tspan?.getAttribute('fill')).toBe('blue');
      });
    });

    it('should nest multiple tspans', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            Line 1
            <TSpan x={10} dy={20}>Line 2</TSpan>
            <TSpan x={10} dy={20}>Line 3</TSpan>
          </Text>
        </svg>
      ));

      const tspans = container.querySelectorAll('tspan');
      expect(tspans.length).toBe(2);
      expect(tspans[0]?.getAttribute('dy')).toBe('20');
      expect(tspans[1]?.getAttribute('dy')).toBe('20');
    });

    it('should apply textLength and lengthAdjust', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            <TSpan textLength={100} lengthAdjust="spacing">
              Adjusted Span
            </TSpan>
          </Text>
        </svg>
      ));

      const tspan = container.querySelector('tspan');
      expect(tspan?.getAttribute('textLength')).toBe('100');
      expect(tspan?.getAttribute('lengthAdjust')).toBe('spacing');
    });

    it('should apply rotate attribute', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            <TSpan rotate="10 20 30">ABC</TSpan>
          </Text>
        </svg>
      ));

      const tspan = container.querySelector('tspan');
      expect(tspan?.getAttribute('rotate')).toBe('10 20 30');
    });
  });

  describe('TextPath', () => {
    it('should render basic textPath element', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <path id="curve" d="M10 80 Q 95 10 180 80" />
          </defs>
          <Text>
            <TextPath href="#curve">Text along a path</TextPath>
          </Text>
        </svg>
      ));

      const textPath = container.querySelector('textPath');
      expect(textPath).toBeTruthy();
      expect(textPath?.getAttribute('href')).toBe('#curve');
      expect(textPath?.textContent).toBe('Text along a path');
    });

    it('should apply startOffset', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <path id="curve2" d="M10 80 Q 95 10 180 80" />
          </defs>
          <Text>
            <TextPath href="#curve2" startOffset="25%">
              Offset Text
            </TextPath>
          </Text>
        </svg>
      ));

      const textPath = container.querySelector('textPath');
      expect(textPath?.getAttribute('startOffset')).toBe('25%');
    });

    it('should support numeric startOffset', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <path id="curve3" d="M10 80 Q 95 10 180 80" />
          </defs>
          <Text>
            <TextPath href="#curve3" startOffset={50}>
              Offset Text
            </TextPath>
          </Text>
        </svg>
      ));

      const textPath = container.querySelector('textPath');
      expect(textPath?.getAttribute('startOffset')).toBe('50');
    });

    it('should support reactive startOffset', async () => {
      const offset = signal(0);

      const { container } = render(() => (
        <svg>
          <defs>
            <path id="curve4" d="M10 80 Q 95 10 180 80" />
          </defs>
          <Text>
            <TextPath href="#curve4" startOffset={offset}>
              Moving Text
            </TextPath>
          </Text>
        </svg>
      ));

      const textPath = container.querySelector('textPath');
      expect(textPath?.getAttribute('startOffset')).toBe('0');

      offset.set(50);

      await waitFor(() => {
        expect(textPath?.getAttribute('startOffset')).toBe('50');
      });
    });

    it('should apply method attribute', () => {
      const methods: Array<'align' | 'stretch'> = ['align', 'stretch'];

      methods.forEach((method) => {
        const { container } = render(() => (
          <svg>
            <defs>
              <path id={`curve-${method}`} d="M10 80 Q 95 10 180 80" />
            </defs>
            <Text>
              <TextPath href={`#curve-${method}`} method={method}>
                Text
              </TextPath>
            </Text>
          </svg>
        ));

        const textPath = container.querySelector('textPath');
        expect(textPath?.getAttribute('method')).toBe(method);
        cleanup();
      });
    });

    it('should apply spacing attribute', () => {
      const spacingMethods: Array<'auto' | 'exact'> = ['auto', 'exact'];

      spacingMethods.forEach((spacing) => {
        const { container } = render(() => (
          <svg>
            <defs>
              <path id={`curve-${spacing}`} d="M10 80 Q 95 10 180 80" />
            </defs>
            <Text>
              <TextPath href={`#curve-${spacing}`} spacing={spacing}>
                Text
              </TextPath>
            </Text>
          </svg>
        ));

        const textPath = container.querySelector('textPath');
        expect(textPath?.getAttribute('spacing')).toBe(spacing);
        cleanup();
      });
    });

    it('should render children text', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <path id="curve5" d="M10 80 Q 95 10 180 80" />
          </defs>
          <Text>
            <TextPath href="#curve5">
              This is a very long text that follows the curve path
            </TextPath>
          </Text>
        </svg>
      ));

      const textPath = container.querySelector('textPath');
      expect(textPath?.textContent).toContain('very long text');
    });

    it('should work with TSpan children', () => {
      const { container } = render(() => (
        <svg>
          <defs>
            <path id="curve6" d="M10 80 Q 95 10 180 80" />
          </defs>
          <Text>
            <TextPath href="#curve6">
              Normal text <TSpan fill="red">colored text</TSpan> more normal
            </TextPath>
          </Text>
        </svg>
      ));

      const textPath = container.querySelector('textPath');
      const tspan = textPath?.querySelector('tspan');

      expect(tspan).toBeTruthy();
      expect(tspan?.getAttribute('fill')).toBe('red');
    });
  });

  describe('Complex Text Scenarios', () => {
    it('should render multi-line text with tspans', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            Line 1
            <TSpan x={10} dy={20}>Line 2</TSpan>
            <TSpan x={10} dy={20}>Line 3</TSpan>
            <TSpan x={10} dy={20}>Line 4</TSpan>
          </Text>
        </svg>
      ));

      const tspans = container.querySelectorAll('tspan');
      expect(tspans.length).toBe(3);
    });

    it('should render styled text with multiple tspans', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} fontSize="16">
            This is{' '}
            <TSpan fontWeight="bold">bold</TSpan>
            {' '}and{' '}
            <TSpan fontStyle="italic">italic</TSpan>
            {' '}text
          </Text>
        </svg>
      ));

      const tspans = container.querySelectorAll('tspan');
      expect(tspans.length).toBe(2);
      expect(tspans[0]?.getAttribute('font-weight')).toBe('bold');
      expect(tspans[1]?.getAttribute('font-style')).toBe('italic');
    });

    it('should render text with different colors', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            <TSpan fill="red">Red</TSpan>
            <TSpan fill="green">Green</TSpan>
            <TSpan fill="blue">Blue</TSpan>
          </Text>
        </svg>
      ));

      const tspans = container.querySelectorAll('tspan');
      expect(tspans[0]?.getAttribute('fill')).toBe('red');
      expect(tspans[1]?.getAttribute('fill')).toBe('green');
      expect(tspans[2]?.getAttribute('fill')).toBe('blue');
    });

    it('should handle nested tspans with different positioning', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>
            Base text
            <TSpan dx={5} dy={5}>
              Offset 1
              <TSpan dx={10} dy={10}>Nested Offset</TSpan>
            </TSpan>
          </Text>
        </svg>
      ));

      const text = container.querySelector('text');
      const tspans = text?.querySelectorAll('tspan');
      expect(tspans?.length).toBeGreaterThanOrEqual(2);
    });

    it('should render vertically aligned text', () => {
      const { container } = render(() => (
        <svg>
          <Text x={50} y={20} textAnchor="middle">
            Title
            <TSpan x={50} dy={30}>Subtitle</TSpan>
            <TSpan x={50} dy={20} fontSize="12">Description</TSpan>
          </Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('text-anchor')).toBe('middle');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} />
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text).toBeTruthy();
    });

    it('should handle text with only whitespace', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>   </Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text).toBeTruthy();
    });

    it('should handle undefined coordinates', () => {
      const { container } = render(() => (
        <svg>
          <Text>Text without coordinates</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text).toBeTruthy();
    });

    it('should handle very long text', () => {
      const longText = 'a'.repeat(10000);
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>{longText}</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.textContent).toBe(longText);
    });

    it('should handle special characters', () => {
      const specialChars = '< > & " \' \n \t';
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>{specialChars}</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text).toBeTruthy();
    });

    it('should handle unicode characters', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20}>🎨 Hello 世界 مرحبا שָׁלוֹם</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.textContent).toContain('🎨');
      expect(text?.textContent).toContain('世界');
    });

    it('should handle negative coordinates', () => {
      const { container } = render(() => (
        <svg>
          <Text x={-10} y={-20}>Negative Position</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('x')).toBe('-10');
      expect(text?.getAttribute('y')).toBe('-20');
    });

    it('should handle zero coordinates', () => {
      const { container } = render(() => (
        <svg>
          <Text x={0} y={0}>Origin</Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('x')).toBe('0');
      expect(text?.getAttribute('y')).toBe('0');
    });
  });

  describe('Accessibility', () => {
    it('should render with aria-label', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} aria-label="Important text">
            Visual Text
          </Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('aria-label')).toBe('Important text');
    });

    it('should render with role', () => {
      const { container } = render(() => (
        <svg>
          <Text x={10} y={20} role="heading">
            Heading Text
          </Text>
        </svg>
      ));

      const text = container.querySelector('text');
      expect(text?.getAttribute('role')).toBe('heading');
    });

    it('should apply text-anchor for alignment', () => {
      const anchors: Array<'start' | 'middle' | 'end'> = ['start', 'middle', 'end'];

      anchors.forEach((anchor) => {
        const { container } = render(() => (
          <svg>
            <Text x={50} y={20} textAnchor={anchor}>
              {anchor} aligned
            </Text>
          </svg>
        ));

        const text = container.querySelector('text');
        expect(text?.getAttribute('text-anchor')).toBe(anchor);
        cleanup();
      });
    });
  });
});
