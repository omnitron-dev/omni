/**
 * Enhanced Debugging Tools
 *
 * Provides advanced debugging features including render analysis,
 * prop change tracking, effect dependency tracking, signal subscription
 * graphs, and wasted render detection.
 *
 * @module devtools/debug-enhanced
 */

import type {
  Inspector,
  ComponentMetadata,
  SignalMetadata,
} from './types.js';

/**
 * Render analysis result
 */
export interface RenderAnalysis {
  componentId: string;
  componentName: string;
  renderCount: number;
  renderTime: number;
  triggerType: 'props' | 'state' | 'parent' | 'force' | 'unknown';
  changedProps: PropChange[];
  changedSignals: SignalChange[];
  wasNecessary: boolean;
  reason: string;
  recommendation?: string;
}

/**
 * Prop change information
 */
export interface PropChange {
  name: string;
  oldValue: any;
  newValue: any;
  isReferenceEqual: boolean;
  isDeepEqual: boolean;
}

/**
 * Signal change information
 */
export interface SignalChange {
  id: string;
  name?: string;
  oldValue: any;
  newValue: any;
  subscribers: number;
}

/**
 * Effect dependency info
 */
export interface EffectDependencyInfo {
  effectId: string;
  effectName?: string;
  dependencies: Array<{
    signalId: string;
    signalName?: string;
    value: any;
    changeCount: number;
  }>;
  executionCount: number;
  avgExecutionTime: number;
  isOverTriggered: boolean;
}

/**
 * Signal subscription graph node
 */
export interface SignalGraphNode {
  id: string;
  name?: string;
  type: 'signal' | 'computed' | 'effect' | 'component';
  value: any;
  subscribers: SignalGraphNode[];
  dependencies: SignalGraphNode[];
  depth: number;
}

/**
 * Wasted render info
 */
export interface WastedRender {
  componentId: string;
  componentName: string;
  renderTime: number;
  reason: string;
  frequency: number; // renders per second
  totalWastedTime: number;
  suggestion: string;
}

/**
 * Component update frequency
 */
export interface UpdateFrequency {
  componentId: string;
  componentName: string;
  renderCount: number;
  timeSpan: number; // ms
  frequency: number; // renders per second
  isHighFrequency: boolean;
  threshold: number;
}

/**
 * Enhanced debugger configuration
 */
export interface DebugEnhancedConfig {
  /** Track prop changes */
  trackPropChanges?: boolean;
  /** Track signal changes */
  trackSignalChanges?: boolean;
  /** Enable wasted render detection */
  detectWastedRenders?: boolean;
  /** High frequency threshold (renders/sec) */
  highFrequencyThreshold?: number;
  /** Wasted render threshold (ms) */
  wastedRenderThreshold?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<DebugEnhancedConfig> = {
  trackPropChanges: true,
  trackSignalChanges: true,
  detectWastedRenders: true,
  highFrequencyThreshold: 10, // 10 renders/sec
  wastedRenderThreshold: 5, // 5ms
};

/**
 * Enhanced debugger implementation
 */
export class DebugEnhanced {
  private config: Required<DebugEnhancedConfig>;
  private inspector: Inspector;

  // Tracking data
  private renderHistory = new Map<string, RenderAnalysis[]>();
  private propChanges = new Map<string, PropChange[]>();
  private signalChanges = new Map<string, SignalChange[]>();
  private wastedRenders = new Map<string, WastedRender[]>();

  // Component tracking
  private previousProps = new WeakMap<any, Record<string, any>>();
  private previousSignals = new Map<string, any>();

  constructor(inspector: Inspector, config: Partial<DebugEnhancedConfig> = {}) {
    this.inspector = inspector;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze why a component rendered
   */
  analyzeRender(componentId: string, currentProps: Record<string, any>): RenderAnalysis {
    const state = this.inspector.getState();
    const component = state.components.get(componentId);

    if (!component) {
      throw new Error(`Component not found: ${componentId}`);
    }

    // Get previous props
    const prevProps = component.props || {};
    const changedProps: PropChange[] = [];

    // Detect prop changes
    for (const key in currentProps) {
      if (currentProps[key] !== prevProps[key]) {
        changedProps.push({
          name: key,
          oldValue: prevProps[key],
          newValue: currentProps[key],
          isReferenceEqual: currentProps[key] === prevProps[key],
          isDeepEqual: this.deepEqual(currentProps[key], prevProps[key]),
        });
      }
    }

    // Detect signal changes
    const changedSignals: SignalChange[] = [];
    for (const signalId of component.signals) {
      const signal = state.signals.get(signalId);
      if (signal) {
        const prevValue = this.previousSignals.get(signalId);
        if (prevValue !== signal.value) {
          changedSignals.push({
            id: signalId,
            name: signal.name,
            oldValue: prevValue,
            newValue: signal.value,
            subscribers: signal.dependentCount,
          });
          this.previousSignals.set(signalId, signal.value);
        }
      }
    }

    // Determine trigger type
    let triggerType: RenderAnalysis['triggerType'] = 'unknown';
    if (changedProps.length > 0) {
      triggerType = 'props';
    } else if (changedSignals.length > 0) {
      triggerType = 'state';
    }

    // Check if render was necessary
    const wasNecessary = changedProps.length > 0 || changedSignals.length > 0;

    // Generate reason
    let reason = '';
    if (!wasNecessary) {
      reason = 'Render was triggered but no props or state changed (possible wasted render)';
    } else if (changedProps.length > 0) {
      reason = `Props changed: ${changedProps.map(p => p.name).join(', ')}`;
    } else if (changedSignals.length > 0) {
      reason = `Signals changed: ${changedSignals.map(s => s.name || s.id).join(', ')}`;
    }

    // Generate recommendation
    let recommendation: string | undefined;
    if (!wasNecessary) {
      recommendation = 'Consider using React.memo() or shouldComponentUpdate() to prevent unnecessary renders';
    } else if (changedProps.some(p => !p.isReferenceEqual && p.isDeepEqual)) {
      recommendation = 'Some props have deep equality but different references. Consider memoization.';
    }

    const analysis: RenderAnalysis = {
      componentId,
      componentName: component.name,
      renderCount: component.renderCount,
      renderTime: component.avgRenderTime,
      triggerType,
      changedProps,
      changedSignals,
      wasNecessary,
      reason,
      recommendation,
    };

    // Store in history
    if (!this.renderHistory.has(componentId)) {
      this.renderHistory.set(componentId, []);
    }
    this.renderHistory.get(componentId)!.push(analysis);

    // Track wasted renders
    if (!wasNecessary && this.config.detectWastedRenders) {
      this.trackWastedRender(component, analysis);
    }

    return analysis;
  }

  /**
   * Track wasted render
   */
  private trackWastedRender(component: ComponentMetadata, analysis: RenderAnalysis): void {
    if (!this.wastedRenders.has(component.id)) {
      this.wastedRenders.set(component.id, []);
    }

    const history = this.renderHistory.get(component.id) || [];
    const wastedCount = history.filter(r => !r.wasNecessary).length;
    const totalTime = history.reduce((sum, r) => (r.wasNecessary ? sum : sum + r.renderTime), 0);

    const frequency = this.calculateUpdateFrequency(component).frequency;

    const wastedRender: WastedRender = {
      componentId: component.id,
      componentName: component.name,
      renderTime: analysis.renderTime,
      reason: analysis.reason,
      frequency,
      totalWastedTime: totalTime,
      suggestion: this.getWastedRenderSuggestion(component, wastedCount),
    };

    this.wastedRenders.get(component.id)!.push(wastedRender);
  }

  /**
   * Get wasted render suggestion
   */
  private getWastedRenderSuggestion(component: ComponentMetadata, wastedCount: number): string {
    if (wastedCount > 10) {
      return 'High number of wasted renders detected. Consider wrapping with React.memo() or implementing shouldComponentUpdate()';
    } else if (component.avgRenderTime > this.config.wastedRenderThreshold) {
      return 'Component has expensive renders. Optimize render logic or use memoization';
    }
    return 'Monitor component for continued wasted renders';
  }

  /**
   * Deep equality check
   */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    if (a === null || b === null) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!this.deepEqual(a[key], b[key])) return false;
    }

    return true;
  }

  /**
   * Track effect dependencies
   */
  trackEffectDependencies(effectId: string): EffectDependencyInfo | null {
    const state = this.inspector.getState();
    const effect = state.effects.get(effectId);

    if (!effect) return null;

    const dependencies = effect.dependencies.map(depId => {
      const signal = state.signals.get(depId) || state.computed.get(depId);
      return {
        signalId: depId,
        signalName: signal?.name,
        value: signal?.value,
        changeCount: 0, // Would track this over time
      };
    });

    const isOverTriggered = effect.executionCount > 100 && effect.avgExecutionTime < 1;

    return {
      effectId: effect.id,
      effectName: effect.name,
      dependencies,
      executionCount: effect.executionCount,
      avgExecutionTime: effect.avgExecutionTime,
      isOverTriggered,
    };
  }

  /**
   * Build signal subscription graph
   */
  buildSignalGraph(signalId: string): SignalGraphNode {
    const state = this.inspector.getState();
    const signal = state.signals.get(signalId) || state.computed.get(signalId);

    if (!signal) {
      throw new Error(`Signal not found: ${signalId}`);
    }

    const visited = new Set<string>();
    return this.buildGraphNode(signal, state, visited, 0);
  }

  /**
   * Build graph node recursively
   */
  private buildGraphNode(
    signal: SignalMetadata,
    state: ReturnType<Inspector['getState']>,
    visited: Set<string>,
    depth: number,
  ): SignalGraphNode {
    if (visited.has(signal.id)) {
      // Circular dependency
      return {
        id: signal.id,
        name: signal.name,
        type: signal.type === 'writable' ? 'signal' : signal.type,
        value: '[Circular]',
        subscribers: [],
        dependencies: [],
        depth,
      };
    }

    visited.add(signal.id);

    // Find subscribers (signals/effects that depend on this)
    const subscribers: SignalGraphNode[] = [];

    // Check computed values
    for (const computed of state.computed.values()) {
      if (computed.dependencies.includes(signal.id)) {
        subscribers.push(this.buildGraphNode(computed, state, new Set(visited), depth + 1));
      }
    }

    // Find dependencies
    const dependencies: SignalGraphNode[] = [];
    if ('dependencies' in signal && signal.dependencies) {
      for (const depId of signal.dependencies) {
        const dep = state.signals.get(depId) || state.computed.get(depId);
        if (dep) {
          dependencies.push(this.buildGraphNode(dep, state, new Set(visited), depth + 1));
        }
      }
    }

    return {
      id: signal.id,
      name: signal.name,
      type: signal.type === 'writable' ? 'signal' : signal.type,
      value: signal.value,
      subscribers,
      dependencies,
      depth,
    };
  }

  /**
   * Calculate component update frequency
   */
  calculateUpdateFrequency(component: ComponentMetadata): UpdateFrequency {
    const now = Date.now();
    const timeSpan = now - component.createdAt;
    const frequency = timeSpan > 0 ? (component.renderCount / timeSpan) * 1000 : 0;
    const isHighFrequency = frequency > this.config.highFrequencyThreshold;

    return {
      componentId: component.id,
      componentName: component.name,
      renderCount: component.renderCount,
      timeSpan,
      frequency,
      isHighFrequency,
      threshold: this.config.highFrequencyThreshold,
    };
  }

  /**
   * Get all wasted renders
   */
  getWastedRenders(): WastedRender[] {
    const allWasted: WastedRender[] = [];

    for (const renders of this.wastedRenders.values()) {
      allWasted.push(...renders);
    }

    return allWasted.sort((a, b) => b.totalWastedTime - a.totalWastedTime);
  }

  /**
   * Get high frequency components
   */
  getHighFrequencyComponents(): UpdateFrequency[] {
    const state = this.inspector.getState();
    const frequencies: UpdateFrequency[] = [];

    for (const component of state.components.values()) {
      const freq = this.calculateUpdateFrequency(component);
      if (freq.isHighFrequency) {
        frequencies.push(freq);
      }
    }

    return frequencies.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Get render history for component
   */
  getRenderHistory(componentId: string): RenderAnalysis[] {
    return this.renderHistory.get(componentId) || [];
  }

  /**
   * Get prop change history
   */
  getPropChangeHistory(componentId: string): PropChange[] {
    return this.propChanges.get(componentId) || [];
  }

  /**
   * Generate debug report
   */
  generateReport(): DebugReport {
    const state = this.inspector.getState();
    const wastedRenders = this.getWastedRenders();
    const highFrequencyComponents = this.getHighFrequencyComponents();

    const totalWastedTime = wastedRenders.reduce((sum, w) => sum + w.totalWastedTime, 0);
    const totalComponents = state.components.size;
    const componentsWithWaste = new Set(wastedRenders.map(w => w.componentId)).size;

    return {
      summary: {
        totalComponents,
        componentsWithWastedRenders: componentsWithWaste,
        totalWastedTime,
        highFrequencyComponents: highFrequencyComponents.length,
      },
      wastedRenders: wastedRenders.slice(0, 10), // Top 10
      highFrequencyComponents: highFrequencyComponents.slice(0, 10), // Top 10
      recommendations: this.generateRecommendations(wastedRenders, highFrequencyComponents),
    };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    wastedRenders: WastedRender[],
    highFrequency: UpdateFrequency[],
  ): string[] {
    const recommendations: string[] = [];

    if (wastedRenders.length > 0) {
      recommendations.push(
        `Found ${wastedRenders.length} components with wasted renders. Consider using memoization.`,
      );
    }

    if (highFrequency.length > 0) {
      recommendations.push(
        `Found ${highFrequency.length} components updating frequently. Review state management.`,
      );
    }

    const topWasted = wastedRenders[0];
    if (topWasted && topWasted.totalWastedTime > 100) {
      recommendations.push(
        `Component "${topWasted.componentName}" has significant wasted render time (${topWasted.totalWastedTime.toFixed(2)}ms). Priority optimization candidate.`,
      );
    }

    return recommendations;
  }

  /**
   * Clear tracking data
   */
  clear(): void {
    this.renderHistory.clear();
    this.propChanges.clear();
    this.signalChanges.clear();
    this.wastedRenders.clear();
    this.previousSignals.clear();
  }
}

/**
 * Debug report
 */
export interface DebugReport {
  summary: {
    totalComponents: number;
    componentsWithWastedRenders: number;
    totalWastedTime: number;
    highFrequencyComponents: number;
  };
  wastedRenders: WastedRender[];
  highFrequencyComponents: UpdateFrequency[];
  recommendations: string[];
}

/**
 * Create enhanced debugger
 */
export function createDebugEnhanced(
  inspector: Inspector,
  config?: Partial<DebugEnhancedConfig>,
): DebugEnhanced {
  return new DebugEnhanced(inspector, config);
}
