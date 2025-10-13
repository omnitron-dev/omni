/**
 * Time-Travel Debugger Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRecorder } from '../../src/devtools/recorder.js';
import { createTimeTravelDebugger } from '../../src/devtools/time-travel.js';

describe('TimeTravelDebugger', () => {
  let recorder: ReturnType<typeof createRecorder>;
  let timeTravel: ReturnType<typeof createTimeTravelDebugger>;

  beforeEach(() => {
    recorder = createRecorder();
    timeTravel = createTimeTravelDebugger(recorder, {
      autoSnapshot: false, // Disable auto-snapshot for testing
      enableActionLog: true,
      enableBreakpoints: true,
    });
    recorder.startRecording();
  });

  describe('snapshot management', () => {
    it('should take manual snapshot', () => {
      const snapshot = timeTravel.takeSnapshot('Test snapshot', ['tag1']);

      expect(snapshot).toBeDefined();
      expect(snapshot.description).toBe('Test snapshot');
      expect(snapshot.tags).toContain('tag1');
    });

    it('should get all snapshots', () => {
      timeTravel.takeSnapshot('Snapshot 1');
      timeTravel.takeSnapshot('Snapshot 2');

      const snapshots = timeTravel.getSnapshots();
      expect(snapshots).toHaveLength(2);
    });

    it('should delete snapshot', () => {
      const snapshot = timeTravel.takeSnapshot('Test');
      timeTravel.deleteSnapshot(snapshot.id);

      const snapshots = timeTravel.getSnapshots();
      expect(snapshots).toHaveLength(0);
    });
  });

  describe('action logging', () => {
    it('should log actions', () => {
      timeTravel.undo();
      timeTravel.redo();

      const log = timeTravel.getActionLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log.some((entry) => entry.action === 'undo')).toBe(true);
    });

    it('should clear action log', () => {
      timeTravel.undo();
      timeTravel.clearActionLog();

      const log = timeTravel.getActionLog();
      expect(log).toHaveLength(0);
    });
  });

  describe('session export/import', () => {
    it('should export debug session', () => {
      recorder.record('signal', 'sig-1', 0, 1, 'Value changed');
      timeTravel.takeSnapshot('Test snapshot');

      const session = timeTravel.exportSession();
      expect(session).toBeDefined();
      expect(typeof session).toBe('string');

      const parsed = JSON.parse(session);
      expect(parsed.history).toBeDefined();
      expect(parsed.snapshots).toBeDefined();
    });

    it('should import debug session', () => {
      recorder.record('signal', 'sig-1', 0, 1, 'Value changed');
      const snapshot = timeTravel.takeSnapshot('Test snapshot');

      const session = timeTravel.exportSession();

      // Create new instance
      const newRecorder = createRecorder();
      const newTimeTravel = createTimeTravelDebugger(newRecorder);
      newTimeTravel.importSession(session);

      const snapshots = newTimeTravel.getSnapshots();
      expect(snapshots.length).toBeGreaterThan(0);
    });
  });

  describe('state diff visualization', () => {
    it('should visualize diff between states', () => {
      recorder.record('signal', 'sig-1', 0, 1, 'Changed to 1');
      recorder.record('signal', 'sig-1', 1, 2, 'Changed to 2');

      const diff = timeTravel.visualizeDiff(0, 1);
      expect(diff).toBeDefined();
      expect(Array.isArray(diff)).toBe(true);
    });
  });

  describe('breakpoints', () => {
    it('should add breakpoint', () => {
      const breakpoint = timeTravel.addBreakpoint('sig-1', 'state-change');

      expect(breakpoint).toBeDefined();
      expect(breakpoint.targetId).toBe('sig-1');
      expect(breakpoint.type).toBe('state-change');
    });

    it('should remove breakpoint', () => {
      const breakpoint = timeTravel.addBreakpoint('sig-1', 'state-change');
      timeTravel.removeBreakpoint(breakpoint.id);

      const breakpoints = timeTravel.getBreakpoints();
      expect(breakpoints).toHaveLength(0);
    });

    it('should toggle breakpoint', () => {
      const breakpoint = timeTravel.addBreakpoint('sig-1', 'state-change');
      expect(breakpoint.enabled).toBe(true);

      timeTravel.toggleBreakpoint(breakpoint.id);
      const breakpoints = timeTravel.getBreakpoints();
      expect(breakpoints[0].enabled).toBe(false);
    });

    it('should check breakpoint condition', () => {
      timeTravel.addBreakpoint('sig-1', 'value-equals', {
        type: 'equals',
        value: 5,
      });

      const shouldBreak = timeTravel.checkBreakpoint('sig-1', 5);
      expect(shouldBreak).toBe(true);
    });

    it('should not break on disabled breakpoint', () => {
      const bp = timeTravel.addBreakpoint('sig-1', 'state-change');
      timeTravel.toggleBreakpoint(bp.id);

      const shouldBreak = timeTravel.checkBreakpoint('sig-1', 1);
      expect(shouldBreak).toBe(false);
    });
  });

  describe('playback', () => {
    it('should start playback', () => {
      recorder.record('signal', 'sig-1', 0, 1, 'Changed to 1');
      recorder.record('signal', 'sig-1', 1, 2, 'Changed to 2');

      timeTravel.startPlayback({ speed: 1.0 });
      expect(timeTravel.isPlaybackActive()).toBe(true);
    });

    it('should stop playback', () => {
      recorder.record('signal', 'sig-1', 0, 1, 'Changed to 1');

      timeTravel.startPlayback({ speed: 1.0 });
      timeTravel.stopPlayback();

      expect(timeTravel.isPlaybackActive()).toBe(false);
    });
  });

  describe('history visualization', () => {
    it('should get history visualization data', () => {
      recorder.record('signal', 'sig-1', 0, 1, 'Changed to 1');
      timeTravel.takeSnapshot('Test snapshot');
      timeTravel.addBreakpoint('sig-1', 'state-change');

      const viz = timeTravel.getHistoryVisualization();

      expect(viz).toBeDefined();
      expect(viz.entries).toBeDefined();
      expect(viz.snapshots).toBeDefined();
    });
  });
});
