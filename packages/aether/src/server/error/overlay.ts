/**
 * Error Overlay
 *
 * Browser error overlay for development
 */

import type { ErrorOverlayConfig, ErrorInfo } from '../types.js';

const OVERLAY_ID = '__aether_error_overlay__';

/**
 * Error Overlay Manager
 */
export class ErrorOverlay {
  private config: Required<ErrorOverlayConfig>;
  private container: HTMLElement | null = null;
  private isVisible = false;

  constructor(config: ErrorOverlayConfig = {}) {
    this.config = {
      position: 'center',
      theme: 'dark',
      showStack: true,
      showSource: true,
      openInEditor: true,
      editorUrl: 'vscode://file/{file}:{line}:{column}',
      ...config,
    };
  }

  /**
   * Show error overlay
   */
  show(error: ErrorInfo): void {
    if (this.isVisible) {
      this.hide();
    }

    this.container = this.createOverlay(error);
    document.body.appendChild(this.container);
    this.isVisible = true;

    // Focus for keyboard navigation
    this.container.focus();
  }

  /**
   * Hide error overlay
   */
  hide(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }

    this.isVisible = false;
  }

  /**
   * Create overlay DOM
   */
  private createOverlay(error: ErrorInfo): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.tabIndex = -1;
    overlay.style.cssText = this.getOverlayStyles();

    // Header
    const header = document.createElement('div');
    header.style.cssText = this.getHeaderStyles();
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: #ef4444; font-size: 20px;">⚠</span>
        <span style="font-weight: 600;">${this.getErrorTypeLabel(error.type)}</span>
      </div>
      <button
        id="${OVERLAY_ID}_close"
        style="${this.getButtonStyles()}"
        title="Close (Esc)"
      >×</button>
    `;

    // Body
    const body = document.createElement('div');
    body.style.cssText = this.getBodyStyles();

    // Error message
    const message = document.createElement('div');
    message.style.cssText = this.getMessageStyles();
    message.textContent = error.message;

    body.appendChild(message);

    // Stack trace
    if (this.config.showStack && error.stack) {
      const stack = document.createElement('pre');
      stack.style.cssText = this.getStackStyles();
      stack.textContent = this.formatStack(error.stack);
      body.appendChild(stack);
    }

    // Source code
    if (this.config.showSource && error.source && error.line) {
      const source = document.createElement('pre');
      source.style.cssText = this.getSourceStyles();
      source.innerHTML = this.formatSource(error.source, error.line);
      body.appendChild(source);
    }

    // Footer
    if (this.config.openInEditor && error.file) {
      const footer = document.createElement('div');
      footer.style.cssText = this.getFooterStyles();

      const openButton = document.createElement('button');
      openButton.textContent = 'Open in Editor';
      openButton.style.cssText = this.getActionButtonStyles();
      openButton.onclick = () => this.openInEditor(error);

      footer.appendChild(openButton);
      overlay.appendChild(footer);
    }

    overlay.appendChild(header);
    overlay.appendChild(body);

    // Event listeners
    this.attachEventListeners(overlay);

    return overlay;
  }

  /**
   * Attach event listeners
   */
  private attachEventListeners(overlay: HTMLElement): void {
    // Close button
    const closeBtn = overlay.querySelector(`#${OVERLAY_ID}_close`);
    closeBtn?.addEventListener('click', () => this.hide());

    // ESC key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide();
        document.removeEventListener('keydown', handleKeyDown);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Click outside
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.hide();
      }
    });
  }

  /**
   * Format stack trace
   */
  private formatStack(stack: string): string {
    return stack
      .split('\n')
      .filter((line) => !line.includes('node_modules'))
      .slice(0, 10)
      .join('\n');
  }

  /**
   * Format source code with line highlighting
   */
  private formatSource(source: string, errorLine: number): string {
    const lines = source.split('\n');
    const start = Math.max(0, errorLine - 3);
    const end = Math.min(lines.length, errorLine + 3);

    return lines
      .slice(start, end)
      .map((line, i) => {
        const lineNum = start + i + 1;
        const isError = lineNum === errorLine;
        const lineStyle = isError ? 'background: rgba(239, 68, 68, 0.1); color: #ef4444;' : '';

        return `<span style="${lineStyle}">${lineNum.toString().padStart(4, ' ')} | ${this.escapeHtml(line)}</span>`;
      })
      .join('\n');
  }

  /**
   * Open file in editor
   */
  private openInEditor(error: ErrorInfo): void {
    if (!error.file) return;

    const url = this.config.editorUrl
      .replace('{file}', error.file)
      .replace('{line}', String(error.line || 1))
      .replace('{column}', String(error.column || 1));

    // Try to open in editor
    window.location.href = url;
  }

  /**
   * Get error type label
   */
  private getErrorTypeLabel(type: ErrorInfo['type']): string {
    const labels: Record<ErrorInfo['type'], string> = {
      syntax: 'Syntax Error',
      runtime: 'Runtime Error',
      ssr: 'SSR Error',
      transform: 'Transform Error',
    };

    return labels[type] || 'Error';
  }

  /**
   * Escape HTML
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Styles =====

  private getOverlayStyles(): string {
    return `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: ${this.getAlignItems()};
      justify-content: ${this.getJustifyContent()};
      padding: 20px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
      font-size: 14px;
      color: ${this.config.theme === 'dark' ? '#e5e7eb' : '#1f2937'};
    `;
  }

  private getHeaderStyles(): string {
    return `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background: ${this.config.theme === 'dark' ? '#1f2937' : '#f3f4f6'};
      border-bottom: 1px solid ${this.config.theme === 'dark' ? '#374151' : '#d1d5db'};
    `;
  }

  private getBodyStyles(): string {
    return `
      padding: 16px;
      overflow: auto;
      max-height: 70vh;
      max-width: 900px;
      width: 100%;
      background: ${this.config.theme === 'dark' ? '#111827' : '#ffffff'};
      border-radius: 8px;
    `;
  }

  private getMessageStyles(): string {
    return `
      color: #ef4444;
      font-weight: 500;
      margin-bottom: 16px;
      line-height: 1.5;
    `;
  }

  private getStackStyles(): string {
    return `
      background: ${this.config.theme === 'dark' ? '#0f172a' : '#f9fafb'};
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
      margin-bottom: 16px;
    `;
  }

  private getSourceStyles(): string {
    return `
      background: ${this.config.theme === 'dark' ? '#0f172a' : '#f9fafb'};
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.6;
    `;
  }

  private getFooterStyles(): string {
    return `
      padding: 16px;
      background: ${this.config.theme === 'dark' ? '#1f2937' : '#f3f4f6'};
      border-top: 1px solid ${this.config.theme === 'dark' ? '#374151' : '#d1d5db'};
      display: flex;
      justify-content: flex-end;
    `;
  }

  private getButtonStyles(): string {
    return `
      background: transparent;
      border: none;
      color: ${this.config.theme === 'dark' ? '#9ca3af' : '#6b7280'};
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background 0.2s;
    `;
  }

  private getActionButtonStyles(): string {
    return `
      background: #3b82f6;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    `;
  }

  private getAlignItems(): string {
    return this.config.position === 'center' ? 'center' : 'flex-start';
  }

  private getJustifyContent(): string {
    if (this.config.position === 'top') return 'flex-start';
    if (this.config.position === 'bottom') return 'flex-end';
    return 'center';
  }
}

/**
 * Global error overlay instance
 */
let errorOverlay: ErrorOverlay | null = null;

/**
 * Initialize error overlay
 */
export function initErrorOverlay(config?: ErrorOverlayConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!errorOverlay) {
    errorOverlay = new ErrorOverlay(config);

    // Expose globally for HMR client
    (window as any).__AETHER_ERROR_OVERLAY__ = errorOverlay;

    // Handle unhandled errors
    window.addEventListener('error', (event) => {
      errorOverlay?.show({
        type: 'runtime',
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error?.stack,
      });
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      errorOverlay?.show({
        type: 'runtime',
        message: event.reason?.message || String(event.reason),
        stack: event.reason?.stack,
      });
    });
  }
}

/**
 * Get error overlay instance
 */
export function getErrorOverlay(): ErrorOverlay | null {
  return errorOverlay;
}

/**
 * Show error in overlay
 */
export function showError(error: ErrorInfo): void {
  if (!errorOverlay) {
    initErrorOverlay();
  }

  errorOverlay?.show(error);
}

/**
 * Hide error overlay
 */
export function hideError(): void {
  errorOverlay?.hide();
}
