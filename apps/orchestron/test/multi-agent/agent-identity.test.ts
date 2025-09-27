import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentIdentityManager } from '../../src/multi-agent/agent-identity';
import {
  AgentIdentity,
  AgentCapability,
  AgentSession,
  AgentHandoff,
  HandoffContext,
  AgentPreferences,
  ReputationScore,
  SessionMetrics
} from '../../src/multi-agent/types';

describe('AgentIdentityManager', () => {
  let manager: AgentIdentityManager;

  beforeEach(() => {
    manager = new AgentIdentityManager();
  });

  describe('Agent Registration', () => {
    it('should register a new agent', async () => {
      const agent: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['frontend', 'testing'],
        capabilities: [
          { tool: 'Read', proficiency: 0.95, successRate: 0.98, avgExecutionTime: 150 },
          { tool: 'Write', proficiency: 0.90, successRate: 0.95, avgExecutionTime: 200 }
        ],
        preferences: {
          maxConcurrentTasks: 5,
          preferredTaskTypes: ['UI', 'TEST'],
          contextWindowSize: 200000
        },
        reputation: { score: 0.85, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };

      const registered = await manager.registerAgent(agent);
      expect(registered.id).toBe('claude-1');
      expect(registered.model).toBe('claude-opus-4.1');
      expect(registered.specialization).toContain('frontend');
    });

    it('should prevent duplicate agent registration', async () => {
      const agent: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: [],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.5, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };

      await manager.registerAgent(agent);
      await expect(manager.registerAgent(agent)).rejects.toThrow('Agent already registered');
    });

    it('should update agent capabilities', async () => {
      const agent: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: [],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.5, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };

      await manager.registerAgent(agent);
      const newCapability: AgentCapability = {
        tool: 'Bash',
        proficiency: 0.85,
        successRate: 0.90,
        avgExecutionTime: 300
      };

      await manager.updateCapabilities('claude-1', [newCapability]);
      const updated = await manager.getAgent('claude-1');
      expect(updated?.capabilities).toContainEqual(newCapability);
    });
  });

  describe('Session Management', () => {
    beforeEach(async () => {
      const agent: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend'],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.5, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };
      await manager.registerAgent(agent);
    });

    it('should start a new session', async () => {
      const session = await manager.startSession('claude-1');
      expect(session.agentId).toBe('claude-1');
      expect(session.sessionId).toBeDefined();
      expect(session.startTime).toBeInstanceOf(Date);
      expect(session.endTime).toBeUndefined();
    });

    it('should end an active session', async () => {
      const session = await manager.startSession('claude-1');
      const endedSession = await manager.endSession(session.sessionId);

      expect(endedSession.endTime).toBeInstanceOf(Date);
      expect(endedSession.performance.duration).toBeGreaterThan(0);
    });

    it('should track tasks completed in session', async () => {
      const session = await manager.startSession('claude-1');
      await manager.recordTaskCompletion(session.sessionId, 'task-123');
      await manager.recordTaskCompletion(session.sessionId, 'task-124');

      const updatedSession = await manager.getSession(session.sessionId);
      expect(updatedSession?.tasksCompleted).toContain('task-123');
      expect(updatedSession?.tasksCompleted).toContain('task-124');
    });

    it('should calculate session metrics', async () => {
      const session = await manager.startSession('claude-1');
      await manager.recordTaskCompletion(session.sessionId, 'task-123');
      await manager.recordError(session.sessionId, {
        message: 'Test error',
        timestamp: new Date(),
        context: {}
      });

      const metrics = await manager.getSessionMetrics(session.sessionId);
      expect(metrics.tasksCompleted).toBe(1);
      expect(metrics.errors).toBe(1);
      expect(metrics.successRate).toBeLessThan(1);
    });
  });

  describe('Agent Handoff', () => {
    beforeEach(async () => {
      const agent1: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend'],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.8, totalTasks: 10, successfulTasks: 8, failedTasks: 2 },
        sessionHistory: []
      };
      const agent2: AgentIdentity = {
        id: 'claude-2',
        model: 'claude-opus-4.1',
        specialization: ['frontend'],
        capabilities: [],
        preferences: { maxConcurrentTasks: 5, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.9, totalTasks: 20, successfulTasks: 18, failedTasks: 2 },
        sessionHistory: []
      };
      await manager.registerAgent(agent1);
      await manager.registerAgent(agent2);
    });

    it('should create a handoff between agents', async () => {
      const context: HandoffContext = {
        currentProgress: 60,
        completedSteps: ['design', 'initial-implementation'],
        remainingWork: ['testing', 'documentation'],
        sharedKnowledge: { key: 'value' },
        warnings: ['Consider edge case X']
      };

      const handoff = await manager.createHandoff({
        fromAgent: 'claude-1',
        toAgent: 'claude-2',
        task: 'task-123',
        context,
        reason: 'Frontend expertise needed',
        continuationInstructions: 'Complete UI implementation'
      });

      expect(handoff.fromAgent).toBe('claude-1');
      expect(handoff.toAgent).toBe('claude-2');
      expect(handoff.context.currentProgress).toBe(60);
    });

    it('should validate handoff agents exist', async () => {
      const context: HandoffContext = {
        currentProgress: 50,
        completedSteps: [],
        remainingWork: [],
        sharedKnowledge: {},
        warnings: []
      };

      await expect(manager.createHandoff({
        fromAgent: 'claude-1',
        toAgent: 'claude-3',
        task: 'task-123',
        context,
        reason: 'Test'
      })).rejects.toThrow('Target agent not found');
    });

    it('should track handoff history', async () => {
      const context: HandoffContext = {
        currentProgress: 30,
        completedSteps: ['step1'],
        remainingWork: ['step2'],
        sharedKnowledge: {},
        warnings: []
      };

      await manager.createHandoff({
        fromAgent: 'claude-1',
        toAgent: 'claude-2',
        task: 'task-123',
        context,
        reason: 'Shift change'
      });

      const history = await manager.getHandoffHistory('task-123');
      expect(history).toHaveLength(1);
      expect(history[0].fromAgent).toBe('claude-1');
      expect(history[0].toAgent).toBe('claude-2');
    });
  });

  describe('Agent Specialization', () => {
    it('should find agents by specialization', async () => {
      const backend: AgentIdentity = {
        id: 'claude-backend',
        model: 'claude-opus-4.1',
        specialization: ['backend', 'database'],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.85, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };
      const frontend: AgentIdentity = {
        id: 'claude-frontend',
        model: 'claude-opus-4.1',
        specialization: ['frontend', 'ui'],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.90, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };

      await manager.registerAgent(backend);
      await manager.registerAgent(frontend);

      const backendAgents = await manager.findBySpecialization('backend');
      expect(backendAgents).toHaveLength(1);
      expect(backendAgents[0].id).toBe('claude-backend');

      const frontendAgents = await manager.findBySpecialization('frontend');
      expect(frontendAgents).toHaveLength(1);
      expect(frontendAgents[0].id).toBe('claude-frontend');
    });

    it('should match agent to task requirements', async () => {
      const testAgent: AgentIdentity = {
        id: 'claude-test',
        model: 'claude-opus-4.1',
        specialization: ['testing', 'qa'],
        capabilities: [
          { tool: 'Test', proficiency: 0.95, successRate: 0.98, avgExecutionTime: 100 }
        ],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: ['TEST'], contextWindowSize: 100000 },
        reputation: { score: 0.92, totalTasks: 50, successfulTasks: 46, failedTasks: 4 },
        sessionHistory: []
      };

      await manager.registerAgent(testAgent);

      const bestAgent = await manager.findBestAgentForTask({
        requiredSpecialization: ['testing'],
        requiredTools: ['Test'],
        preferredReputation: 0.9
      });

      expect(bestAgent?.id).toBe('claude-test');
    });
  });

  describe('Reputation Management', () => {
    beforeEach(async () => {
      const agent: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: [],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.5, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };
      await manager.registerAgent(agent);
    });

    it('should update reputation on task success', async () => {
      await manager.updateReputation('claude-1', { success: true });
      const agent = await manager.getAgent('claude-1');

      expect(agent?.reputation.totalTasks).toBe(1);
      expect(agent?.reputation.successfulTasks).toBe(1);
      expect(agent?.reputation.score).toBeGreaterThan(0.5);
    });

    it('should update reputation on task failure', async () => {
      await manager.updateReputation('claude-1', { success: false });
      const agent = await manager.getAgent('claude-1');

      expect(agent?.reputation.totalTasks).toBe(1);
      expect(agent?.reputation.failedTasks).toBe(1);
      expect(agent?.reputation.score).toBeLessThan(0.5);
    });

    it('should calculate weighted reputation score', async () => {
      // Simulate multiple task completions
      await manager.updateReputation('claude-1', { success: true });
      await manager.updateReputation('claude-1', { success: true });
      await manager.updateReputation('claude-1', { success: false });
      await manager.updateReputation('claude-1', { success: true });

      const agent = await manager.getAgent('claude-1');
      expect(agent?.reputation.totalTasks).toBe(4);
      expect(agent?.reputation.successfulTasks).toBe(3);
      expect(agent?.reputation.failedTasks).toBe(1);
      // Score should be around 0.75 (3/4 success rate)
      expect(agent?.reputation.score).toBeCloseTo(0.75, 1);
    });
  });

  describe('Agent Availability', () => {
    it('should track agent availability', async () => {
      const agent: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: [],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.5, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };

      await manager.registerAgent(agent);
      const available = await manager.isAgentAvailable('claude-1');
      expect(available).toBe(true);

      // Start session and assign tasks
      const session = await manager.startSession('claude-1');
      await manager.assignTask('claude-1', 'task-1');
      await manager.assignTask('claude-1', 'task-2');
      await manager.assignTask('claude-1', 'task-3');

      // Should be at max capacity
      const stillAvailable = await manager.isAgentAvailable('claude-1');
      expect(stillAvailable).toBe(false);
    });

    it('should list available agents', async () => {
      const agent1: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend'],
        capabilities: [],
        preferences: { maxConcurrentTasks: 1, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.8, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };
      const agent2: AgentIdentity = {
        id: 'claude-2',
        model: 'claude-opus-4.1',
        specialization: ['frontend'],
        capabilities: [],
        preferences: { maxConcurrentTasks: 2, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.9, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };

      await manager.registerAgent(agent1);
      await manager.registerAgent(agent2);

      // Fill up agent1's capacity
      await manager.assignTask('claude-1', 'task-1');

      const available = await manager.getAvailableAgents();
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('claude-2');
    });
  });

  describe('Session History', () => {
    it('should maintain session history for agents', async () => {
      const agent: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: [],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.5, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };

      await manager.registerAgent(agent);

      // Create multiple sessions
      const session1 = await manager.startSession('claude-1');
      await manager.endSession(session1.sessionId);

      const session2 = await manager.startSession('claude-1');
      await manager.endSession(session2.sessionId);

      const agentWithHistory = await manager.getAgent('claude-1');
      expect(agentWithHistory?.sessionHistory).toHaveLength(2);
    });

    it('should limit session history size', async () => {
      const agent: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: [],
        capabilities: [],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.5, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
        sessionHistory: []
      };

      await manager.registerAgent(agent);

      // Create many sessions (more than the limit)
      for (let i = 0; i < 15; i++) {
        const session = await manager.startSession('claude-1');
        await manager.endSession(session.sessionId);
      }

      const agentWithHistory = await manager.getAgent('claude-1');
      // Should keep only last 10 sessions
      expect(agentWithHistory?.sessionHistory).toHaveLength(10);
    });
  });
});