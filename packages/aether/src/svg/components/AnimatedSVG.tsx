/**
 * AnimatedSVG Component
 *
 * Container component for SVG animations with timeline support,
 * multiple trigger types, and playback controls
 */

import { defineComponent, signal, effect, onCleanup, onMount, computed } from '../../index.js';
import type { Signal } from '../../index.js';
import { SVG, type SVGProps } from '../primitives/svg.js';
import type { AnimationConfig, TimelineConfig } from '../animations/types.js';
import { TimelineController } from '../animations/timeline.js';
import { SVGAnimator } from '../animations/spring.js';

/**
 * Animation trigger types
 */
export type AnimationTrigger = 'mount' | 'hover' | 'click' | 'scroll' | 'visible' | 'manual';

/**
 * AnimatedSVG component props
 */
export interface AnimatedSVGProps extends Omit<SVGProps, 'children'> {
  // Animation configuration
  animations?: AnimationConfig | AnimationConfig[];

  // Timeline
  timeline?: TimelineConfig;
  duration?: number | Signal<number>;
  delay?: number | Signal<number>;

  // Playback
  autoplay?: boolean;
  loop?: boolean | number;
  alternate?: boolean;
  paused?: Signal<boolean>;

  // Triggers
  trigger?: AnimationTrigger | Signal<boolean>;
  threshold?: number; // For scroll/visible triggers

  // Callbacks
  onStart?: () => void;
  onComplete?: () => void;
  onRepeat?: () => void;
  onUpdate?: (progress: number) => void;

  // Children
  children?: any;
}

/**
 * AnimatedSVG Component
 *
 * Provides animation capabilities for SVG elements with timeline support,
 * multiple trigger types, and full playback control.
 *
 * @example
 * ```tsx
 * // Basic animation on mount
 * <AnimatedSVG
 *   width={200}
 *   height={200}
 *   animations={{
 *     target: '#circle',
 *     property: 'r',
 *     from: 0,
 *     to: 50,
 *     duration: 1000
 *   }}
 *   trigger="mount"
 * >
 *   <circle id="circle" cx={100} cy={100} fill="blue" />
 * </AnimatedSVG>
 *
 * // Multiple animations with timeline
 * <AnimatedSVG
 *   width={200}
 *   height={200}
 *   timeline={{
 *     animations: [
 *       { target: '#circle', property: 'r', from: 0, to: 50, duration: 1000 },
 *       { target: '#rect', property: 'width', from: 0, to: 100, duration: 1000 }
 *     ],
 *     stagger: 200
 *   }}
 *   trigger="visible"
 *   loop
 * >
 *   <circle id="circle" cx={100} cy={100} />
 *   <rect id="rect" x={50} y={50} />
 * </AnimatedSVG>
 * ```
 */
export const AnimatedSVG = defineComponent<AnimatedSVGProps>((props) => {
  const svgRef = signal<SVGSVGElement | null>(null);
  const isPlaying = signal(false);
  const isHovered = signal(false);
  const isVisible = signal(false);
  const hasStarted = signal(false);
  const loopCount = signal(0);
  const timelineController = signal<TimelineController | null>(null);

  const _animator = new SVGAnimator();
  let animationControllers: any[] = [];

  // Resolve signal values
  const resolveValue = <T,>(value: T | Signal<T> | undefined): T | undefined => {
    if (value === undefined) return undefined;
    return typeof value === 'function' ? (value as Signal<T>)() : value;
  };

  // Check if trigger is manual (signal-based)
  const isManualTrigger = computed(() => typeof props.trigger === 'function');

  // Get current trigger value
  const currentTrigger = computed((): AnimationTrigger => {
    if (typeof props.trigger === 'function') {
      return 'manual';
    }
    return props.trigger || 'mount';
  });

  /**
   * Initialize timeline controller with animations
   */
  const initializeTimeline = () => {
    const controller = timelineController();
    if (controller) {
      controller.clear();
    }

    const timeline = new TimelineController({
      stagger: props.timeline?.stagger,
      overlap: props.timeline?.overlap,
    });

    // Add animations from timeline or animations prop
    const animations =
      props.timeline?.animations ||
      (props.animations ? (Array.isArray(props.animations) ? props.animations : [props.animations]) : []);

    animations.forEach((anim) => {
      timeline.add({
        ...anim,
        duration: anim.duration || resolveValue(props.duration) || 1000,
        delay: anim.delay || resolveValue(props.delay) || 0,
        onStart: () => {
          anim.onStart?.();
          if (!hasStarted()) {
            hasStarted.set(true);
            props.onStart?.();
          }
        },
        onComplete: () => {
          anim.onComplete?.();
        },
        onUpdate: (progress) => {
          anim.onUpdate?.(progress);
          props.onUpdate?.(progress);
        },
      });
    });

    timeline.then(() => handleComplete());
    timelineController.set(timeline);
  };

  /**
   * Start animation playback
   */
  const startAnimation = () => {
    if (!hasStarted()) {
      initializeTimeline();
      timelineController()?.play();
      isPlaying.set(true);
    }
  };

  /**
   * Stop animation
   */
  const stopAnimation = () => {
    timelineController()?.stop();
    animationControllers.forEach((c) => c.stop());
    animationControllers = [];
    isPlaying.set(false);
    hasStarted.set(false);
    loopCount.set(0);
  };

  /**
   * Handle animation completion
   */
  const handleComplete = () => {
    const maxLoops = typeof props.loop === 'number' ? props.loop : Infinity;
    const shouldLoop = props.loop && loopCount() < maxLoops - 1;

    if (shouldLoop) {
      loopCount.set(loopCount() + 1);
      props.onRepeat?.();

      if (props.alternate) {
        timelineController()?.reverse();
      }

      timelineController()?.play();
    } else {
      props.onComplete?.();
      isPlaying.set(false);
      hasStarted.set(false);
    }
  };

  /**
   * Handle mount trigger
   */
  onMount(() => {
    if (currentTrigger() === 'mount' && props.autoplay !== false) {
      startAnimation();
    }
  });

  /**
   * Setup IntersectionObserver for 'visible' trigger
   */
  onMount(() => {
    const svg = svgRef();
    if (currentTrigger() === 'visible' && svg && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !hasStarted()) {
            isVisible.set(true);
            startAnimation();
            observer.disconnect();
          }
        },
        { threshold: props.threshold ?? 0.1 }
      );

      observer.observe(svg);
      onCleanup(() => observer.disconnect());
    }
  });

  /**
   * Handle scroll trigger
   */
  onMount(() => {
    const svg = svgRef();
    if (currentTrigger() === 'scroll' && svg && typeof window !== 'undefined') {
      const handleScroll = () => {
        const rect = svg.getBoundingClientRect();
        const threshold = props.threshold ?? 0.5;
        const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        const visibleRatio = visibleHeight / rect.height;

        if (visibleRatio >= threshold && !hasStarted()) {
          startAnimation();
        }
      };

      window.addEventListener('scroll', handleScroll, { passive: true });
      handleScroll();
      onCleanup(() => window.removeEventListener('scroll', handleScroll));
    }
  });

  /**
   * Handle manual trigger (signal)
   */
  effect(() => {
    if (isManualTrigger() && typeof props.trigger === 'function') {
      const shouldPlay = (props.trigger as Signal<boolean>)();
      if (shouldPlay && !hasStarted()) {
        startAnimation();
      } else if (!shouldPlay && hasStarted()) {
        stopAnimation();
      }
    }
  });

  /**
   * Handle paused state
   */
  effect(() => {
    const isPaused = resolveValue(props.paused);
    const controller = timelineController();
    if (controller && isPaused !== undefined && hasStarted()) {
      if (isPaused) {
        controller.pause();
        isPlaying.set(false);
      } else {
        controller.play();
        isPlaying.set(true);
      }
    }
  });

  /**
   * Handle click trigger
   */
  const handleClick = (e: MouseEvent) => {
    if (currentTrigger() === 'click') {
      if (hasStarted()) {
        stopAnimation();
      } else {
        startAnimation();
      }
    }
    props.onClick?.(e);
  };

  /**
   * Handle hover trigger
   */
  const handleMouseEnter = () => {
    isHovered.set(true);
    if (currentTrigger() === 'hover' && !hasStarted()) {
      startAnimation();
    }
  };

  const handleMouseLeave = () => {
    isHovered.set(false);
    if (currentTrigger() === 'hover' && hasStarted()) {
      stopAnimation();
    }
  };

  // Cleanup on unmount
  onCleanup(() => {
    stopAnimation();
    timelineController.set(null);
  });

  return () =>
    SVG({
      ...props,
      ref: (el: SVGSVGElement | null) => {
        if (el) svgRef.set(el);
      },
      onClick: handleClick,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      children: props.children,
    });
}, 'AnimatedSVG');
