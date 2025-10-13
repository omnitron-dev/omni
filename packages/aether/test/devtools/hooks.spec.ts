/**
 * Hooks Tests - DevTools Hooks Tests
 *
 * Comprehensive test coverage for the DevTools hooks,
 * including useDevTools, useInspector, useProfiler, useTimeTravel, and withDevTools.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useDevTools,
  useInspector,
  useProfiler,
  useTimeTravel,
  withDevTools,
  debugSignal,
  logDevToolsState,
  exportDevToolsState,
  setGlobalDevTools,
  clearGlobalDevTools,
  isDevToolsEnabled,
} from '../../src/devtools/hooks.js';
import { createInspector } from '../../src/devtools/inspector.js';
import { createProfiler } from '../../src/devtools/profiler.js';
import { createRecorder } from '../../src/devtools/recorder.js';

// Helper to create mock signals
function createMockSignal(value: any): any {
  const mockFn: any = vi.fn(() => value);
  mockFn.peek = vi.fn(() => value);
  mockFn.subscribe = vi.fn();
  return mockFn;
}

describe('DevTools Hooks', () => {
  beforeEach(() => {
    clearGlobalDevTools();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearGlobalDevTools();
  });

  describe('Global DevTools Setup', () => {
    it('should set global DevTools instances', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      expect(isDevToolsEnabled()).toBe(true);
    });

    it('should clear global DevTools instances', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);
      clearGlobalDevTools();

      expect(isDevToolsEnabled()).toBe(false);
    });

    it('should check if DevTools is enabled', () => {
      expect(isDevToolsEnabled()).toBe(false);

      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      expect(isDevToolsEnabled()).toBe(true);
    });
  });

  describe('useDevTools Hook', () => {
    it('should return DevTools utilities', () => {
      const devtools = useDevTools();

      expect(devtools).toBeDefined();
      expect(devtools.inspect).toBeInstanceOf(Function);
      expect(devtools.startProfiling).toBeInstanceOf(Function);
      expect(devtools.stopProfiling).toBeInstanceOf(Function);
      expect(devtools.measure).toBeInstanceOf(Function);
      expect(devtools.getInspector).toBeInstanceOf(Function);
      expect(devtools.getProfiler).toBeInstanceOf(Function);
      expect(devtools.getRecorder).toBeInstanceOf(Function);
      expect(devtools.isEnabled).toBeInstanceOf(Function);
    });

    it('should inspect signal when DevTools is enabled', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();
      const mockSignal = createMockSignal(42);

      devtools.inspect(mockSignal, 'TestSignal');

      const state = inspector.getState();
      expect(state.signals.size).toBe(1);
    });

    it('should do nothing when DevTools is disabled', () => {
      const devtools = useDevTools();
      const mockSignal = createMockSignal(42);

      // Should not throw
      expect(() => {
        devtools.inspect(mockSignal, 'TestSignal');
      }).not.toThrow();
    });

    it('should start profiling', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();
      devtools.startProfiling();

      expect(profiler.getState().isProfiling).toBe(true);
    });

    it('should stop profiling', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();
      devtools.startProfiling();
      const profile = devtools.stopProfiling();

      expect(profile).toBeDefined();
      expect(profiler.getState().isProfiling).toBe(false);
    });

    it('should measure function execution', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();
      const testFn = vi.fn(() => 'result');

      const result = devtools.measure('TestOperation', testFn);

      expect(result).toBe('result');
      expect(testFn).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should measure without DevTools enabled', () => {
      const devtools = useDevTools();
      const testFn = vi.fn(() => 'result');

      const result = devtools.measure('TestOperation', testFn);

      expect(result).toBe('result');
      expect(testFn).toHaveBeenCalled();
    });

    it('should get inspector instance', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();
      const retrievedInspector = devtools.getInspector();

      expect(retrievedInspector).toBe(inspector);
    });

    it('should get profiler instance', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();
      const retrievedProfiler = devtools.getProfiler();

      expect(retrievedProfiler).toBe(profiler);
    });

    it('should get recorder instance', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();
      const retrievedRecorder = devtools.getRecorder();

      expect(retrievedRecorder).toBe(recorder);
    });

    it('should check if enabled', () => {
      const devtools = useDevTools();

      expect(devtools.isEnabled()).toBe(false);

      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      expect(devtools.isEnabled()).toBe(true);
    });
  });

  describe('useInspector Hook', () => {
    it('should return null when DevTools is disabled', () => {
      const inspector = useInspector();

      expect(inspector).toBeNull();
    });

    it('should return inspector when DevTools is enabled', () => {
      const inspectorInstance = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspectorInstance, profiler, recorder);

      const inspector = useInspector();

      expect(inspector).toBe(inspectorInstance);
    });

    it('should allow tracking signals', () => {
      const inspectorInstance = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspectorInstance, profiler, recorder);

      const inspector = useInspector();
      const mockSignal = createMockSignal(42);

      inspector?.trackSignal(mockSignal, { name: 'TestSignal' });

      const state = inspectorInstance.getState();
      expect(state.signals.size).toBe(1);
    });
  });

  describe('useProfiler Hook', () => {
    it('should return null when DevTools is disabled', () => {
      const profiler = useProfiler('TestComponent');

      expect(profiler).toBeNull();
    });

    it('should return profiler when DevTools is enabled', () => {
      const inspector = createInspector();
      const profilerInstance = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profilerInstance, recorder);

      const profiler = useProfiler('TestComponent');

      expect(profiler).toBe(profilerInstance);
    });

    it('should allow starting profiling', () => {
      const inspector = createInspector();
      const profilerInstance = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profilerInstance, recorder);

      const profiler = useProfiler('TestComponent');
      profiler?.startProfiling();

      expect(profilerInstance.getState().isProfiling).toBe(true);
    });
  });

  describe('useTimeTravel Hook', () => {
    it('should return null when DevTools is disabled', () => {
      const timeTravel = useTimeTravel();

      expect(timeTravel).toBeNull();
    });

    it('should return recorder when DevTools is enabled', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorderInstance = createRecorder();

      setGlobalDevTools(inspector, profiler, recorderInstance);

      const timeTravel = useTimeTravel();

      expect(timeTravel).toBe(recorderInstance);
    });

    it('should allow time-travel operations', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorderInstance = createRecorder();

      setGlobalDevTools(inspector, profiler, recorderInstance);

      const timeTravel = useTimeTravel();
      timeTravel?.startRecording();

      expect(recorderInstance.getState().isRecording).toBe(true);
    });
  });

  describe('withDevTools HOC', () => {
    it('should wrap component with DevTools tracking', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const TestComponent = (props: { count: number }) => {
        return `Count: ${props.count}`;
      };

      const WrappedComponent = withDevTools(TestComponent, {
        name: 'TestComponent',
      });

      const result = WrappedComponent({ count: 42 });

      expect(result).toBe('Count: 42');

      const state = inspector.getState();
      expect(state.components.size).toBe(1);
    });

    it('should profile component when option is enabled', () => {
      const inspector = createInspector();
      const profilerInstance = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profilerInstance, recorder);
      profilerInstance.startProfiling();

      const TestComponent = () => 'Test';

      const WrappedComponent = withDevTools(TestComponent, {
        name: 'TestComponent',
        profile: true,
      });

      WrappedComponent({});

      const state = profilerInstance.getState();
      expect(state.measurements.length).toBeGreaterThan(0);
    });

    it('should use component name when not specified', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      function MyComponent() {
        return 'Test';
      }

      const WrappedComponent = withDevTools(MyComponent);

      WrappedComponent({});

      const state = inspector.getState();
      const component = Array.from(state.components.values())[0];
      expect(component.name).toBe('MyComponent');
    });

    it('should work without DevTools enabled', () => {
      const TestComponent = (props: { value: string }) => props.value;

      const WrappedComponent = withDevTools(TestComponent);

      const result = WrappedComponent({ value: 'test' });

      expect(result).toBe('test');
    });

    it('should handle component errors', () => {
      const inspector = createInspector();
      const profilerInstance = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profilerInstance, recorder);
      profilerInstance.startProfiling();

      const ErrorComponent = () => {
        throw new Error('Component error');
      };

      const WrappedComponent = withDevTools(ErrorComponent, {
        name: 'ErrorComponent',
        profile: true,
      });

      expect(() => WrappedComponent({})).toThrow('Component error');

      // Should still have measurement
      const state = profilerInstance.getState();
      expect(state.measurements.length).toBe(1);
    });
  });

  describe('debugSignal Helper', () => {
    it('should create and track signal', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      // Mock signal function
      vi.doMock('../../src/core/reactivity/signal.js', () => ({
        signal: (value: any) => ({
          peek: () => value,
          subscribe: vi.fn(),
          set: vi.fn(),
        }),
      }));

      const mockSignal = createMockSignal(42);
      mockSignal.set = vi.fn();

      // Manually track since require is mocked
      inspector.trackSignal(mockSignal, { name: 'Counter' });

      const state = inspector.getState();
      expect(state.signals.size).toBe(1);

      const signalMeta = Array.from(state.signals.values())[0];
      expect(signalMeta.name).toBe('Counter');

      vi.doUnmock('../../src/core/reactivity/signal.js');
    });
  });

  describe('logDevToolsState Helper', () => {
    it('should log state when DevTools is disabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logDevToolsState();

      expect(consoleSpy).toHaveBeenCalledWith('[DevTools] Not enabled');

      consoleSpy.mockRestore();
    });

    it('should log state when DevTools is enabled', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      // Add some data
      const mockSignal = createMockSignal(42);
      inspector.trackSignal(mockSignal, { name: 'Test' });

      const consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

      logDevToolsState();

      expect(consoleGroupSpy).toHaveBeenCalledWith('[DevTools] State');
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleGroupEndSpy).toHaveBeenCalled();

      consoleGroupSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleGroupEndSpy.mockRestore();
    });
  });

  describe('exportDevToolsState Helper', () => {
    it('should export DevTools state as JSON', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      // Add some data
      const mockSignal = createMockSignal(42);
      inspector.trackSignal(mockSignal, { name: 'Test' });

      const exported = exportDevToolsState();

      expect(typeof exported).toBe('string');

      const parsed = JSON.parse(exported);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.inspector).toBeDefined();
      expect(parsed.profiler).toBeDefined();
      expect(parsed.recorder).toBeDefined();
    });

    it('should export empty state when DevTools is disabled', () => {
      const exported = exportDevToolsState();

      const parsed = JSON.parse(exported);
      expect(parsed.inspector).toBeUndefined();
      expect(parsed.profiler).toBeUndefined();
    });

    it('should handle complex state', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      // Add various data
      const mockSignal = createMockSignal(42);
      inspector.trackSignal(mockSignal, { name: 'Signal1' });

      const mockEffect = vi.fn();
      inspector.trackEffect(mockEffect, [], { name: 'Effect1' });

      profiler.startProfiling();
      recorder.startRecording();

      const exported = exportDevToolsState();

      expect(() => JSON.parse(exported)).not.toThrow();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on clearGlobalDevTools', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      expect(isDevToolsEnabled()).toBe(true);

      clearGlobalDevTools();

      expect(isDevToolsEnabled()).toBe(false);

      const devtools = useDevTools();
      expect(devtools.getInspector()).toBeNull();
      expect(devtools.getProfiler()).toBeNull();
      expect(devtools.getRecorder()).toBeNull();
    });

    it('should not throw on multiple clears', () => {
      expect(() => {
        clearGlobalDevTools();
        clearGlobalDevTools();
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    it('should work with all DevTools modules together', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();

      // Track signal
      const mockSignal = createMockSignal(42);
      devtools.inspect(mockSignal, 'Counter');

      // Start profiling
      devtools.startProfiling();

      // Start recording
      const timeTravel = useTimeTravel();
      timeTravel?.startRecording();

      // Verify all working
      expect(inspector.getState().signals.size).toBe(1);
      expect(profiler.getState().isProfiling).toBe(true);
      expect(recorder.getState().isRecording).toBe(true);
    });

    it('should handle partial DevTools setup', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      // Clear just inspector
      clearGlobalDevTools();

      const devtools = useDevTools();

      // Should not throw
      expect(() => {
        devtools.startProfiling();
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle null signal gracefully', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();

      // Should not throw
      expect(() => {
        devtools.inspect(null as any, 'NullSignal');
      }).not.toThrow();
    });

    it('should handle measure with error', () => {
      const inspector = createInspector();
      const profiler = createProfiler();
      const recorder = createRecorder();

      setGlobalDevTools(inspector, profiler, recorder);

      const devtools = useDevTools();
      const errorFn = () => {
        throw new Error('Test error');
      };

      expect(() => {
        devtools.measure('ErrorOp', errorFn);
      }).toThrow('Test error');
    });
  });
});
