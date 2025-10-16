/**
 * VirtualScrollExtension - Virtual scrolling for large documents
 *
 * Provides:
 * - Viewport-based rendering
 * - Scroll position management
 * - Buffer zones for smooth scrolling
 * - Integration with ProseMirror view
 * - Memory optimization for large documents
 *
 * Performance benefits:
 * - Only render visible content
 * - Reduced DOM nodes
 * - Lower memory usage
 * - Smooth scrolling for large documents
 */

import { Extension } from '../core/Extension.js';
import type { ExtensionConfig } from '../core/types.js';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * Virtual scroll configuration
 */
export interface VirtualScrollConfig extends ExtensionConfig {
  /** Enable virtual scrolling */
  enabled?: boolean;

  /** Minimum document size to enable virtual scrolling (characters) */
  minDocumentSize?: number;

  /** Buffer size (number of lines above/below viewport) */
  bufferLines?: number;

  /** Estimated line height (px) */
  estimatedLineHeight?: number;

  /** Update throttle (ms) */
  updateThrottle?: number;

  /** Enable performance monitoring */
  monitoring?: boolean;
}

/**
 * Viewport information
 */
interface Viewport {
  /** Start position in document */
  from: number;

  /** End position in document */
  to: number;

  /** Viewport top (px) */
  top: number;

  /** Viewport bottom (px) */
  bottom: number;

  /** Viewport height (px) */
  height: number;
}

/**
 * Virtual scroll state
 */
interface VirtualScrollState {
  /** Current viewport */
  viewport: Viewport;

  /** Decorations for hidden content */
  decorations: DecorationSet;

  /** Last update timestamp */
  lastUpdate: number;

  /** Is virtual scrolling active */
  active: boolean;

  /** Total document height (px) */
  totalHeight: number;
}

/**
 * Plugin key for virtual scroll
 */
const virtualScrollKey = new PluginKey<VirtualScrollState>('virtualScroll');

/**
 * VirtualScrollExtension class
 *
 * Implements virtual scrolling for large documents
 */
export class VirtualScrollExtension extends Extension<VirtualScrollConfig> {
  name = 'virtualScroll';

  private scrollListener?: () => void;
  private resizeListener?: () => void;
  private resizeObserver?: ResizeObserver;
  private updateTimeout?: ReturnType<typeof setTimeout>;

  configure(config: Partial<VirtualScrollConfig>): this {
    this.config = {
      enabled: true,
      minDocumentSize: 50000, // 50KB
      bufferLines: 10,
      estimatedLineHeight: 20,
      updateThrottle: 100,
      monitoring: false,
      ...this.config,
      ...config,
    };
    return this;
  }

  getPlugins(): Plugin[] {
    if (!this.config.enabled) {
      return [];
    }

    return [
      new Plugin<VirtualScrollState>({
        key: virtualScrollKey,

        state: {
          init: (_, state) => this.createInitialState(),

          apply: (tr, value, oldState, newState) => {
            // Check if document changed
            if (!tr.docChanged && !tr.getMeta('virtualScrollUpdate')) {
              return value;
            }

            // Recompute viewport
            const viewport = this.computeViewport(tr.getMeta('view') as EditorView);
            const active = this.shouldActivateVirtualScroll(newState.doc.textContent.length);

            if (!active) {
              return {
                ...value,
                active: false,
                decorations: DecorationSet.empty,
              };
            }

            // Create decorations for hidden content
            const decorations = this.createDecorations(newState.doc, viewport);

            return {
              viewport,
              decorations,
              lastUpdate: Date.now(),
              active: true,
              totalHeight: this.estimateTotalHeight(newState.doc),
            };
          },
        },

        props: {
          decorations(state) {
            const pluginState = virtualScrollKey.getState(state);
            return pluginState?.active ? pluginState.decorations : DecorationSet.empty;
          },

          handleScrollToSelection: (view) => {
            // Ensure selection is in viewport
            this.ensureSelectionInViewport(view);
            return false;
          },
        },

        view: (editorView) => {
          this.attachScrollListeners(editorView);

          return {
            update: (view, prevState) => {
              // Check if we should update viewport
              if (this.shouldUpdateViewport()) {
                this.scheduleViewportUpdate(view);
              }
            },

            destroy: () => {
              this.detachScrollListeners(editorView);
            },
          };
        },
      }),
    ];
  }

  /**
   * Create initial state
   */
  private createInitialState(): VirtualScrollState {
    return {
      viewport: {
        from: 0,
        to: 0,
        top: 0,
        bottom: 0,
        height: 0,
      },
      decorations: DecorationSet.empty,
      lastUpdate: Date.now(),
      active: false,
      totalHeight: 0,
    };
  }

  /**
   * Check if virtual scrolling should be activated
   */
  private shouldActivateVirtualScroll(documentSize: number): boolean {
    const minSize = this.config.minDocumentSize || 50000;
    return documentSize >= minSize;
  }

  /**
   * Compute current viewport
   */
  private computeViewport(view?: EditorView): Viewport {
    if (!view) {
      return {
        from: 0,
        to: 0,
        top: 0,
        bottom: 0,
        height: 0,
      };
    }

    const { dom } = view;
    const rect = dom.getBoundingClientRect();
    const scrollTop = dom.scrollTop;

    const lineHeight = this.config.estimatedLineHeight || 20;
    const bufferLines = this.config.bufferLines || 10;
    const bufferHeight = bufferLines * lineHeight;

    const viewport: Viewport = {
      from: 0,
      to: view.state.doc.content.size,
      top: Math.max(0, scrollTop - bufferHeight),
      bottom: scrollTop + rect.height + bufferHeight,
      height: rect.height,
    };

    // Convert pixel positions to document positions
    try {
      const topPos = view.posAtCoords({ left: rect.left, top: viewport.top });
      const bottomPos = view.posAtCoords({ left: rect.left, top: viewport.bottom });

      if (topPos) viewport.from = topPos.pos;
      if (bottomPos) viewport.to = bottomPos.pos;
    } catch {
      // Fallback to document bounds
    }

    return viewport;
  }

  /**
   * Create decorations for hidden content
   */
  private createDecorations(doc: any, viewport: Viewport): DecorationSet {
    const decorations: Decoration[] = [];

    // Hide content before viewport
    if (viewport.from > 0) {
      const height = this.estimateContentHeight(doc, 0, viewport.from);
      decorations.push(
        Decoration.widget(0, () => {
          const spacer = document.createElement('div');
          spacer.style.height = `${height}px`;
          spacer.className = 'virtual-scroll-spacer-before';
          return spacer;
        })
      );
    }

    // Hide content after viewport
    if (viewport.to < doc.content.size) {
      const height = this.estimateContentHeight(doc, viewport.to, doc.content.size);
      decorations.push(
        Decoration.widget(viewport.to, () => {
          const spacer = document.createElement('div');
          spacer.style.height = `${height}px`;
          spacer.className = 'virtual-scroll-spacer-after';
          return spacer;
        })
      );
    }

    return DecorationSet.create(doc, decorations);
  }

  /**
   * Estimate content height for a range
   */
  private estimateContentHeight(doc: any, from: number, to: number): number {
    const lineHeight = this.config.estimatedLineHeight || 20;

    // Count approximate lines
    let lines = 0;
    doc.nodesBetween(from, to, (node: any) => {
      if (node.isBlock) {
        lines++;
      }
    });

    return Math.max(lines, 1) * lineHeight;
  }

  /**
   * Estimate total document height
   */
  private estimateTotalHeight(doc: any): number {
    return this.estimateContentHeight(doc, 0, doc.content.size);
  }

  /**
   * Attach scroll listeners
   */
  private attachScrollListeners(view: EditorView): void {
    const { dom } = view;

    this.scrollListener = () => {
      this.scheduleViewportUpdate(view);
    };

    this.resizeListener = () => {
      this.scheduleViewportUpdate(view);
    };

    dom.addEventListener('scroll', this.scrollListener, { passive: true });
    window.addEventListener('resize', this.resizeListener, { passive: true });

    // Use ResizeObserver if available
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleViewportUpdate(view);
      });
      this.resizeObserver.observe(dom);
    }
  }

  /**
   * Detach scroll listeners
   */
  private detachScrollListeners(view: EditorView): void {
    const { dom } = view;

    if (this.scrollListener) {
      dom.removeEventListener('scroll', this.scrollListener);
    }

    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
  }

  /**
   * Check if viewport should be updated
   */
  private shouldUpdateViewport(): boolean {
    const state = virtualScrollKey.getState(this.context?.view?.state);
    if (!state) return false;

    const throttle = this.config.updateThrottle || 100;
    const elapsed = Date.now() - state.lastUpdate;

    return elapsed >= throttle;
  }

  /**
   * Schedule viewport update
   */
  private scheduleViewportUpdate(view: EditorView): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    const throttle = this.config.updateThrottle || 100;

    this.updateTimeout = setTimeout(() => {
      this.updateViewport(view);
    }, throttle);
  }

  /**
   * Update viewport
   */
  private updateViewport(view: EditorView): void {
    const tr = view.state.tr;
    tr.setMeta('virtualScrollUpdate', true);
    tr.setMeta('view', view);
    view.dispatch(tr);
  }

  /**
   * Ensure selection is in viewport
   */
  private ensureSelectionInViewport(view: EditorView): void {
    const state = virtualScrollKey.getState(view.state);
    if (!state?.active) return;

    const { from, to } = view.state.selection;
    const viewport = state.viewport;

    // Check if selection is outside viewport
    if (from < viewport.from || to > viewport.to) {
      // Scroll to selection
      const coords = view.coordsAtPos(from);
      if (coords) {
        const { dom } = view;
        const rect = dom.getBoundingClientRect();
        const scrollTop = coords.top - rect.top + dom.scrollTop - rect.height / 2;

        dom.scrollTop = scrollTop;
      }
    }
  }

  /**
   * Get current viewport state
   */
  getViewportState(): VirtualScrollState | undefined {
    return virtualScrollKey.getState(this.context?.view?.state);
  }

  /**
   * Force viewport update
   */
  forceUpdate(): void {
    if (this.context?.view) {
      this.updateViewport(this.context.view);
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(): {
    active: boolean;
    viewportSize: number;
    documentSize: number;
    visibleRatio: number;
  } | null {
    if (!this.config.monitoring) {
      return null;
    }

    const state = this.getViewportState();
    if (!state) {
      return null;
    }

    const viewportSize = state.viewport.to - state.viewport.from;
    const documentSize = this.context?.view?.state.doc.content.size || 0;

    return {
      active: state.active,
      viewportSize,
      documentSize,
      visibleRatio: documentSize > 0 ? viewportSize / documentSize : 0,
    };
  }

  onDestroy(): void {
    if (this.context?.view) {
      this.detachScrollListeners(this.context.view);
    }
  }
}
