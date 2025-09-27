import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager, CompressedContext, Session } from '../../src/core/session-manager';
import { SQLiteStorage } from '../../src/storage/sqlite';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let storage: SQLiteStorage;

  beforeEach(async () => {
    storage = new SQLiteStorage(':memory:');
    await storage.initialize();
    sessionManager = new SessionManager(storage);
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('Session Lifecycle', () => {
    it('should start a new session', async () => {
      const session = await sessionManager.startSession('agent-1');

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.agentId).toBe('agent-1');
      expect(session.status).toBe('ACTIVE');
      expect(session.startTime).toBeInstanceOf(Date);
    });

    it('should end a session', async () => {
      const session = await sessionManager.startSession('agent-1');
      await sessionManager.endSession(session.id);

      const activeSessions = sessionManager.getActiveSessions();
      expect(activeSessions).toHaveLength(0);
    });

    it('should track active sessions', async () => {
      const session1 = await sessionManager.startSession('agent-1');
      const session2 = await sessionManager.startSession('agent-2');

      const activeSessions = sessionManager.getActiveSessions();
      expect(activeSessions).toHaveLength(2);
      expect(activeSessions.map(s => s.id)).toContain(session1.id);
      expect(activeSessions.map(s => s.id)).toContain(session2.id);
    });

    it('should update session with current task', async () => {
      const session = await sessionManager.startSession('agent-1');
      await sessionManager.updateSessionTask(session.id, 'TASK-123');

      const activeSessions = sessionManager.getActiveSessions();
      const updatedSession = activeSessions.find(s => s.id === session.id);
      expect(updatedSession?.currentTask).toBe('TASK-123');
    });

    it('should mark tasks as completed', async () => {
      const session = await sessionManager.startSession('agent-1');
      await sessionManager.updateSessionTask(session.id, 'TASK-123');
      await sessionManager.markTaskCompleted(session.id, 'TASK-123');

      const activeSessions = sessionManager.getActiveSessions();
      const updatedSession = activeSessions.find(s => s.id === session.id);
      expect(updatedSession?.completedTasks).toContain('TASK-123');
      expect(updatedSession?.currentTask).toBeUndefined();
    });
  });

  describe('Context Management', () => {
    it('should save and load context', async () => {
      const session = await sessionManager.startSession('agent-1');

      const context = {
        currentTask: {
          id: 'TASK-123',
          title: 'Test Task',
          progress: 50,
        },
        completedSteps: ['Step 1', 'Step 2'],
        nextSteps: ['Step 3', 'Step 4'],
        decisions: {
          database: 'PostgreSQL',
          framework: 'Express',
        },
        files: ['src/index.ts', 'src/app.ts'],
        insights: ['Performance improved by 20%'],
      };

      await sessionManager.saveContext(session.id, context);
      const loaded = await sessionManager.loadContext(session.id);

      expect(loaded).toBeDefined();
      expect(loaded?.currentTask?.id).toBe('TASK-123');
      expect(loaded?.completedSteps).toEqual(['Step 1', 'Step 2']);
      expect(loaded?.decisions.database).toBe('PostgreSQL');
    });

    it('should compress context to reduce size', async () => {
      const session = await sessionManager.startSession('agent-1');

      const largeContext = {
        currentTask: 'TASK-123',
        completedSteps: Array(100).fill('Step'),
        nextSteps: Array(100).fill('Next'),
        decisions: Object.fromEntries(
          Array(100).fill(0).map((_, i) => [`key${i}`, `value${i}`])
        ),
        files: Array(100).fill('file.ts'),
        insights: Array(100).fill('insight'),
      };

      await sessionManager.saveContext(session.id, largeContext);
      const compressed = await sessionManager.loadContext(session.id);

      expect(compressed).toBeDefined();
      // Should limit arrays to reasonable sizes
      expect(compressed?.completedSteps.length).toBeLessThanOrEqual(10);
      expect(compressed?.nextSteps.length).toBeLessThanOrEqual(10);
      expect(compressed?.activeFiles.length).toBeLessThanOrEqual(20);
      expect(compressed?.insights.length).toBeLessThanOrEqual(10);
      expect(Object.keys(compressed?.decisions || {}).length).toBeLessThanOrEqual(20);
    });

    it('should calculate context size', async () => {
      const context: CompressedContext = {
        timestamp: new Date(),
        agentId: 'agent-1',
        sessionId: 'session-1',
        currentTask: {
          id: 'TASK-123',
          title: 'Test Task',
          progress: 50,
          status: 'IN_PROGRESS',
        },
        completedSteps: ['Step 1', 'Step 2'],
        nextSteps: ['Step 3'],
        decisions: { db: 'postgres' },
        activeFiles: ['index.ts'],
        insights: ['Good progress'],
      };

      const size = sessionManager.getContextSize(context);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(10000); // Should be reasonably small
    });
  });

  describe('Handoff Management', () => {
    it('should prepare handoff from one session', async () => {
      const session1 = await sessionManager.startSession('agent-1');
      await sessionManager.updateSessionTask(session1.id, 'TASK-123');

      const context = {
        currentTask: 'TASK-123',
        completedSteps: ['Backend API complete'],
        nextSteps: ['Frontend implementation'],
        decisions: { api: 'REST' },
      };

      await sessionManager.saveContext(session1.id, context);

      const handoff = await sessionManager.prepareHandoff(
        session1.id,
        'Please continue with frontend implementation'
      );

      expect(handoff).toBeDefined();
      expect(handoff.fromSession).toBe(session1.id);
      expect(handoff.task).toBe('TASK-123');
      expect(handoff.instructions).toContain('frontend implementation');
    });

    it('should accept handoff in new session', async () => {
      // Prepare handoff
      const session1 = await sessionManager.startSession('agent-1');
      await sessionManager.updateSessionTask(session1.id, 'TASK-123');

      const context = {
        currentTask: 'TASK-123',
        completedSteps: ['Step 1'],
        nextSteps: ['Step 2'],
        decisions: {},
      };

      await sessionManager.saveContext(session1.id, context);
      await sessionManager.prepareHandoff(session1.id);

      // Accept handoff in new session
      const session2 = await sessionManager.startSession('agent-2');
      await sessionManager.acceptHandoff('handoff-1', session2.id);

      const activeSessions = sessionManager.getActiveSessions();
      const newSession = activeSessions.find(s => s.id === session2.id);
      expect(newSession?.currentTask).toBe('TASK-123');
    });
  });

  describe('Work Resumption', () => {
    it('should resume work from previous session', async () => {
      const session1 = await sessionManager.startSession('agent-1');
      await sessionManager.updateSessionTask(session1.id, 'TASK-123');

      const context = {
        currentTask: 'TASK-123',
        completedSteps: ['Step 1'],
        nextSteps: ['Step 2'],
        decisions: {},
      };

      await sessionManager.saveContext(session1.id, context);

      const resumeInfo = await sessionManager.resumeWork('agent-1');
      expect(resumeInfo.task).toBe('TASK-123');
      expect(resumeInfo.instructions).toContain('Continue from where you left off');
    });

    it('should suggest new task if no unfinished work', async () => {
      const session = await sessionManager.startSession('agent-1');
      await sessionManager.markTaskCompleted(session.id, 'TASK-123');
      await sessionManager.endSession(session.id);

      const resumeInfo = await sessionManager.resumeWork('agent-1');
      expect(resumeInfo.task).toBeUndefined();
      expect(resumeInfo.instructions).toContain('select a new task');
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid session ID', async () => {
      await expect(
        sessionManager.endSession('invalid-session-id')
      ).rejects.toThrow('Session invalid-session-id not found');
    });

    it('should throw error when preparing handoff for non-existent session', async () => {
      await expect(
        sessionManager.prepareHandoff('invalid-session-id')
      ).rejects.toThrow('Session invalid-session-id not found');
    });

    it('should handle missing context gracefully', async () => {
      const context = await sessionManager.loadContext('non-existent');
      expect(context).toBeNull();
    });
  });

  describe('Context Pruning', () => {
    it('should prune old contexts', async () => {
      // This is a placeholder for future implementation
      const prunedCount = await sessionManager.pruneOldContexts(30);
      expect(prunedCount).toBe(0); // Not implemented yet
    });
  });
});