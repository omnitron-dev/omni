/**
 * Positioning Utilities Tests
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculatePosition,
  applyPosition,
  calculateArrowPosition,
} from '../../../../src/primitives/utils/position.js';

describe('Positioning Utilities', () => {
  let anchor: HTMLElement;
  let floating: HTMLElement;

  beforeEach(() => {
    // Mock viewport size
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768,
    });

    // Create anchor element
    anchor = document.createElement('div');
    anchor.style.position = 'absolute';
    anchor.style.top = '100px';
    anchor.style.left = '100px';
    anchor.style.width = '100px';
    anchor.style.height = '50px';
    document.body.appendChild(anchor);

    // Create floating element
    floating = document.createElement('div');
    floating.style.width = '200px';
    floating.style.height = '100px';
    document.body.appendChild(floating);

    // Mock getBoundingClientRect for anchor (positioned in viewport center)
    anchor.getBoundingClientRect = () => ({
      top: 300,
      left: 400,
      right: 500,
      bottom: 350,
      width: 100,
      height: 50,
      x: 400,
      y: 300,
      toJSON: () => ({}),
    });

    // Mock getBoundingClientRect for floating
    floating.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  describe('calculatePosition', () => {
    describe('Side positioning', () => {
      it('should position on bottom (default)', () => {
        const position = calculatePosition(anchor, floating);

        expect(position.side).toBe('bottom');
        expect(position.top).toBe(350); // anchor.bottom
        expect(position.align).toBe('center');
      });

      it('should position on top', () => {
        const position = calculatePosition(anchor, floating, { side: 'top' });

        expect(position.side).toBe('top');
        expect(position.top).toBe(200); // anchor.top - floating.height = 300 - 100
      });

      it('should position on right', () => {
        const position = calculatePosition(anchor, floating, { side: 'right' });

        expect(position.side).toBe('right');
        expect(position.left).toBe(500); // anchor.right
      });

      it('should position on left', () => {
        const position = calculatePosition(anchor, floating, { side: 'left' });

        expect(position.side).toBe('left');
        expect(position.left).toBe(200); // anchor.left - floating.width = 400 - 200
      });
    });

    describe('Alignment', () => {
      it('should align to center (default) on vertical axis', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'bottom',
          align: 'center',
        });

        // Center: anchor.left + anchor.width/2 - floating.width/2
        // = 400 + 50 - 100 = 350
        expect(position.left).toBe(350);
      });

      it('should align to start on vertical axis', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'bottom',
          align: 'start',
        });

        expect(position.left).toBe(400); // anchor.left
      });

      it('should align to end on vertical axis', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'bottom',
          align: 'end',
        });

        expect(position.left).toBe(300); // anchor.right - floating.width = 500 - 200
      });

      it('should align to center on horizontal axis', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'right',
          align: 'center',
        });

        // Center: anchor.top + anchor.height/2 - floating.height/2
        // = 300 + 25 - 50 = 275
        expect(position.top).toBe(275);
      });

      it('should align to start on horizontal axis', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'right',
          align: 'start',
        });

        expect(position.top).toBe(300); // anchor.top
      });

      it('should align to end on horizontal axis', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'right',
          align: 'end',
        });

        expect(position.top).toBe(250); // anchor.bottom - floating.height = 350 - 100
      });
    });

    describe('Offsets', () => {
      it('should apply side offset', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'bottom',
          sideOffset: 10,
        });

        expect(position.top).toBe(360); // anchor.bottom + 10 = 350 + 10
      });

      it('should apply align offset on vertical axis', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'bottom',
          align: 'center',
          alignOffset: 20,
        });

        expect(position.left).toBe(370); // center (350) + 20
      });

      it('should apply align offset on horizontal axis', () => {
        const position = calculatePosition(anchor, floating, {
          side: 'right',
          align: 'center',
          alignOffset: 15,
        });

        expect(position.top).toBe(290); // center (275) + 15
      });
    });

    describe('Collision detection', () => {
      it('should flip from top to bottom when colliding with viewport top', () => {
        // Anchor near top of viewport
        anchor.getBoundingClientRect = () => ({
          top: 5,
          left: 100,
          right: 200,
          bottom: 55,
          width: 100,
          height: 50,
          x: 100,
          y: 5,
          toJSON: () => ({}),
        });

        const position = calculatePosition(anchor, floating, {
          side: 'top',
          avoidCollisions: true,
        });

        expect(position.side).toBe('bottom'); // Flipped
        expect(position.top).toBe(55); // anchor.bottom
      });

      it('should flip from bottom to top when colliding with viewport bottom', () => {
        // Mock viewport height
        Object.defineProperty(window, 'innerHeight', {
          writable: true,
          configurable: true,
          value: 200,
        });

        // Anchor near bottom of viewport
        anchor.getBoundingClientRect = () => ({
          top: 180,
          left: 100,
          right: 200,
          bottom: 230,
          width: 100,
          height: 50,
          x: 100,
          y: 180,
          toJSON: () => ({}),
        });

        const position = calculatePosition(anchor, floating, {
          side: 'bottom',
          avoidCollisions: true,
        });

        expect(position.side).toBe('top'); // Flipped
        expect(position.top).toBe(80); // anchor.top - floating.height
      });

      it('should flip from left to right when colliding with viewport left', () => {
        // Anchor near left edge
        anchor.getBoundingClientRect = () => ({
          top: 100,
          left: 5,
          right: 105,
          bottom: 150,
          width: 100,
          height: 50,
          x: 5,
          y: 100,
          toJSON: () => ({}),
        });

        const position = calculatePosition(anchor, floating, {
          side: 'left',
          avoidCollisions: true,
        });

        expect(position.side).toBe('right'); // Flipped
        expect(position.left).toBe(105); // anchor.right
      });

      it('should flip from right to left when colliding with viewport right', () => {
        // Mock viewport width
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 300,
        });

        // Anchor near right edge
        anchor.getBoundingClientRect = () => ({
          top: 100,
          left: 280,
          right: 380,
          bottom: 150,
          width: 100,
          height: 50,
          x: 280,
          y: 100,
          toJSON: () => ({}),
        });

        const position = calculatePosition(anchor, floating, {
          side: 'right',
          avoidCollisions: true,
        });

        expect(position.side).toBe('left'); // Flipped
        expect(position.left).toBe(80); // anchor.left - floating.width
      });

      it('should constrain to viewport when shifting', () => {
        // Anchor that would cause floating to go beyond left edge
        anchor.getBoundingClientRect = () => ({
          top: 100,
          left: 5,
          right: 105,
          bottom: 150,
          width: 100,
          height: 50,
          x: 5,
          y: 100,
          toJSON: () => ({}),
        });

        const position = calculatePosition(anchor, floating, {
          side: 'bottom',
          align: 'start',
          avoidCollisions: true,
          collisionPadding: 10,
        });

        expect(position.left).toBe(10); // Constrained to padding
      });

      it('should respect collision padding', () => {
        anchor.getBoundingClientRect = () => ({
          top: 5,
          left: 100,
          right: 200,
          bottom: 55,
          width: 100,
          height: 50,
          x: 100,
          y: 5,
          toJSON: () => ({}),
        });

        const position = calculatePosition(anchor, floating, {
          side: 'top',
          avoidCollisions: true,
          collisionPadding: 20,
        });

        expect(position.side).toBe('bottom'); // Flipped due to padding
      });

      it('should not flip when avoidCollisions is false', () => {
        anchor.getBoundingClientRect = () => ({
          top: 5,
          left: 100,
          right: 200,
          bottom: 55,
          width: 100,
          height: 50,
          x: 100,
          y: 5,
          toJSON: () => ({}),
        });

        const position = calculatePosition(anchor, floating, {
          side: 'top',
          avoidCollisions: false,
        });

        expect(position.side).toBe('top'); // No flip
        expect(position.top).toBeLessThan(0); // Goes off screen
      });
    });
  });

  describe('applyPosition', () => {
    it('should apply position styles', () => {
      const element = document.createElement('div');

      applyPosition(element, {
        top: 100,
        left: 200,
        side: 'bottom',
        align: 'center',
      });

      expect(element.style.position).toBe('fixed');
      expect(element.style.top).toBe('100px');
      expect(element.style.left).toBe('200px');
      expect(element.style.margin).toBe('0px');
    });
  });

  describe('calculateArrowPosition', () => {
    beforeEach(() => {
      // Reset floating element position for arrow tests
      floating.getBoundingClientRect = () => ({
        top: 150,
        left: 50,
        right: 250,
        bottom: 250,
        width: 200,
        height: 100,
        x: 50,
        y: 150,
        toJSON: () => ({}),
      });
    });

    describe('Vertical sides (top/bottom)', () => {
      it('should position arrow at start alignment', () => {
        const position = calculateArrowPosition(anchor, floating, 'bottom', 'start');

        expect(position.left).toBe('50px'); // anchor.width / 2
        expect(position.top).toBe('-5px');
      });

      it('should position arrow at center alignment', () => {
        const position = calculateArrowPosition(anchor, floating, 'bottom', 'center');

        // anchorCenter = anchor.left + anchor.width/2 - floating.left
        // = 400 + 50 - 50 = 400
        // Constrained to Math.max(10, Math.min(floatingRect.width - 10, anchorCenter))
        // = Math.max(10, Math.min(190, 400)) = 190
        expect(position.left).toBe('190px');
        expect(position.top).toBe('-5px');
      });

      it('should position arrow at end alignment', () => {
        const position = calculateArrowPosition(anchor, floating, 'bottom', 'end');

        expect(position.right).toBe('50px'); // anchor.width / 2
        expect(position.top).toBe('-5px');
      });

      it('should position arrow on top side', () => {
        const position = calculateArrowPosition(anchor, floating, 'top', 'center');

        expect(position.bottom).toBe('-5px');
      });

      it('should constrain arrow position to min/max bounds', () => {
        // Floating element far from anchor
        floating.getBoundingClientRect = () => ({
          top: 150,
          left: 500,
          right: 700,
          bottom: 250,
          width: 200,
          height: 100,
          x: 500,
          y: 150,
          toJSON: () => ({}),
        });

        const position = calculateArrowPosition(anchor, floating, 'bottom', 'center');

        // anchorCenter would be negative: 400 + 50 - 500 = -50
        // Should be constrained to 10 (min)
        expect(position.left).toBe('10px');
      });
    });

    describe('Horizontal sides (left/right)', () => {
      it('should position arrow at start alignment', () => {
        const position = calculateArrowPosition(anchor, floating, 'right', 'start');

        expect(position.top).toBe('25px'); // anchor.height / 2
        expect(position.left).toBe('-5px');
      });

      it('should position arrow at center alignment', () => {
        const position = calculateArrowPosition(anchor, floating, 'right', 'center');

        // anchorCenter = anchor.top + anchor.height/2 - floating.top
        // = 300 + 25 - 150 = 175
        // Constrained to Math.max(10, Math.min(floatingRect.height - 10, anchorCenter))
        // = Math.max(10, Math.min(90, 175)) = 90
        expect(position.top).toBe('90px');
        expect(position.left).toBe('-5px');
      });

      it('should position arrow at end alignment', () => {
        const position = calculateArrowPosition(anchor, floating, 'right', 'end');

        expect(position.bottom).toBe('25px'); // anchor.height / 2
        expect(position.left).toBe('-5px');
      });

      it('should position arrow on left side', () => {
        const position = calculateArrowPosition(anchor, floating, 'left', 'center');

        expect(position.right).toBe('-5px');
      });
    });
  });
});
