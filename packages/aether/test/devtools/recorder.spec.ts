/**
 * Recorder Tests - Time-Travel Debugging Tests
 *
 * Comprehensive test coverage for the DevTools time-travel recorder,
 * including state mutation recording, history management, and undo/redo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRecorder } from '../../src/devtools/recorder.js';
import type { Recorder, HistoryEntry } from '../../src/devtools/types.js';

describe('DevTools Recorder', () => {
  let recorder: Recorder;

  beforeEach(() => {
    recorder = createRecorder();
    vi.clearAllMocks();
  });

  afterEach(() => {
    recorder.clear();
  });

  describe('Recording State Mutations', () => {
    it('should start recording', () => {
      recorder.startRecording();

      const state = recorder.getState();
      expect(state.isRecording).toBe(true);
      expect(state.sessionStartTime).toBeGreaterThan(0);
    });

    it('should stop recording', () => {
      recorder.startRecording();
      recorder.stopRecording();

      const state = recorder.getState();
      expect(state.isRecording).toBe(false);
    });

    it('should not double-start recording', () => {
      recorder.startRecording();
      const firstStartTime = recorder.getState().sessionStartTime;

      recorder.startRecording();
      const secondStartTime = recorder.getState().sessionStartTime;

      expect(firstStartTime).toBe(secondStartTime);
    });

    it('should record signal mutation', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'Increment counter');

      const history = recorder.getHistory();
      expect(history.length).toBe(1);

      const entry = history[0];
      expect(entry.type).toBe('signal');
      expect(entry.targetId).toBe('signal-1');
      expect(entry.prevValue).toBe(0);
      expect(entry.newValue).toBe(1);
      expect(entry.description).toBe('Increment counter');
    });

    it('should record store mutation', () => {
      recorder.startRecording();

      (recorder as any).record('store', 'store-1', { count: 0 }, { count: 1 }, 'Update store');

      const history = recorder.getHistory();
      expect(history.length).toBe(1);

      const entry = history[0];
      expect(entry.type).toBe('store');
      expect(entry.prevValue.count).toBe(0);
      expect(entry.newValue.count).toBe(1);
    });

    it('should record effect execution', () => {
      recorder.startRecording();

      (recorder as any).record('effect', 'effect-1', null, null, 'Effect executed');

      const history = recorder.getHistory();
      expect(history.length).toBe(1);

      const entry = history[0];
      expect(entry.type).toBe('effect');
      expect(entry.description).toBe('Effect executed');
    });

    it('should not record when not recording', () => {
      (recorder as any).record('signal', 'signal-1', 0, 1, 'Should not record');

      const history = recorder.getHistory();
      expect(history.length).toBe(0);
    });

    it('should include stack trace in entries', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'Test');

      const history = recorder.getHistory();
      expect(history[0].stack).toBeDefined();
      expect(typeof history[0].stack).toBe('string');
    });

    it('should record multiple mutations', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'Mutation 1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'Mutation 2');
      (recorder as any).record('signal', 'signal-2', 'a', 'b', 'Mutation 3');

      const history = recorder.getHistory();
      expect(history.length).toBe(3);
    });
  });

  describe('History Management', () => {
    it('should maintain current index', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');

      const state = recorder.getState();
      expect(state.currentIndex).toBe(1); // 0-indexed, so 1 means 2 entries
    });

    it('should truncate future history on new mutation', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');
      (recorder as any).record('signal', 'signal-1', 2, 3, 'M3');

      // Undo twice
      recorder.undo();
      recorder.undo();

      // Now record a new mutation - this should truncate M3
      (recorder as any).record('signal', 'signal-1', 1, 10, 'New M2');

      const history = recorder.getHistory();
      expect(history.length).toBe(2);
      expect(history[1].newValue).toBe(10);
    });

    it('should enforce max history size', () => {
      const smallRecorder = createRecorder(5);
      smallRecorder.startRecording();

      for (let i = 0; i < 10; i++) {
        (smallRecorder as any).record('signal', 'signal-1', i, i + 1, `Mutation ${i}`);
      }

      const history = smallRecorder.getHistory();
      expect(history.length).toBeLessThanOrEqual(5);

      smallRecorder.clear();
    });

    it('should handle empty history', () => {
      const history = recorder.getHistory();
      expect(history).toEqual([]);
    });

    it('should return copy of history', () => {
      recorder.startRecording();
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      const history1 = recorder.getHistory();
      const history2 = recorder.getHistory();

      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe('Undo/Redo Operations', () => {
    it('should undo last mutation', () => {
      const restoreCallback = vi.fn();

      recorder.startRecording();
      (recorder as any).registerRestoreCallback('signal-1', restoreCallback);

      (recorder as any).record('signal', 'signal-1', 0, 1, 'Increment');

      recorder.undo();

      expect(restoreCallback).toHaveBeenCalledWith(0);
      expect(recorder.getState().currentIndex).toBe(-1);
    });

    it('should redo after undo', () => {
      const restoreCallback = vi.fn();

      recorder.startRecording();
      (recorder as any).registerRestoreCallback('signal-1', restoreCallback);

      (recorder as any).record('signal', 'signal-1', 0, 1, 'Increment');

      recorder.undo();
      restoreCallback.mockClear();

      recorder.redo();

      expect(restoreCallback).toHaveBeenCalledWith(1);
      expect(recorder.getState().currentIndex).toBe(0);
    });

    it('should not undo past beginning', () => {
      recorder.startRecording();

      recorder.undo(); // Should do nothing

      expect(recorder.getState().currentIndex).toBe(-1);
    });

    it('should not redo beyond end', () => {
      recorder.startRecording();
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      recorder.redo(); // Should do nothing

      expect(recorder.getState().currentIndex).toBe(0);
    });

    it('should handle multiple undo/redo', () => {
      const restoreCallback = vi.fn();

      recorder.startRecording();
      (recorder as any).registerRestoreCallback('signal-1', restoreCallback);

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');
      (recorder as any).record('signal', 'signal-1', 2, 3, 'M3');

      recorder.undo();
      recorder.undo();

      expect(recorder.getState().currentIndex).toBe(0);

      recorder.redo();

      expect(recorder.getState().currentIndex).toBe(1);
    });

    it('should not call callback if not registered', () => {
      recorder.startRecording();
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      // Should not throw
      expect(() => recorder.undo()).not.toThrow();
    });
  });

  describe('Jump to State', () => {
    it('should jump to specific state index', () => {
      const restoreCallback = vi.fn();

      recorder.startRecording();
      (recorder as any).registerRestoreCallback('signal-1', restoreCallback);

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');
      (recorder as any).record('signal', 'signal-1', 2, 3, 'M3');

      recorder.jumpToState(1);

      expect(recorder.getState().currentIndex).toBe(1);
    });

    it('should throw on invalid index', () => {
      recorder.startRecording();
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      expect(() => recorder.jumpToState(-1)).toThrow('Invalid history index');
      expect(() => recorder.jumpToState(10)).toThrow('Invalid history index');
    });

    it('should do nothing if jumping to current index', () => {
      recorder.startRecording();
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      const currentIndex = recorder.getState().currentIndex;

      recorder.jumpToState(currentIndex);

      expect(recorder.getState().currentIndex).toBe(currentIndex);
    });

    it('should jump forward through history', () => {
      const restoreCallback = vi.fn();

      recorder.startRecording();
      (recorder as any).registerRestoreCallback('signal-1', restoreCallback);

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');
      (recorder as any).record('signal', 'signal-1', 2, 3, 'M3');

      // Go back to start
      recorder.jumpToState(0);

      // Jump forward to index 2
      restoreCallback.mockClear();
      recorder.jumpToState(2);

      expect(recorder.getState().currentIndex).toBe(2);
    });

    it('should jump backward through history', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');
      (recorder as any).record('signal', 'signal-1', 2, 3, 'M3');

      recorder.jumpToState(0);

      expect(recorder.getState().currentIndex).toBe(0);
    });
  });

  describe('State Diffing', () => {
    it('should diff two states', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-2', 'a', 'b', 'M2');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M3');

      const diff = recorder.diff(0, 2);

      expect(diff.changes.length).toBeGreaterThan(0);
      expect(diff.timestampA).toBeDefined();
      expect(diff.timestampB).toBeDefined();
    });

    it('should throw on invalid diff indices', () => {
      recorder.startRecording();
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      expect(() => recorder.diff(-1, 0)).toThrow('Invalid history index A');
      expect(() => recorder.diff(0, 10)).toThrow('Invalid history index B');
    });

    it('should handle empty diff', () => {
      recorder.startRecording();
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      const diff = recorder.diff(0, 0);

      expect(diff.changes.length).toBe(1);
    });

    it('should identify changes between states', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');

      const diff = recorder.diff(0, 1);

      expect(diff.changes.length).toBeGreaterThan(0);
      const change = diff.changes[0];
      expect(change.type).toBe('changed');
      expect(change.path).toBe('signal-1');
    });
  });

  describe('Session Export/Import', () => {
    it('should export session to JSON', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');

      const exported = recorder.exportSession();

      expect(typeof exported).toBe('string');

      const parsed = JSON.parse(exported);
      expect(parsed.version).toBeDefined();
      expect(parsed.history).toBeDefined();
      expect(parsed.history.length).toBe(2);
    });

    it('should import session from JSON', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');

      const exported = recorder.exportSession();

      const newRecorder = createRecorder();
      newRecorder.importSession(exported);

      const history = newRecorder.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].newValue).toBe(1);
      expect(history[1].newValue).toBe(2);

      newRecorder.clear();
    });

    it('should throw on invalid import data', () => {
      expect(() => {
        recorder.importSession('invalid json');
      }).toThrow('Failed to import session');

      expect(() => {
        recorder.importSession('{}');
      }).toThrow('Failed to import session');
    });

    it('should handle empty session export', () => {
      recorder.startRecording();

      const exported = recorder.exportSession();
      const parsed = JSON.parse(exported);

      expect(parsed.history).toEqual([]);
    });

    it('should preserve current index on export/import', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');

      recorder.undo();

      const exported = recorder.exportSession();

      const newRecorder = createRecorder();
      newRecorder.importSession(exported);

      expect(newRecorder.getState().currentIndex).toBe(0);

      newRecorder.clear();
    });
  });

  describe('Cleanup and Memory Management', () => {
    it('should clear history', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');

      recorder.clear();

      const history = recorder.getHistory();
      expect(history.length).toBe(0);

      const state = recorder.getState();
      expect(state.currentIndex).toBe(-1);
    });

    it('should clear restore callbacks', () => {
      const callback = vi.fn();

      recorder.startRecording();
      (recorder as any).registerRestoreCallback('signal-1', callback);
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      recorder.clear();

      // Try to undo - callback should not be called
      recorder.undo();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle large history efficiently', () => {
      const largeRecorder = createRecorder(10000);
      largeRecorder.startRecording();

      for (let i = 0; i < 5000; i++) {
        (largeRecorder as any).record('signal', 'signal-1', i, i + 1, `M${i}`);
      }

      const history = largeRecorder.getHistory();
      expect(history.length).toBe(5000);

      largeRecorder.clear();

      const clearedHistory = largeRecorder.getHistory();
      expect(clearedHistory.length).toBe(0);
    });

    it('should reset on start recording', () => {
      recorder.startRecording();
      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');

      recorder.startRecording(); // Start again

      const history = recorder.getHistory();
      expect(history.length).toBe(0);
    });
  });

  describe('Deep Clone', () => {
    it('should deep clone values', () => {
      recorder.startRecording();

      const obj = { nested: { value: 42 } };
      (recorder as any).record('store', 'store-1', obj, { nested: { value: 100 } }, 'Update');

      // Modify original
      obj.nested.value = 999;

      const history = recorder.getHistory();
      // Recorded value should not be affected
      expect(history[0].prevValue.nested.value).toBe(42);
    });

    it('should handle unserializable values', () => {
      recorder.startRecording();

      const circular: any = { a: 1 };
      circular.self = circular;

      // Should not throw
      expect(() => {
        (recorder as any).record('signal', 'signal-1', circular, circular, 'Circular');
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', null, 'value', 'Null to value');

      const history = recorder.getHistory();
      expect(history[0].prevValue).toBeNull();
    });

    it('should handle undefined values', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', undefined, 'value', 'Undefined to value');

      const history = recorder.getHistory();
      expect(history[0].prevValue).toBeUndefined();
    });

    it('should handle complex nested objects', () => {
      recorder.startRecording();

      const complex = {
        users: [
          { id: 1, name: 'Alice', meta: { age: 30 } },
          { id: 2, name: 'Bob', meta: { age: 25 } },
        ],
        settings: {
          theme: 'dark',
          notifications: { email: true, push: false },
        },
      };

      (recorder as any).record('store', 'store-1', {}, complex, 'Complex update');

      const history = recorder.getHistory();
      expect(history[0].newValue.users[0].name).toBe('Alice');
      expect(history[0].newValue.settings.theme).toBe('dark');
    });

    it('should maintain unique entry IDs', () => {
      recorder.startRecording();

      (recorder as any).record('signal', 'signal-1', 0, 1, 'M1');
      (recorder as any).record('signal', 'signal-1', 1, 2, 'M2');

      const history = recorder.getHistory();
      expect(history[0].id).not.toBe(history[1].id);
    });
  });
});
