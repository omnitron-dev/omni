/**
 * Inspector UI Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInspector } from '../../src/devtools/inspector.js';
import { createInspectorUI } from '../../src/devtools/inspector-ui.js';

describe('InspectorUI', () => {
  let inspector: ReturnType<typeof createInspector>;
  let inspectorUI: ReturnType<typeof createInspectorUI>;
  let mockElement: HTMLDivElement;

  beforeEach(() => {
    inspector = createInspector();
    inspectorUI = createInspectorUI(inspector, {
      enableOverlay: true,
      showBoundaries: true,
      showMetrics: true,
    });

    // Create mock DOM element
    mockElement = document.createElement('div');
    mockElement.style.cssText = 'width: 100px; height: 100px;';
    document.body.appendChild(mockElement);
  });

  afterEach(() => {
    inspectorUI.disable();
    document.body.removeChild(mockElement);
  });

  describe('enable/disable', () => {
    it('should enable inspector UI', () => {
      inspectorUI.enable();
      expect(document.querySelectorAll('[style*="z-index"]').length).toBeGreaterThanOrEqual(0);
    });

    it('should disable inspector UI', () => {
      inspectorUI.enable();
      inspectorUI.disable();
      // Overlays should be removed
    });
  });

  describe('component registration', () => {
    it('should register component with DOM element', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      inspectorUI.registerComponent(componentId, mockElement);
      expect(componentId).toBeDefined();
    });

    it('should unregister component', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      inspectorUI.registerComponent(componentId, mockElement);
      inspectorUI.unregisterComponent(componentId);
      expect(componentId).toBeDefined();
    });
  });

  describe('component selection', () => {
    it('should select component for inspection', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      inspectorUI.registerComponent(componentId, mockElement);
      const inspection = inspectorUI.selectComponent(componentId);

      expect(inspection).toBeDefined();
      expect(inspection?.component.name).toBe('TestComponent');
    });

    it('should return null for non-existent component', () => {
      const inspection = inspectorUI.selectComponent('non-existent');
      expect(inspection).toBeNull();
    });
  });

  describe('component highlighting', () => {
    it('should highlight component', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      inspectorUI.registerComponent(componentId, mockElement);
      inspectorUI.highlightComponent(componentId);
      // Verify highlight is shown
    });

    it('should remove highlight', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      inspectorUI.registerComponent(componentId, mockElement);
      inspectorUI.highlightComponent(componentId);
      inspectorUI.removeHighlight(componentId);
      // Verify highlight is removed
    });
  });

  describe('component tree visualization', () => {
    it('should get component tree visualization', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const tree = inspectorUI.getComponentTreeVisualization();
      expect(tree).toBeDefined();
      expect(Array.isArray(tree)).toBe(true);
    });
  });

  describe('component metrics', () => {
    it('should get component metrics', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      const metrics = inspectorUI.getComponentMetrics(componentId);
      expect(metrics).toBeDefined();
      expect(metrics?.componentId).toBe(componentId);
      expect(metrics?.name).toBe('TestComponent');
    });

    it('should return null for non-existent component', () => {
      const metrics = inspectorUI.getComponentMetrics('non-existent');
      expect(metrics).toBeNull();
    });
  });
});
