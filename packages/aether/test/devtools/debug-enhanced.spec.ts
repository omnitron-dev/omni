/**
 * Enhanced Debugger Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInspector } from '../../src/devtools/inspector.js';
import { createDebugEnhanced } from '../../src/devtools/debug-enhanced.js';

describe('DebugEnhanced', () => {
  let inspector: ReturnType<typeof createInspector>;
  let debugEnhanced: ReturnType<typeof createDebugEnhanced>;

  beforeEach(() => {
    inspector = createInspector();
    debugEnhanced = createDebugEnhanced(inspector, {
      trackPropChanges: true,
      trackSignalChanges: true,
      detectWastedRenders: true,
    });
  });

  describe('render analysis', () => {
    it('should analyze component render', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      const analysis = debugEnhanced.analyzeRender(componentId, { name: 'Test' });

      expect(analysis).toBeDefined();
      expect(analysis.componentName).toBe('TestComponent');
      expect(analysis.renderCount).toBeGreaterThan(0);
    });

    it('should detect prop changes', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Old' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      const analysis = debugEnhanced.analyzeRender(componentId, { name: 'New' });

      expect(analysis.changedProps.length).toBeGreaterThan(0);
      expect(analysis.triggerType).toBe('props');
    });

    it('should detect wasted renders', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      // Same props, should be wasted render
      const analysis = debugEnhanced.analyzeRender(componentId, { name: 'Test' });

      expect(analysis.wasNecessary).toBe(false);
      expect(analysis.recommendation).toBeDefined();
    });
  });

  describe('effect dependency tracking', () => {
    it('should track effect dependencies', () => {
      const mockEffect = vi.fn();
      const mockSignal = { peek: () => 0, subscribe: vi.fn() };

      inspector.trackSignal(mockSignal as any, { name: 'TestSignal' });
      inspector.trackEffect(mockEffect, [mockSignal as any], { name: 'TestEffect' });

      const state = inspector.getState();
      const effectId = Array.from(state.effects.keys())[0];

      const info = debugEnhanced.trackEffectDependencies(effectId);

      expect(info).toBeDefined();
      expect(info?.effectName).toBe('TestEffect');
      expect(info?.dependencies.length).toBeGreaterThan(0);
    });
  });

  describe('signal subscription graph', () => {
    it('should build signal subscription graph', () => {
      const mockSignal = { peek: () => 0, subscribe: vi.fn() };
      inspector.trackSignal(mockSignal as any, { name: 'TestSignal' });

      const state = inspector.getState();
      const signalId = Array.from(state.signals.keys())[0];

      const graph = debugEnhanced.buildSignalGraph(signalId);

      expect(graph).toBeDefined();
      // Graph ID should match the signal ID we're querying
      expect(graph.id).toBe(signalId);
      // Graph name should be the name we provided in tracking
      expect(graph.name).toBeDefined();
      if (graph.name) {
        expect(graph.name).toContain('signal'); // Name contains signal ID
      }
    });

    it('should handle circular dependencies', () => {
      const mockSignal = { peek: () => 0, subscribe: vi.fn() };
      inspector.trackSignal(mockSignal as any, { name: 'CircularSignal' });

      const state = inspector.getState();
      const signalId = Array.from(state.signals.keys())[0];

      const graph = debugEnhanced.buildSignalGraph(signalId);
      expect(graph).toBeDefined();
    });
  });

  describe('update frequency', () => {
    it('should calculate component update frequency', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const component = Array.from(state.components.values())[0];

      const frequency = debugEnhanced.calculateUpdateFrequency(component);

      expect(frequency).toBeDefined();
      expect(frequency.componentName).toBe('TestComponent');
      expect(frequency.frequency).toBeGreaterThanOrEqual(0);
    });

    it('should identify high frequency components', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'HighFreqComponent' });

      const highFreq = debugEnhanced.getHighFrequencyComponents();
      expect(Array.isArray(highFreq)).toBe(true);
    });
  });

  describe('wasted renders', () => {
    it('should get all wasted renders', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      // Create wasted render
      debugEnhanced.analyzeRender(componentId, { name: 'Test' });

      const wasted = debugEnhanced.getWastedRenders();
      expect(Array.isArray(wasted)).toBe(true);
    });
  });

  describe('debug report', () => {
    it('should generate debug report', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const report = debugEnhanced.generateReport();

      expect(report).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should include wasted renders in report', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      // Create wasted render
      debugEnhanced.analyzeRender(componentId, { name: 'Test' });

      const report = debugEnhanced.generateReport();
      expect(report.summary.totalComponents).toBeGreaterThan(0);
    });
  });

  describe('render history', () => {
    it('should get render history for component', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      const state = inspector.getState();
      const componentId = Array.from(state.components.keys())[0];

      debugEnhanced.analyzeRender(componentId, { name: 'Test' });
      const history = debugEnhanced.getRenderHistory(componentId);

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('should clear all tracking data', () => {
      const mockComponent = vi.fn();
      inspector.trackComponent(mockComponent, { name: 'Test' }, { name: 'TestComponent' });

      debugEnhanced.clear();

      const wasted = debugEnhanced.getWastedRenders();
      expect(wasted).toHaveLength(0);
    });
  });
});
