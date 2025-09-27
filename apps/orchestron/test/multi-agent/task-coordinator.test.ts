import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskCoordinator } from '../../src/multi-agent/task-coordinator';
import { AgentIdentityManager } from '../../src/multi-agent/agent-identity';
import { SharedMemoryManager } from '../../src/multi-agent/shared-memory';
import {
  AgentIdentity,
  AgentAssignment,
  TaskDistribution,
  CollaborationPattern,
  AgentPerformance,
  AgentRole,
  WorkflowStep
} from '../../src/multi-agent/types';

describe('TaskCoordinator', () => {
  let coordinator: TaskCoordinator;
  let identityManager: AgentIdentityManager;
  let memoryManager: SharedMemoryManager;

  beforeEach(() => {
    identityManager = new AgentIdentityManager();
    memoryManager = new SharedMemoryManager();
    coordinator = new TaskCoordinator(identityManager, memoryManager);
  });

  describe('Task Assignment', () => {
    beforeEach(async () => {
      // Register test agents
      const agent1: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend', 'database'],
        capabilities: [
          { tool: 'Read', proficiency: 0.9, successRate: 0.95, avgExecutionTime: 100 },
          { tool: 'Write', proficiency: 0.85, successRate: 0.9, avgExecutionTime: 150 }
        ],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: ['API'], contextWindowSize: 200000 },
        reputation: { score: 0.85, totalTasks: 20, successfulTasks: 17, failedTasks: 3 },
        sessionHistory: []
      };

      const agent2: AgentIdentity = {
        id: 'claude-2',
        model: 'claude-opus-4.1',
        specialization: ['frontend', 'ui'],
        capabilities: [
          { tool: 'Read', proficiency: 0.88, successRate: 0.92, avgExecutionTime: 120 },
          { tool: 'Edit', proficiency: 0.9, successRate: 0.93, avgExecutionTime: 100 }
        ],
        preferences: { maxConcurrentTasks: 2, preferredTaskTypes: ['UI'], contextWindowSize: 200000 },
        reputation: { score: 0.9, totalTasks: 15, successfulTasks: 14, failedTasks: 1 },
        sessionHistory: []
      };

      await identityManager.registerAgent(agent1);
      await identityManager.registerAgent(agent2);
    });

    it('should assign task to best matching agent', async () => {
      const assignment = await coordinator.assignTask({
        taskId: 'task-123',
        type: 'backend',
        requirements: {
          requiredSpecialization: ['backend'],
          requiredTools: ['Read', 'Write']
        }
      });

      expect(assignment.agentId).toBe('claude-1');
      expect(assignment.taskId).toBe('task-123');
      expect(assignment.status).toBe('pending');
    });

    it('should distribute multiple tasks efficiently', async () => {
      const tasks = [
        { taskId: 't1', type: 'backend', requirements: { requiredSpecialization: ['backend'] } },
        { taskId: 't2', type: 'frontend', requirements: { requiredSpecialization: ['frontend'] } },
        { taskId: 't3', type: 'backend', requirements: { requiredSpecialization: ['backend'] } },
        { taskId: 't4', type: 'ui', requirements: { requiredSpecialization: ['ui'] } }
      ];

      const distribution = await coordinator.distributeTasks(tasks, 'expertise');

      expect(distribution.assignments.get('claude-1')).toContain('t1');
      expect(distribution.assignments.get('claude-1')).toContain('t3');
      expect(distribution.assignments.get('claude-2')).toContain('t2');
      expect(distribution.assignments.get('claude-2')).toContain('t4');
    });

    it('should respect agent capacity limits', async () => {
      // Fill claude-2 to capacity
      await coordinator.assignTask({ taskId: 'existing-1', type: 'ui' });
      await coordinator.assignTask({ taskId: 'existing-2', type: 'ui' });

      // This should go to claude-1 even though claude-2 might be better
      const assignment = await coordinator.assignTask({
        taskId: 'overflow',
        type: 'ui',
        requirements: {}
      });

      expect(assignment.agentId).toBe('claude-1');
    });

    it('should handle round-robin distribution', async () => {
      const tasks = [
        { taskId: 't1', type: 'general' },
        { taskId: 't2', type: 'general' },
        { taskId: 't3', type: 'general' },
        { taskId: 't4', type: 'general' }
      ];

      const distribution = await coordinator.distributeTasks(tasks, 'round-robin');

      const claude1Tasks = distribution.assignments.get('claude-1') || [];
      const claude2Tasks = distribution.assignments.get('claude-2') || [];

      // Should be evenly distributed
      expect(claude1Tasks.length).toBe(2);
      expect(claude2Tasks.length).toBe(2);
    });

    it('should handle load-balanced distribution', async () => {
      // Give claude-1 some existing load
      await coordinator.assignTask({ taskId: 'existing-1', type: 'backend' });

      const tasks = [
        { taskId: 't1', type: 'general' },
        { taskId: 't2', type: 'general' },
        { taskId: 't3', type: 'general' }
      ];

      const distribution = await coordinator.distributeTasks(tasks, 'load-balanced');

      const claude1Tasks = distribution.assignments.get('claude-1') || [];
      const claude2Tasks = distribution.assignments.get('claude-2') || [];

      // Claude-2 should get more tasks since claude-1 has existing load
      expect(claude2Tasks.length).toBeGreaterThanOrEqual(claude1Tasks.length);
    });
  });

  describe('Task Progress Tracking', () => {
    beforeEach(async () => {
      // Register test agents for this section
      const agent1: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend', 'database'],
        capabilities: [
          { tool: 'Read', proficiency: 0.9, successRate: 0.95, avgExecutionTime: 100 },
          { tool: 'Write', proficiency: 0.85, successRate: 0.9, avgExecutionTime: 150 }
        ],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: ['API'], contextWindowSize: 200000 },
        reputation: { score: 0.85, totalTasks: 20, successfulTasks: 17, failedTasks: 3 },
        sessionHistory: []
      };

      await identityManager.registerAgent(agent1);
    });

    it('should track task progress', async () => {
      const assignment = await coordinator.assignTask({
        taskId: 'task-123',
        type: 'backend'
      });

      await coordinator.updateProgress(assignment.id, 50);
      const progress = await coordinator.getTaskProgress('task-123');
      expect(progress).toBe(50);

      await coordinator.updateProgress(assignment.id, 100);
      const finalProgress = await coordinator.getTaskProgress('task-123');
      expect(finalProgress).toBe(100);
    });

    it('should mark tasks as completed', async () => {
      const assignment = await coordinator.assignTask({
        taskId: 'task-123',
        type: 'backend'
      });

      await coordinator.completeTask(assignment.id, { success: true });

      const status = await coordinator.getAssignmentStatus(assignment.id);
      expect(status).toBe('completed');
    });

    it('should handle task failures', async () => {
      const assignment = await coordinator.assignTask({
        taskId: 'task-123',
        type: 'backend'
      });

      await coordinator.completeTask(assignment.id, { success: false, error: 'Test error' });

      const status = await coordinator.getAssignmentStatus(assignment.id);
      expect(status).toBe('failed');
    });
  });

  describe('Parallel Execution', () => {
    beforeEach(async () => {
      // Register test agents for this section
      const agent1: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend', 'database'],
        capabilities: [
          { tool: 'Read', proficiency: 0.9, successRate: 0.95, avgExecutionTime: 100 },
          { tool: 'Write', proficiency: 0.85, successRate: 0.9, avgExecutionTime: 150 }
        ],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: ['API'], contextWindowSize: 200000 },
        reputation: { score: 0.85, totalTasks: 20, successfulTasks: 17, failedTasks: 3 },
        sessionHistory: []
      };

      const agent2: AgentIdentity = {
        id: 'claude-2',
        model: 'claude-opus-4.1',
        specialization: ['frontend', 'ui'],
        capabilities: [
          { tool: 'Read', proficiency: 0.88, successRate: 0.92, avgExecutionTime: 120 },
          { tool: 'Edit', proficiency: 0.9, successRate: 0.93, avgExecutionTime: 100 }
        ],
        preferences: { maxConcurrentTasks: 2, preferredTaskTypes: ['UI'], contextWindowSize: 200000 },
        reputation: { score: 0.9, totalTasks: 15, successfulTasks: 14, failedTasks: 1 },
        sessionHistory: []
      };

      await identityManager.registerAgent(agent1);
      await identityManager.registerAgent(agent2);
    });

    it('should execute tasks in parallel', async () => {
      const tasks = [
        { taskId: 't1', type: 'backend' },
        { taskId: 't2', type: 'frontend' },
        { taskId: 't3', type: 'backend' }
      ];

      const results = await coordinator.executeInParallel(tasks, {
        maxConcurrency: 2,
        timeout: 5000
      });

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.status).toMatch(/pending|in_progress|completed/);
      });
    });

    it('should respect concurrency limits', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        taskId: `task-${i}`,
        type: 'general'
      }));

      const startTime = Date.now();
      const results = await coordinator.executeInParallel(tasks, {
        maxConcurrency: 2,
        timeout: 1000
      });

      // With only 2 agents and max concurrency 2, not all tasks should complete immediately
      const completedCount = results.filter(r => r.status === 'completed').length;
      expect(completedCount).toBeLessThanOrEqual(4); // Max 2 agents * 2 concurrent tasks
    });

    it('should handle timeouts', async () => {
      const tasks = [
        { taskId: 't1', type: 'slow-task' }
      ];

      const results = await coordinator.executeInParallel(tasks, {
        maxConcurrency: 1,
        timeout: 100 // Very short timeout
      });

      // Task should timeout
      expect(results[0].status).toMatch(/pending|failed/);
    });
  });

  describe('Collaboration Patterns', () => {
    beforeEach(async () => {
      // Register test agents for collaboration patterns
      const agent1: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend', 'database'],
        capabilities: [
          { tool: 'Read', proficiency: 0.9, successRate: 0.95, avgExecutionTime: 100 },
          { tool: 'Write', proficiency: 0.85, successRate: 0.9, avgExecutionTime: 150 },
          { tool: 'Edit', proficiency: 0.8, successRate: 0.85, avgExecutionTime: 120 },
          { tool: 'Review', proficiency: 0.75, successRate: 0.8, avgExecutionTime: 200 }
        ],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: ['API'], contextWindowSize: 200000 },
        reputation: { score: 0.85, totalTasks: 20, successfulTasks: 17, failedTasks: 3 },
        sessionHistory: []
      };

      const agent2: AgentIdentity = {
        id: 'claude-2',
        model: 'claude-opus-4.1',
        specialization: ['frontend', 'ui'],
        capabilities: [
          { tool: 'Read', proficiency: 0.88, successRate: 0.92, avgExecutionTime: 120 },
          { tool: 'Write', proficiency: 0.82, successRate: 0.88, avgExecutionTime: 160 },
          { tool: 'Edit', proficiency: 0.9, successRate: 0.93, avgExecutionTime: 100 }
        ],
        preferences: { maxConcurrentTasks: 2, preferredTaskTypes: ['UI'], contextWindowSize: 200000 },
        reputation: { score: 0.9, totalTasks: 15, successfulTasks: 14, failedTasks: 1 },
        sessionHistory: []
      };

      await identityManager.registerAgent(agent1);
      await identityManager.registerAgent(agent2);
    });

    it('should register collaboration pattern', async () => {
      const pattern: CollaborationPattern = {
        name: 'pair-programming',
        description: 'Two agents work together on the same task',
        agents: [
          {
            role: 'driver',
            responsibilities: ['Write code'],
            requiredCapabilities: ['Write', 'Edit']
          },
          {
            role: 'navigator',
            responsibilities: ['Review and guide'],
            requiredCapabilities: ['Read', 'Review']
          }
        ],
        workflow: [
          {
            id: 'step1',
            name: 'Planning',
            assignedRole: 'navigator',
            dependencies: [],
            outputs: ['plan'],
            estimatedDuration: 300000
          },
          {
            id: 'step2',
            name: 'Implementation',
            assignedRole: 'driver',
            dependencies: ['step1'],
            outputs: ['code'],
            estimatedDuration: 600000
          }
        ],
        coordination: 'synchronous',
        communication: 'realtime'
      };

      await coordinator.registerPattern(pattern);
      const registered = await coordinator.getPattern('pair-programming');
      expect(registered).toEqual(pattern);
    });

    it('should execute collaboration pattern', async () => {
      // Register pattern
      const pattern: CollaborationPattern = {
        name: 'code-review',
        description: 'Author and reviewer pattern',
        agents: [
          { role: 'author', responsibilities: ['Write code'], requiredCapabilities: ['Write'] },
          { role: 'reviewer', responsibilities: ['Review code'], requiredCapabilities: ['Read'] }
        ],
        workflow: [
          {
            id: 'write',
            name: 'Write code',
            assignedRole: 'author',
            dependencies: [],
            outputs: ['code'],
            estimatedDuration: 600000
          },
          {
            id: 'review',
            name: 'Review code',
            assignedRole: 'reviewer',
            dependencies: ['write'],
            outputs: ['feedback'],
            estimatedDuration: 300000
          }
        ],
        coordination: 'asynchronous',
        communication: 'comment-based'
      };

      await coordinator.registerPattern(pattern);

      const execution = await coordinator.executePattern('code-review', {
        taskId: 'task-123',
        context: { files: ['file1.ts'] }
      });

      expect(execution.patternName).toBe('code-review');
      expect(execution.agents).toHaveLength(2);
      expect(execution.status).toBe('in_progress');
    });

    it('should handle swarm collaboration', async () => {
      // Register more agents for swarm
      for (let i = 3; i <= 6; i++) {
        await identityManager.registerAgent({
          id: `claude-${i}`,
          model: 'claude-opus-4.1',
          specialization: ['general'],
          capabilities: [],
          preferences: { maxConcurrentTasks: 2, preferredTaskTypes: [], contextWindowSize: 100000 },
          reputation: { score: 0.8, totalTasks: 10, successfulTasks: 8, failedTasks: 2 },
          sessionHistory: []
        });
      }

      const subtasks = Array.from({ length: 10 }, (_, i) => ({
        taskId: `subtask-${i}`,
        type: 'analysis'
      }));

      const swarmResult = await coordinator.executeSwarm(subtasks, {
        minAgents: 3,
        maxAgents: 5,
        strategy: 'parallel'
      });

      expect(swarmResult.participatingAgents.length).toBeGreaterThanOrEqual(3);
      expect(swarmResult.participatingAgents.length).toBeLessThanOrEqual(5);
      expect(swarmResult.assignments).toHaveLength(10);
    });
  });

  describe('Task Rebalancing', () => {
    beforeEach(async () => {
      // Register test agents for this section
      const agent1: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend', 'database'],
        capabilities: [
          { tool: 'Read', proficiency: 0.9, successRate: 0.95, avgExecutionTime: 100 },
          { tool: 'Write', proficiency: 0.85, successRate: 0.9, avgExecutionTime: 150 }
        ],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: ['API'], contextWindowSize: 200000 },
        reputation: { score: 0.85, totalTasks: 20, successfulTasks: 17, failedTasks: 3 },
        sessionHistory: []
      };

      const agent2: AgentIdentity = {
        id: 'claude-2',
        model: 'claude-opus-4.1',
        specialization: ['frontend', 'ui'],
        capabilities: [
          { tool: 'Read', proficiency: 0.88, successRate: 0.92, avgExecutionTime: 120 },
          { tool: 'Edit', proficiency: 0.9, successRate: 0.93, avgExecutionTime: 100 }
        ],
        preferences: { maxConcurrentTasks: 2, preferredTaskTypes: ['UI'], contextWindowSize: 200000 },
        reputation: { score: 0.9, totalTasks: 15, successfulTasks: 14, failedTasks: 1 },
        sessionHistory: []
      };

      await identityManager.registerAgent(agent1);
      await identityManager.registerAgent(agent2);
    });

    it('should rebalance tasks when agent becomes unavailable', async () => {
      const tasks = [
        { taskId: 't1', type: 'backend' },
        { taskId: 't2', type: 'backend' },
        { taskId: 't3', type: 'frontend' }
      ];

      const distribution = await coordinator.distributeTasks(tasks, 'expertise');

      // Simulate agent going offline
      await coordinator.markAgentUnavailable('claude-1');

      const rebalanced = await coordinator.rebalanceTasks();

      // All tasks should now be assigned to claude-2
      const claude2Tasks = rebalanced.assignments.get('claude-2') || [];
      expect(claude2Tasks).toContain('t1');
      expect(claude2Tasks).toContain('t2');
    });

    it('should rebalance based on performance metrics', async () => {
      // Set performance metrics
      const perf1: AgentPerformance = {
        agentId: 'claude-1',
        period: { start: new Date(Date.now() - 86400000), end: new Date() },
        tasksCompleted: 10,
        avgCompletionTime: 3600000, // 1 hour average
        successRate: 0.8,
        errorRate: 0.2,
        handoffRate: 0.1,
        collaborationScore: 0.7
      };

      const perf2: AgentPerformance = {
        agentId: 'claude-2',
        period: { start: new Date(Date.now() - 86400000), end: new Date() },
        tasksCompleted: 15,
        avgCompletionTime: 1800000, // 30 min average - faster!
        successRate: 0.95,
        errorRate: 0.05,
        handoffRate: 0.05,
        collaborationScore: 0.9
      };

      await coordinator.updatePerformance(perf1);
      await coordinator.updatePerformance(perf2);

      const tasks = [
        { taskId: 't1', type: 'critical' },
        { taskId: 't2', type: 'critical' },
        { taskId: 't3', type: 'normal' }
      ];

      const distribution = await coordinator.distributeTasks(tasks, 'performance-based');

      // Critical tasks should go to better performing agent (claude-2)
      const claude2Tasks = distribution.assignments.get('claude-2') || [];
      expect(claude2Tasks).toContain('t1');
      expect(claude2Tasks).toContain('t2');
    });
  });

  describe('Task Dependencies', () => {
    it('should handle task dependencies', async () => {
      const taskGraph = {
        't1': { dependencies: [], type: 'init' },
        't2': { dependencies: ['t1'], type: 'process' },
        't3': { dependencies: ['t1'], type: 'validate' },
        't4': { dependencies: ['t2', 't3'], type: 'finalize' }
      };

      const execution = await coordinator.executeDependencyGraph(taskGraph);

      // Verify execution order
      const order = execution.executionOrder;
      expect(order.indexOf('t1')).toBeLessThan(order.indexOf('t2'));
      expect(order.indexOf('t1')).toBeLessThan(order.indexOf('t3'));
      expect(order.indexOf('t2')).toBeLessThan(order.indexOf('t4'));
      expect(order.indexOf('t3')).toBeLessThan(order.indexOf('t4'));
    });

    it('should detect circular dependencies', async () => {
      const circularGraph = {
        't1': { dependencies: ['t3'], type: 'task' },
        't2': { dependencies: ['t1'], type: 'task' },
        't3': { dependencies: ['t2'], type: 'task' }
      };

      await expect(coordinator.executeDependencyGraph(circularGraph))
        .rejects.toThrow('Circular dependency detected');
    });

    it('should parallelize independent tasks', async () => {
      const taskGraph = {
        't1': { dependencies: [], type: 'init' },
        't2': { dependencies: [], type: 'init' },
        't3': { dependencies: ['t1', 't2'], type: 'merge' }
      };

      const execution = await coordinator.executeDependencyGraph(taskGraph);

      // t1 and t2 should be marked for parallel execution
      const parallelGroups = execution.parallelGroups;
      expect(parallelGroups[0]).toContain('t1');
      expect(parallelGroups[0]).toContain('t2');
      expect(parallelGroups[1]).toContain('t3');
    });
  });

  describe('Agent Coordination', () => {
    beforeEach(async () => {
      // Register test agents for this section
      const agent1: AgentIdentity = {
        id: 'claude-1',
        model: 'claude-opus-4.1',
        specialization: ['backend', 'database'],
        capabilities: [
          { tool: 'Read', proficiency: 0.9, successRate: 0.95, avgExecutionTime: 100 },
          { tool: 'Write', proficiency: 0.85, successRate: 0.9, avgExecutionTime: 150 }
        ],
        preferences: { maxConcurrentTasks: 3, preferredTaskTypes: ['API'], contextWindowSize: 200000 },
        reputation: { score: 0.85, totalTasks: 20, successfulTasks: 17, failedTasks: 3 },
        sessionHistory: []
      };

      const agent2: AgentIdentity = {
        id: 'claude-2',
        model: 'claude-opus-4.1',
        specialization: ['frontend', 'ui'],
        capabilities: [
          { tool: 'Read', proficiency: 0.88, successRate: 0.92, avgExecutionTime: 120 },
          { tool: 'Edit', proficiency: 0.9, successRate: 0.93, avgExecutionTime: 100 }
        ],
        preferences: { maxConcurrentTasks: 2, preferredTaskTypes: ['UI'], contextWindowSize: 200000 },
        reputation: { score: 0.9, totalTasks: 15, successfulTasks: 14, failedTasks: 1 },
        sessionHistory: []
      };

      await identityManager.registerAgent(agent1);
      await identityManager.registerAgent(agent2);
    });

    it('should coordinate handoffs between agents', async () => {
      const assignment = await coordinator.assignTask({
        taskId: 'task-123',
        type: 'backend'
      });

      await coordinator.updateProgress(assignment.id, 60);

      const handoff = await coordinator.initiateHandoff(assignment.id, {
        targetAgent: 'claude-2',
        reason: 'Frontend expertise needed',
        context: {
          completedWork: 'Backend API implemented',
          remainingWork: 'UI integration'
        }
      });

      expect(handoff.fromAgent).toBe('claude-1');
      expect(handoff.toAgent).toBe('claude-2');
      expect(handoff.progress).toBe(60);
    });

    it('should coordinate voting decisions', async () => {
      // Register more agents for voting
      await identityManager.registerAgent({
        id: 'claude-3',
        model: 'claude-opus-4.1',
        specialization: ['general'],
        capabilities: [],
        preferences: { maxConcurrentTasks: 2, preferredTaskTypes: [], contextWindowSize: 100000 },
        reputation: { score: 0.8, totalTasks: 10, successfulTasks: 8, failedTasks: 2 },
        sessionHistory: []
      });

      const decision = await coordinator.coordinateVoting({
        question: 'Should we use MongoDB or PostgreSQL?',
        options: ['MongoDB', 'PostgreSQL'],
        voters: ['claude-1', 'claude-2', 'claude-3'],
        deadline: new Date(Date.now() + 60000)
      });

      expect(decision.votes).toHaveLength(3);
      expect(decision.winner).toMatch(/MongoDB|PostgreSQL/);
      expect(decision.consensus).toBeDefined();
    });

    it('should coordinate consensus building', async () => {
      const consensus = await coordinator.buildConsensus({
        topic: 'Architecture decision',
        participants: ['claude-1', 'claude-2'],
        proposals: [
          { agent: 'claude-1', proposal: 'Microservices', rationale: 'Scalability' },
          { agent: 'claude-2', proposal: 'Monolith', rationale: 'Simplicity' }
        ],
        method: 'discussion'
      });

      expect(consensus.finalDecision).toBeDefined();
      expect(consensus.agreement).toBeDefined();
      expect(consensus.dissent).toBeDefined();
    });
  });
});