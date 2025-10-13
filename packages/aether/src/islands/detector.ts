/**
 * Automatic Island Detector
 *
 * Analyzes components for interactivity signals and automatically
 * determines which components should be islands
 */

import type { Component } from '../core/component/types.js';
import type {
  InteractivityDetection,
  InteractivitySignal,
  HydrationStrategy,
  IslandDetectionConfig,
} from './types.js';

/**
 * Default detection configuration
 */
const DEFAULT_CONFIG: Required<IslandDetectionConfig> = {
  autoDetect: true,
  threshold: 1,
  customRules: [],
  exclude: [],
};

/**
 * Detect if a component is interactive
 *
 * Analyzes the component's setup function for interactivity signals:
 * - Event handlers (onClick, onInput, etc.)
 * - Reactive state (signal(), createStore())
 * - Lifecycle hooks (onMount, onCleanup)
 * - Browser APIs (window, document, navigator)
 *
 * @param component - Component to analyze
 * @param config - Detection configuration
 * @returns Detection result
 */
export function detectInteractivity(
  component: Component,
  config: IslandDetectionConfig = {},
): InteractivityDetection {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Check if component is explicitly excluded
  if (cfg.exclude.some((pattern) => pattern.test(component.displayName || component.name))) {
    return {
      isInteractive: false,
      signals: [],
    };
  }

  // Get component source code
  const source = component.toString();

  // Detect interactivity signals
  const signals: InteractivitySignal[] = [];

  // 1. Event handlers
  if (hasEventHandlers(source)) {
    signals.push('event-handler');
  }

  // 2. Reactive state
  if (hasReactiveState(source)) {
    signals.push('reactive-state');
  }

  // 3. Lifecycle hooks
  if (hasLifecycleHooks(source)) {
    signals.push('lifecycle-hook');
  }

  // 4. Browser APIs
  if (hasBrowserAPIs(source)) {
    signals.push('browser-api');
  }

  // 5. Timers
  if (hasTimers(source)) {
    signals.push('timer');
  }

  // 6. WebSocket
  if (hasWebSocket(source)) {
    signals.push('websocket');
  }

  // 7. Custom rules
  if (cfg.customRules.some((rule) => rule(component))) {
    signals.push('custom');
  }

  // Determine if interactive based on threshold
  const isInteractive = signals.length >= cfg.threshold;

  // Recommend hydration strategy based on signals
  let recommendedStrategy: HydrationStrategy | undefined;
  if (isInteractive) {
    recommendedStrategy = recommendHydrationStrategy(signals, source);
  }

  return {
    isInteractive,
    signals,
    recommendedStrategy,
  };
}

/**
 * Check if component has event handlers
 */
function hasEventHandlers(source: string): boolean {
  // Check for JSX event attributes
  const jsxEventPattern = /\bon[A-Z]\w+\s*=/;

  // Check for addEventListener
  const addEventListenerPattern = /addEventListener\s*\(/;

  return jsxEventPattern.test(source) || addEventListenerPattern.test(source);
}

/**
 * Check if component has reactive state
 */
function hasReactiveState(source: string): boolean {
  // Check for signal, createStore, createMemo
  const reactivePatterns = [
    /\bsignal\s*\(/,
    /\bcreateStore\s*\(/,
    /\bcreateMemo\s*\(/,
    /\bcomputed\s*\(/,
    /\bderive\s*\(/,
    /\.set\s*\(/,
    /\.update\s*\(/,
  ];

  return reactivePatterns.some((pattern) => pattern.test(source));
}

/**
 * Check if component has lifecycle hooks
 */
function hasLifecycleHooks(source: string): boolean {
  const lifecyclePatterns = [
    /\bonMount\s*\(/,
    /\bonCleanup\s*\(/,
    /\bonDestroy\s*\(/,
    /\buseEffect\s*\(/,
    /\buseLayoutEffect\s*\(/,
  ];

  return lifecyclePatterns.some((pattern) => pattern.test(source));
}

/**
 * Check if component uses browser APIs
 */
function hasBrowserAPIs(source: string): boolean {
  const browserAPIPatterns = [
    /\bwindow\./,
    /\bdocument\./,
    /\bnavigator\./,
    /\blocation\./,
    /\blocalStorage\./,
    /\bsessionStorage\./,
    /\bIntersectionObserver\b/,
    /\bMutationObserver\b/,
    /\bResizeObserver\b/,
    /\brequestAnimationFrame\b/,
    /\brequestIdleCallback\b/,
  ];

  return browserAPIPatterns.some((pattern) => pattern.test(source));
}

/**
 * Check if component uses timers
 */
function hasTimers(source: string): boolean {
  const timerPatterns = [/\bsetTimeout\s*\(/, /\bsetInterval\s*\(/, /\brequestAnimationFrame\s*\(/];

  return timerPatterns.some((pattern) => pattern.test(source));
}

/**
 * Check if component uses WebSocket
 */
function hasWebSocket(source: string): boolean {
  return /\bWebSocket\b/.test(source) || /\bnew\s+WebSocket\s*\(/.test(source);
}

/**
 * Recommend hydration strategy based on detected signals
 */
function recommendHydrationStrategy(signals: InteractivitySignal[], source: string): HydrationStrategy {
  // WebSocket or timer -> immediate hydration
  if (signals.includes('websocket') || signals.includes('timer')) {
    return 'immediate';
  }

  // Browser API + event handler -> likely needs immediate hydration
  if (signals.includes('browser-api') && signals.includes('event-handler')) {
    return 'immediate';
  }

  // Event handler only -> interaction hydration
  if (signals.includes('event-handler') && signals.length === 1) {
    return 'interaction';
  }

  // Heavy component (large source) -> idle or visible
  if (source.length > 10000) {
    // Check if it's likely below the fold
    if (/scroll|viewport|lazy|carousel|tabs/i.test(source)) {
      return 'visible';
    }
    return 'idle';
  }

  // Default to immediate
  return 'immediate';
}

/**
 * Analyze component tree for islands
 *
 * Recursively traverses component tree and identifies all islands
 *
 * @param rootComponent - Root component to analyze
 * @param config - Detection configuration
 * @returns Map of component to detection result
 */
export function analyzeComponentTree(
  rootComponent: Component,
  config: IslandDetectionConfig = {},
): Map<Component, InteractivityDetection> {
  const results = new Map<Component, InteractivityDetection>();
  const visited = new Set<Component>();

  function traverse(component: Component) {
    // Skip if already visited
    if (visited.has(component)) {
      return;
    }
    visited.add(component);

    // Detect interactivity
    const detection = detectInteractivity(component, config);
    results.set(component, detection);

    // TODO: Traverse children (requires component tree analysis)
    // This would require runtime component tree tracking or static analysis
  }

  traverse(rootComponent);

  return results;
}

/**
 * Get components that should be islands
 *
 * @param components - Components to filter
 * @param config - Detection configuration
 * @returns Components that should be islands
 */
export function getIslandComponents(
  components: Component[],
  config: IslandDetectionConfig = {},
): Component[] {
  return components.filter((component) => {
    const detection = detectInteractivity(component, config);
    return detection.isInteractive;
  });
}

/**
 * Estimate component bundle size
 *
 * Rough estimation based on source code size
 *
 * @param component - Component to estimate
 * @returns Estimated size in bytes
 */
export function estimateComponentSize(component: Component): number {
  const source = component.toString();

  // Base size (minified)
  let size = Math.floor(source.length * 0.4); // ~40% after minification

  // Add runtime overhead
  size += 500; // ~500 bytes for runtime

  // Add dependencies estimate (rough)
  const importCount = (source.match(/import\s+/g) || []).length;
  size += importCount * 200; // ~200 bytes per import

  return size;
}

/**
 * Check if component is marked as island
 */
export function isIslandComponent(component: any): boolean {
  return component && component.__island === true;
}

/**
 * Check if component is server-only
 */
export function isServerComponent(component: any): boolean {
  return component && component.__serverOnly === true;
}

/**
 * Check if component is client-only
 */
export function isClientComponent(component: any): boolean {
  return component && component.__clientOnly === true;
}

/**
 * Extract component metadata for debugging
 */
export function getComponentMetadata(component: Component): {
  name: string;
  displayName?: string;
  source: string;
  size: number;
  isInteractive: boolean;
} {
  const detection = detectInteractivity(component);
  const size = estimateComponentSize(component);

  return {
    name: component.name,
    displayName: component.displayName,
    source: component.toString(),
    size,
    isInteractive: detection.isInteractive,
  };
}
