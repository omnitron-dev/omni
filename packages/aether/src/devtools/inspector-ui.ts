/**
 * Visual Component Inspector UI
 *
 * Provides visual inspection capabilities with overlay mode, component
 * boundaries, props/state inspection, and performance metrics.
 *
 * @module devtools/inspector-ui
 */

import type { ComponentMetadata, SignalMetadata } from './types.js';
import type { Inspector } from './types.js';

/**
 * Inspector UI configuration
 */
export interface InspectorUIConfig {
  /** Enable overlay mode */
  enableOverlay?: boolean;
  /** Show component boundaries */
  showBoundaries?: boolean;
  /** Show performance metrics */
  showMetrics?: boolean;
  /** Highlight color */
  highlightColor?: string;
  /** Border width */
  borderWidth?: number;
  /** Show tooltips on hover */
  showTooltips?: boolean;
  /** Z-index for overlay */
  zIndex?: number;
}

/**
 * Component inspection data
 */
export interface ComponentInspection {
  /** Component metadata */
  component: ComponentMetadata;
  /** DOM element */
  element: HTMLElement;
  /** Bounding rect */
  rect: DOMRect;
  /** Signals in component */
  signals: SignalMetadata[];
  /** Render time */
  renderTime: number;
  /** Update frequency (renders/sec) */
  updateFrequency: number;
}

/**
 * Overlay element data
 */
interface OverlayElement {
  container: HTMLDivElement;
  highlight: HTMLDivElement;
  tooltip: HTMLDivElement;
  boundary: HTMLDivElement;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<InspectorUIConfig> = {
  enableOverlay: true,
  showBoundaries: true,
  showMetrics: true,
  highlightColor: 'rgba(88, 166, 255, 0.3)',
  borderWidth: 2,
  showTooltips: true,
  zIndex: 999999,
};

/**
 * Visual Inspector UI implementation
 */
export class InspectorUI {
  private config: Required<InspectorUIConfig>;
  private inspector: Inspector;
  private isEnabled = false;
  private overlayElements: Map<string, OverlayElement> = new Map();
  private selectedComponent: string | null = null;
  private hoveredComponent: string | null = null;

  // DOM tracking
  private componentElements = new WeakMap<HTMLElement, string>();
  private elementComponents = new Map<string, WeakRef<HTMLElement>>();

  // Event handlers
  private mouseoverHandler?: (e: MouseEvent) => void;
  private mouseoutHandler?: (e: MouseEvent) => void;
  private clickHandler?: (e: MouseEvent) => void;

  constructor(inspector: Inspector, config: Partial<InspectorUIConfig> = {}) {
    this.inspector = inspector;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Enable inspector UI
   */
  enable(): void {
    if (this.isEnabled) return;
    this.isEnabled = true;

    if (this.config.enableOverlay) {
      this.setupEventHandlers();
      this.renderComponentBoundaries();
    }
  }

  /**
   * Disable inspector UI
   */
  disable(): void {
    if (!this.isEnabled) return;
    this.isEnabled = false;

    this.removeEventHandlers();
    this.clearOverlays();
  }

  /**
   * Register component with DOM element
   */
  registerComponent(componentId: string, element: HTMLElement): void {
    this.componentElements.set(element, componentId);
    this.elementComponents.set(componentId, new WeakRef(element));

    if (this.isEnabled && this.config.showBoundaries) {
      this.renderComponentBoundary(componentId, element);
    }
  }

  /**
   * Unregister component
   */
  unregisterComponent(componentId: string): void {
    this.elementComponents.delete(componentId);
    this.removeOverlay(componentId);
  }

  /**
   * Select component for inspection
   */
  selectComponent(componentId: string): ComponentInspection | null {
    this.selectedComponent = componentId;

    const state = this.inspector.getState();
    const component = state.components.get(componentId);
    if (!component) return null;

    const elementRef = this.elementComponents.get(componentId);
    const element = elementRef?.deref();
    if (!element) return null;

    // Get signals for this component
    const signals = Array.from(state.signals.values()).filter((s) => s.componentId === componentId);

    // Calculate update frequency
    const updateFrequency = this.calculateUpdateFrequency(component);

    const inspection: ComponentInspection = {
      component,
      element,
      rect: element.getBoundingClientRect(),
      signals,
      renderTime: component.avgRenderTime,
      updateFrequency,
    };

    // Highlight selected component
    this.highlightComponent(componentId);

    return inspection;
  }

  /**
   * Get component at position
   */
  getComponentAtPosition(x: number, y: number): string | null {
    const elements = document.elementsFromPoint(x, y);

    for (const element of elements) {
      if (element instanceof HTMLElement) {
        const componentId = this.componentElements.get(element);
        if (componentId) {
          return componentId;
        }
      }
    }

    return null;
  }

  /**
   * Highlight component
   */
  highlightComponent(componentId: string): void {
    // Remove previous highlight
    if (this.hoveredComponent && this.hoveredComponent !== componentId) {
      this.removeHighlight(this.hoveredComponent);
    }

    this.hoveredComponent = componentId;

    const elementRef = this.elementComponents.get(componentId);
    const element = elementRef?.deref();
    if (!element) return;

    let overlay = this.overlayElements.get(componentId);
    if (!overlay) {
      overlay = this.createOverlayElement();
      this.overlayElements.set(componentId, overlay);
      document.body.appendChild(overlay.container);
    }

    // Update highlight position and visibility
    this.updateOverlayPosition(overlay, element);
    overlay.highlight.style.display = 'block';

    // Show tooltip
    if (this.config.showTooltips) {
      this.showTooltip(overlay, componentId);
    }
  }

  /**
   * Remove highlight
   */
  removeHighlight(componentId: string): void {
    const overlay = this.overlayElements.get(componentId);
    if (!overlay) return;

    overlay.highlight.style.display = 'none';
    overlay.tooltip.style.display = 'none';
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.mouseoverHandler = (e: MouseEvent) => {
      if (!this.isEnabled) return;

      const target = e.target as HTMLElement;
      const componentId = this.findComponentId(target);

      if (componentId && componentId !== this.hoveredComponent) {
        this.highlightComponent(componentId);
      }
    };

    this.mouseoutHandler = (e: MouseEvent) => {
      if (!this.isEnabled) return;

      const target = e.target as HTMLElement;
      const componentId = this.findComponentId(target);

      if (componentId && componentId === this.hoveredComponent) {
        this.removeHighlight(componentId);
        this.hoveredComponent = null;
      }
    };

    this.clickHandler = (e: MouseEvent) => {
      if (!this.isEnabled) return;
      if (!e.altKey) return; // Require Alt key for selection

      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement;
      const componentId = this.findComponentId(target);

      if (componentId) {
        const inspection = this.selectComponent(componentId);
        if (inspection) {
          console.log('[Aether Inspector] Component selected:', inspection);
          // Dispatch event for DevTools panel
          this.dispatchInspectionEvent(inspection);
        }
      }
    };

    document.addEventListener('mouseover', this.mouseoverHandler, true);
    document.addEventListener('mouseout', this.mouseoutHandler, true);
    document.addEventListener('click', this.clickHandler, true);
  }

  /**
   * Remove event handlers
   */
  private removeEventHandlers(): void {
    if (this.mouseoverHandler) {
      document.removeEventListener('mouseover', this.mouseoverHandler, true);
    }
    if (this.mouseoutHandler) {
      document.removeEventListener('mouseout', this.mouseoutHandler, true);
    }
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
    }
  }

  /**
   * Find component ID for element
   */
  private findComponentId(element: HTMLElement): string | null {
    let current: HTMLElement | null = element;

    while (current) {
      const componentId = this.componentElements.get(current);
      if (componentId) return componentId;
      current = current.parentElement;
    }

    return null;
  }

  /**
   * Render component boundaries
   */
  private renderComponentBoundaries(): void {
    const _state = this.inspector.getState();

    for (const [componentId, elementRef] of this.elementComponents.entries()) {
      const element = elementRef.deref();
      if (element) {
        this.renderComponentBoundary(componentId, element);
      }
    }
  }

  /**
   * Render component boundary
   */
  private renderComponentBoundary(componentId: string, element: HTMLElement): void {
    let overlay = this.overlayElements.get(componentId);
    if (!overlay) {
      overlay = this.createOverlayElement();
      this.overlayElements.set(componentId, overlay);
      document.body.appendChild(overlay.container);
    }

    this.updateOverlayPosition(overlay, element);
    overlay.boundary.style.display = 'block';
  }

  /**
   * Create overlay element
   */
  private createOverlayElement(): OverlayElement {
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: ${this.config.zIndex};
    `;

    const boundary = document.createElement('div');
    boundary.style.cssText = `
      position: absolute;
      border: ${this.config.borderWidth}px dashed rgba(88, 166, 255, 0.5);
      display: none;
    `;

    const highlight = document.createElement('div');
    highlight.style.cssText = `
      position: absolute;
      background: ${this.config.highlightColor};
      border: ${this.config.borderWidth}px solid rgb(88, 166, 255);
      display: none;
    `;

    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: absolute;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre;
      display: none;
      max-width: 400px;
    `;

    container.appendChild(boundary);
    container.appendChild(highlight);
    container.appendChild(tooltip);

    return { container, boundary, highlight, tooltip };
  }

  /**
   * Update overlay position
   */
  private updateOverlayPosition(overlay: OverlayElement, element: HTMLElement): void {
    const rect = element.getBoundingClientRect();

    const style = `
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
    `;

    overlay.boundary.style.cssText += style;
    overlay.highlight.style.cssText += style;
  }

  /**
   * Show tooltip
   */
  private showTooltip(overlay: OverlayElement, componentId: string): void {
    const state = this.inspector.getState();
    const component = state.components.get(componentId);
    if (!component) return;

    const updateFrequency = this.calculateUpdateFrequency(component);
    const signalCount = component.signals.length;
    const effectCount = component.effects.length;

    const tooltipText = `
${component.name}
Renders: ${component.renderCount}
Avg render time: ${component.avgRenderTime.toFixed(2)}ms
Updates/sec: ${updateFrequency.toFixed(1)}
Signals: ${signalCount} | Effects: ${effectCount}
`.trim();

    overlay.tooltip.textContent = tooltipText;
    overlay.tooltip.style.display = 'block';

    // Position tooltip above or below component
    const elementRef = this.elementComponents.get(componentId);
    const element = elementRef?.deref();
    if (element) {
      const rect = element.getBoundingClientRect();
      overlay.tooltip.style.left = `${rect.left}px`;
      overlay.tooltip.style.top = `${rect.top - 100}px`;
    }
  }

  /**
   * Calculate update frequency
   */
  private calculateUpdateFrequency(component: ComponentMetadata): number {
    const now = Date.now();
    const elapsed = (now - component.createdAt) / 1000; // seconds
    if (elapsed === 0) return 0;
    return component.renderCount / elapsed;
  }

  /**
   * Clear all overlays
   */
  private clearOverlays(): void {
    for (const overlay of this.overlayElements.values()) {
      overlay.container.remove();
    }
    this.overlayElements.clear();
  }

  /**
   * Remove overlay
   */
  private removeOverlay(componentId: string): void {
    const overlay = this.overlayElements.get(componentId);
    if (overlay) {
      overlay.container.remove();
      this.overlayElements.delete(componentId);
    }
  }

  /**
   * Dispatch inspection event for DevTools panel
   */
  private dispatchInspectionEvent(inspection: ComponentInspection): void {
    const event = new CustomEvent('aether:inspect-component', {
      detail: inspection,
    });
    window.dispatchEvent(event);
  }

  /**
   * Get component tree visualization data
   */
  getComponentTreeVisualization(): ComponentTreeNode[] {
    const state = this.inspector.getState();
    const componentTree = state.componentTree;

    return componentTree.map((node) => this.buildTreeVisualization(node));
  }

  /**
   * Build tree visualization node
   */
  private buildTreeVisualization(node: any): ComponentTreeNode {
    const component = node.metadata as ComponentMetadata;

    return {
      id: node.id,
      name: component.name,
      renderCount: component.renderCount,
      avgRenderTime: component.avgRenderTime,
      signalCount: component.signals.length,
      effectCount: component.effects.length,
      children: node.children.map((child: any) => this.buildTreeVisualization(child)),
    };
  }

  /**
   * Get performance metrics for component
   */
  getComponentMetrics(componentId: string): ComponentMetrics | null {
    const state = this.inspector.getState();
    const component = state.components.get(componentId);
    if (!component) return null;

    return {
      componentId,
      name: component.name,
      renderCount: component.renderCount,
      avgRenderTime: component.avgRenderTime,
      totalRenderTime: component.avgRenderTime * component.renderCount,
      updateFrequency: this.calculateUpdateFrequency(component),
      signalCount: component.signals.length,
      effectCount: component.effects.length,
      lastRenderedAt: component.lastRenderedAt,
    };
  }
}

/**
 * Component tree node for visualization
 */
export interface ComponentTreeNode {
  id: string;
  name: string;
  renderCount: number;
  avgRenderTime: number;
  signalCount: number;
  effectCount: number;
  children: ComponentTreeNode[];
}

/**
 * Component performance metrics
 */
export interface ComponentMetrics {
  componentId: string;
  name: string;
  renderCount: number;
  avgRenderTime: number;
  totalRenderTime: number;
  updateFrequency: number;
  signalCount: number;
  effectCount: number;
  lastRenderedAt: number;
}

/**
 * Create inspector UI instance
 */
export function createInspectorUI(inspector: Inspector, config?: Partial<InspectorUIConfig>): InspectorUI {
  return new InspectorUI(inspector, config);
}
