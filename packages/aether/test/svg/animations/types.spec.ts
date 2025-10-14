/**
 * Animation Types Tests
 */

import { describe, it, expect } from 'vitest';
import type {
  AnimationConfig,
  TimelineConfig,
  SpringConfig,
  SMILAnimationProps,
  CSSAnimationConfig,
  JSAnimationConfig,
} from '../../../src/svg/animations/types.js';

describe('Animation Types', () => {
  it('should define AnimationConfig interface', () => {
    const config: AnimationConfig = {
      target: '#element',
      property: 'opacity',
      from: 0,
      to: 1,
      duration: 1000,
      delay: 0,
      easing: 'ease-in-out',
      type: 'css',
    };

    expect(config).toBeDefined();
    expect(config.target).toBe('#element');
    expect(config.property).toBe('opacity');
  });

  it('should define TimelineConfig interface', () => {
    const config: TimelineConfig = {
      animations: [
        { property: 'x', from: 0, to: 100, duration: 1000 },
        { property: 'y', from: 0, to: 100, duration: 1000 },
      ],
      duration: 2000,
      stagger: 100,
      overlap: 50,
    };

    expect(config).toBeDefined();
    expect(config.animations).toHaveLength(2);
  });

  it('should define SpringConfig interface', () => {
    const config: SpringConfig = {
      stiffness: 100,
      damping: 10,
      mass: 1,
      velocity: 0,
    };

    expect(config).toBeDefined();
    expect(config.stiffness).toBe(100);
  });

  it('should define SMIL animation props', () => {
    const props: SMILAnimationProps = {
      attributeName: 'opacity',
      from: '0',
      to: '1',
      dur: '1s',
      repeatCount: 'indefinite',
      fill: 'freeze',
    };

    expect(props).toBeDefined();
    expect(props.attributeName).toBe('opacity');
  });

  it('should define CSS animation config', () => {
    const config: CSSAnimationConfig = {
      keyframes: {
        '0%': { opacity: 0 },
        '100%': { opacity: 1 },
      },
      duration: 1000,
      iterationCount: 'infinite',
    };

    expect(config).toBeDefined();
    expect(config.keyframes).toBeDefined();
  });

  it('should define JS animation config', () => {
    const config: JSAnimationConfig = {
      target: document.createElement('div'),
      props: {
        opacity: { from: 0, to: 1 },
      },
      duration: 1000,
      easing: 'ease-in-out',
    };

    expect(config).toBeDefined();
    expect(config.props.opacity).toBeDefined();
  });
});
