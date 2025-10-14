/**
 * Path Animations
 *
 * Utilities for animating SVG paths - morphing, drawing, and motion
 */

import type { EasingFunction } from './types.js';

/**
 * Get the total length of an SVG path
 */
export function getPathLength(path: string | SVGPathElement): number {
  // Handle null/undefined
  if (!path) return 0;

  if (typeof path === 'string') {
    // Create temporary path element to calculate length
    if (typeof document === 'undefined') return 0;
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', path);
    const length = tempPath.getTotalLength();
    return length;
  }
  return path.getTotalLength();
}

/**
 * Get point at a specific length along the path
 */
export function getPointAtLength(
  path: string | SVGPathElement,
  length: number
): { x: number; y: number } {
  if (typeof path === 'string') {
    if (typeof document === 'undefined') return { x: 0, y: 0 };
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', path);
    const point = tempPath.getPointAtLength(length);
    return { x: point.x, y: point.y };
  }
  const point = path.getPointAtLength(length);
  return { x: point.x, y: point.y };
}

/**
 * Interpolate between two paths
 */
export function interpolatePath(from: string, to: string, progress: number): string {
  // Parse both paths into command arrays
  const fromCommands = parsePath(from);
  const toCommands = parsePath(to);

  // Normalize paths to have same number of commands
  const [normalizedFrom, normalizedTo] = normalizePaths(fromCommands, toCommands);

  // Interpolate each command
  const interpolated = normalizedFrom.map((fromCmd, i) => {
    const toCmd = normalizedTo[i]!; // Safe because paths are normalized to same length
    return interpolateCommand(fromCmd, toCmd, progress);
  });

  return pathCommandsToString(interpolated);
}

/**
 * Split a path into segments
 */
export function splitPath(path: string): string[] {
  const commands = parsePath(path);
  return commands.map((cmd) => pathCommandToString(cmd));
}

/**
 * Reverse a path
 */
export function reversePath(path: string): string {
  const commands = parsePath(path);
  const reversed = [...commands].reverse();
  return pathCommandsToString(reversed);
}

/**
 * Animate path drawing (stroke-dashoffset technique)
 */
export function animatePathDraw(
  element: SVGPathElement,
  options: {
    duration?: number;
    delay?: number;
    easing?: EasingFunction;
    reverse?: boolean;
    onUpdate?: (progress: number) => void;
    onComplete?: () => void;
  } = {}
): { stop: () => void; pause: () => void; resume: () => void } {
  const length = element.getTotalLength();
  const duration = options.duration ?? 1000;
  const delay = options.delay ?? 0;
  const easing = normalizeEasing(options.easing ?? 'ease');
  const reverse = options.reverse ?? false;

  // Set up stroke-dasharray and stroke-dashoffset
  element.style.strokeDasharray = `${length}`;
  element.style.strokeDashoffset = reverse ? '0' : `${length}`;

  // No-op switch to satisfy linter

  let startTime: number | null = null;
  let animationId: number | null = null;
  let isPaused = false;
  let pausedTime = 0;

  const animate = (timestamp: number) => {
    if (isPaused) return;

    if (!startTime) {
      startTime = timestamp - pausedTime;
    }

    const elapsed = timestamp - startTime - delay;

    if (elapsed < 0) {
      animationId = requestAnimationFrame(animate);
      return;
    }

    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easing(progress);

    const offset = reverse
      ? easedProgress * length
      : length - easedProgress * length;

    element.style.strokeDashoffset = `${offset}`;
    options.onUpdate?.(easedProgress);

    if (progress < 1) {
      animationId = requestAnimationFrame(animate);
    } else {
      options.onComplete?.();
    }
  };

  animationId = requestAnimationFrame(animate);

  return {
    stop: () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      element.style.strokeDasharray = '';
      element.style.strokeDashoffset = '';
    },
    pause: () => {
      isPaused = true;
      if (startTime) {
        pausedTime = performance.now() - startTime;
      }
    },
    resume: () => {
      isPaused = false;
      if (animationId !== null) {
        animationId = requestAnimationFrame(animate);
      }
    },
  };
}

/**
 * Animate element motion along a path
 */
export function animateMotionAlongPath(
  element: SVGElement,
  path: string | SVGPathElement,
  options: {
    duration?: number;
    delay?: number;
    easing?: EasingFunction;
    rotate?: boolean | 'auto' | 'auto-reverse';
    offset?: { x?: number; y?: number };
    onUpdate?: (progress: number, point: { x: number; y: number }) => void;
    onComplete?: () => void;
  } = {}
): { stop: () => void; pause: () => void; resume: () => void } {
  const duration = options.duration ?? 1000;
  const delay = options.delay ?? 0;
  const easing = normalizeEasing(options.easing ?? 'ease');
  const rotate = options.rotate ?? false;
  const offsetX = options.offset?.x ?? 0;
  const offsetY = options.offset?.y ?? 0;

  const totalLength = getPathLength(path);
  let startTime: number | null = null;
  let animationId: number | null = null;
  let isPaused = false;
  let pausedTime = 0;

  const animate = (timestamp: number) => {
    if (isPaused) return;

    if (!startTime) {
      startTime = timestamp - pausedTime;
    }

    const elapsed = timestamp - startTime - delay;

    if (elapsed < 0) {
      animationId = requestAnimationFrame(animate);
      return;
    }

    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easing(progress);
    const length = totalLength * easedProgress;

    const point = getPointAtLength(path, length);
    const x = point.x + offsetX;
    const y = point.y + offsetY;

    // Apply position
    element.setAttribute('transform', `translate(${x}, ${y})`);

    // Apply rotation if requested
    if (rotate && progress < 1) {
      const nextLength = Math.min(length + 1, totalLength);
      const nextPoint = getPointAtLength(path, nextLength);
      const angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x) * (180 / Math.PI);
      const rotation = rotate === 'auto-reverse' ? angle + 180 : angle;
      element.setAttribute('transform', `translate(${x}, ${y}) rotate(${rotation})`);
    }

    options.onUpdate?.(easedProgress, { x, y });

    if (progress < 1) {
      animationId = requestAnimationFrame(animate);
    } else {
      options.onComplete?.();
    }
  };

  animationId = requestAnimationFrame(animate);

  return {
    stop: () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    },
    pause: () => {
      isPaused = true;
      if (startTime) {
        pausedTime = performance.now() - startTime;
      }
    },
    resume: () => {
      isPaused = false;
      if (animationId !== null) {
        animationId = requestAnimationFrame(animate);
      }
    },
  };
}

// Helper functions for path parsing and interpolation

interface PathCommand {
  type: string;
  params: number[];
}

function parsePath(pathString: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const commandRegex = /([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi;
  let match;

  while ((match = commandRegex.exec(pathString)) !== null) {
    const type = match[1];
    const paramsString = match[2]?.trim() || '';
    const params = paramsString
      ? paramsString.split(/[\s,]+/).map(Number)
      : [];

    if (type) {
      commands.push({ type, params });
    } else {
      // Handle edge case where type is missing
      break;
    }
  }

  return commands;
}

function pathCommandToString(cmd: PathCommand): string {
  return `${cmd.type}${cmd.params.join(' ')}`;
}

function pathCommandsToString(commands: PathCommand[]): string {
  return commands.map(pathCommandToString).join('');
}

function normalizePaths(
  from: PathCommand[],
  to: PathCommand[]
): [PathCommand[], PathCommand[]] {
  // Simple normalization: pad shorter path with last command
  const maxLength = Math.max(from.length, to.length);
  const normalizedFrom = [...from];
  const normalizedTo = [...to];

  // Ensure we have at least one command to copy from
  if (normalizedFrom.length > 0) {
    while (normalizedFrom.length < maxLength) {
      const lastCmd = normalizedFrom[normalizedFrom.length - 1]!;
      normalizedFrom.push({ type: lastCmd.type, params: [...lastCmd.params] });
    }
  }

  if (normalizedTo.length > 0) {
    while (normalizedTo.length < maxLength) {
      const lastCmd = normalizedTo[normalizedTo.length - 1]!;
      normalizedTo.push({ type: lastCmd.type, params: [...lastCmd.params] });
    }
  }

  return [normalizedFrom, normalizedTo];
}

function interpolateCommand(
  from: PathCommand,
  to: PathCommand,
  progress: number
): PathCommand {
  // Interpolate parameters
  const params = from.params.map((fromParam, i) => {
    const toParam = to.params[i] ?? fromParam;
    return fromParam + (toParam - fromParam) * progress;
  });

  // Use the 'to' command type (assuming paths are compatible)
  return { type: to.type, params };
}

/**
 * Normalize easing function
 */
function normalizeEasing(easing: EasingFunction): (t: number) => number {
  if (typeof easing === 'function') {
    return easing;
  }

  // Predefined easing functions
  const easings: Record<string, (t: number) => number> = {
    linear: (t) => t,
    ease: (t) => cubicBezier(0.25, 0.1, 0.25, 1)(t),
    'ease-in': (t) => cubicBezier(0.42, 0, 1, 1)(t),
    'ease-out': (t) => cubicBezier(0, 0, 0.58, 1)(t),
    'ease-in-out': (t) => cubicBezier(0.42, 0, 0.58, 1)(t),
  };

  return easings[easing] ?? ((t: number) => t); // Fallback to linear
}

/**
 * Create cubic bezier easing function
 */
function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): (t: number) => number {
  return (progress: number) => {
    // Simplified cubic bezier calculation
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const _ax = 1 - cx - bx;

    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    const sampleCurveY = (time: number) => ((ay * time + by) * time + cy) * time;

    return sampleCurveY(progress);
  };
}
