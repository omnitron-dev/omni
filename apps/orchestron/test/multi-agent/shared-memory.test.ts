import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedMemoryManager } from '../../src/multi-agent/shared-memory';
import {
  SharedMemory,
  Insight,
  Pattern,
  Solution,
  WorkingContext,
  DecisionRequest,
  TaskCompletion,
  ErrorPattern,
  Knowledge,
  Conflict,
  ResolutionStrategy,
  KnowledgeSynthesis,
  AgentContribution
} from '../../src/multi-agent/types';

describe('SharedMemoryManager', () => {
  let memory: SharedMemoryManager;

  beforeEach(() => {
    memory = new SharedMemoryManager();
  });

  describe('Insight Management', () => {
    it('should store insights', async () => {
      const insight: Insight = {
        id: 'insight-1',
        type: 'optimization',
        description: 'Use memoization for expensive calculations',
        evidence: ['Performance improved by 50%', 'Memory usage acceptable'],
        confidence: 0.85,
        timestamp: new Date(),
        contributor: 'claude-1'
      };

      await memory.addInsight(insight);
      const retrieved = await memory.getInsight('insight-1');
      expect(retrieved).toEqual(insight);
    });

    it('should retrieve insights by type', async () => {
      const optimization: Insight = {
        id: 'opt-1',
        type: 'optimization',
        description: 'Cache results',
        evidence: [],
        confidence: 0.8,
        timestamp: new Date(),
        contributor: 'claude-1'
      };

      const bug: Insight = {
        id: 'bug-1',
        type: 'bug',
        description: 'Race condition in async handler',
        evidence: [],
        confidence: 0.9,
        timestamp: new Date(),
        contributor: 'claude-2'
      };

      await memory.addInsight(optimization);
      await memory.addInsight(bug);

      const optimizations = await memory.getInsightsByType('optimization');
      expect(optimizations).toHaveLength(1);
      expect(optimizations[0].id).toBe('opt-1');
    });

    it('should merge similar insights', async () => {
      const insight1: Insight = {
        id: 'i1',
        type: 'pattern',
        description: 'Users prefer dark mode',
        evidence: ['Survey result A'],
        confidence: 0.7,
        timestamp: new Date(),
        contributor: 'claude-1'
      };

      const insight2: Insight = {
        id: 'i2',
        type: 'pattern',
        description: 'Users prefer dark mode',
        evidence: ['Survey result B'],
        confidence: 0.8,
        timestamp: new Date(),
        contributor: 'claude-2'
      };

      await memory.addInsight(insight1);
      await memory.addInsight(insight2);

      const merged = await memory.mergeInsights(['i1', 'i2']);
      expect(merged.evidence).toContain('Survey result A');
      expect(merged.evidence).toContain('Survey result B');
      expect(merged.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('Pattern Recognition', () => {
    it('should store and retrieve patterns', async () => {
      const pattern: Pattern = {
        id: 'pattern-1',
        type: 'success',
        description: 'TDD leads to fewer bugs',
        occurrences: 10,
        context: ['test-first', 'refactoring'],
        impact: 0.8,
        recommendations: ['Always write tests first']
      };

      await memory.addPattern(pattern);
      const retrieved = await memory.getPattern('pattern-1');
      expect(retrieved).toEqual(pattern);
    });

    it('should update pattern occurrences', async () => {
      const pattern: Pattern = {
        id: 'p1',
        type: 'workflow',
        description: 'Code review improves quality',
        occurrences: 5,
        context: [],
        impact: 0.7,
        recommendations: []
      };

      await memory.addPattern(pattern);
      await memory.recordPatternOccurrence('p1');

      const updated = await memory.getPattern('p1');
      expect(updated?.occurrences).toBe(6);
    });

    it('should find patterns by context', async () => {
      const pattern: Pattern = {
        id: 'p2',
        type: 'optimization',
        description: 'Caching improves performance',
        occurrences: 15,
        context: ['performance', 'caching', 'database'],
        impact: 0.9,
        recommendations: ['Implement Redis cache']
      };

      await memory.addPattern(pattern);
      const patterns = await memory.findPatternsByContext('caching');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].id).toBe('p2');
    });
  });

  describe('Solution Repository', () => {
    it('should store solutions', async () => {
      const solution: Solution = {
        id: 'sol-1',
        problemId: 'problem-1',
        description: 'Use connection pooling',
        implementation: 'const pool = createPool({max: 10})',
        effectiveness: 0.85,
        usedBy: ['claude-1'],
        timestamp: new Date()
      };

      await memory.addSolution(solution);
      const retrieved = await memory.getSolution('sol-1');
      expect(retrieved).toEqual(solution);
    });

    it('should track solution usage', async () => {
      const solution: Solution = {
        id: 's1',
        problemId: 'p1',
        description: 'Retry with exponential backoff',
        implementation: 'retry(fn, {backoff: exponential})',
        effectiveness: 0.8,
        usedBy: ['claude-1'],
        timestamp: new Date()
      };

      await memory.addSolution(solution);
      await memory.recordSolutionUsage('s1', 'claude-2');

      const updated = await memory.getSolution('s1');
      expect(updated?.usedBy).toContain('claude-2');
      expect(updated?.usedBy).toHaveLength(2);
    });

    it('should find solutions for problem', async () => {
      const solution: Solution = {
        id: 's2',
        problemId: 'memory-leak',
        description: 'Clean up event listeners',
        implementation: 'removeEventListener in cleanup',
        effectiveness: 0.9,
        usedBy: [],
        timestamp: new Date()
      };

      await memory.addSolution(solution);
      const solutions = await memory.getSolutionsForProblem('memory-leak');
      expect(solutions).toHaveLength(1);
      expect(solutions[0].id).toBe('s2');
    });
  });

  describe('Working Context Management', () => {
    it('should manage agent working contexts', async () => {
      const context: WorkingContext = {
        agentId: 'claude-1',
        taskId: 'task-123',
        relevantNodes: ['node-1', 'node-2'],
        activeFiles: ['file1.ts', 'file2.ts'],
        decisions: [],
        assumptions: [],
        constraints: []
      };

      await memory.setWorkingContext('claude-1', context);
      const retrieved = await memory.getWorkingContext('claude-1');
      expect(retrieved).toEqual(context);
    });

    it('should update working context', async () => {
      const context: WorkingContext = {
        agentId: 'claude-1',
        taskId: 'task-123',
        relevantNodes: [],
        activeFiles: ['file1.ts'],
        decisions: [],
        assumptions: [],
        constraints: []
      };

      await memory.setWorkingContext('claude-1', context);
      await memory.updateWorkingContext('claude-1', {
        activeFiles: ['file1.ts', 'file2.ts']
      });

      const updated = await memory.getWorkingContext('claude-1');
      expect(updated?.activeFiles).toContain('file2.ts');
    });

    it('should clear working context', async () => {
      const context: WorkingContext = {
        agentId: 'claude-1',
        taskId: 'task-123',
        relevantNodes: [],
        activeFiles: [],
        decisions: [],
        assumptions: [],
        constraints: []
      };

      await memory.setWorkingContext('claude-1', context);
      await memory.clearWorkingContext('claude-1');

      const retrieved = await memory.getWorkingContext('claude-1');
      expect(retrieved).toBeNull();
    });
  });

  describe('Decision Management', () => {
    it('should track pending decisions', async () => {
      const decision: DecisionRequest = {
        id: 'dec-1',
        type: 'architecture',
        description: 'Choose between REST and GraphQL',
        options: [
          {
            id: 'opt-1',
            description: 'Use REST',
            pros: ['Simple', 'Well understood'],
            cons: ['Over-fetching'],
            confidence: 0.7
          },
          {
            id: 'opt-2',
            description: 'Use GraphQL',
            pros: ['Flexible queries'],
            cons: ['Complexity'],
            confidence: 0.6
          }
        ],
        requestedBy: 'claude-1',
        timestamp: new Date()
      };

      await memory.addDecisionRequest(decision);
      const pending = await memory.getPendingDecisions();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('dec-1');
    });

    it('should resolve decisions', async () => {
      const decision: DecisionRequest = {
        id: 'dec-2',
        type: 'technical',
        description: 'Database choice',
        options: [],
        requestedBy: 'claude-1',
        timestamp: new Date()
      };

      await memory.addDecisionRequest(decision);
      await memory.resolveDecision('dec-2', 'opt-1', 'Better performance');

      const pending = await memory.getPendingDecisions();
      expect(pending).toHaveLength(0);

      const resolved = await memory.getResolvedDecision('dec-2');
      expect(resolved).toBeDefined();
      expect(resolved?.rationale).toBe('Better performance');
    });
  });

  describe('Task Completion Tracking', () => {
    it('should record task completions', async () => {
      const completion: TaskCompletion = {
        taskId: 'task-123',
        completedBy: 'claude-1',
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(),
        success: true,
        metrics: {
          duration: 3600000,
          linesAdded: 100,
          linesRemoved: 20,
          filesChanged: 3,
          testsAdded: 5,
          testsPassed: 5,
          coverage: 85
        },
        insights: ['Mocking was complex'],
        issues: []
      };

      await memory.recordTaskCompletion(completion);
      const retrieved = await memory.getTaskCompletion('task-123');
      expect(retrieved).toEqual(completion);
    });

    it('should analyze task metrics', async () => {
      const completion1: TaskCompletion = {
        taskId: 't1',
        completedBy: 'claude-1',
        startTime: new Date(Date.now() - 7200000),
        endTime: new Date(Date.now() - 3600000),
        success: true,
        metrics: {
          duration: 3600000,
          linesAdded: 100,
          linesRemoved: 20,
          filesChanged: 3,
          testsAdded: 5,
          testsPassed: 5,
          coverage: 85
        },
        insights: [],
        issues: []
      };

      const completion2: TaskCompletion = {
        taskId: 't2',
        completedBy: 'claude-2',
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(),
        success: true,
        metrics: {
          duration: 3600000,
          linesAdded: 200,
          linesRemoved: 50,
          filesChanged: 5,
          testsAdded: 10,
          testsPassed: 10,
          coverage: 90
        },
        insights: [],
        issues: []
      };

      await memory.recordTaskCompletion(completion1);
      await memory.recordTaskCompletion(completion2);

      const avgMetrics = await memory.getAverageTaskMetrics();
      expect(avgMetrics.duration).toBe(3600000);
      expect(avgMetrics.linesAdded).toBe(150);
      expect(avgMetrics.coverage).toBe(87.5);
    });
  });

  describe('Error Pattern Database', () => {
    it('should track error patterns', async () => {
      const errorPattern: ErrorPattern = {
        id: 'err-1',
        pattern: 'Cannot read property of undefined',
        frequency: 5,
        lastSeen: new Date(),
        solutions: ['Add null checks', 'Use optional chaining'],
        preventionMeasures: ['TypeScript strict mode']
      };

      await memory.addErrorPattern(errorPattern);
      const retrieved = await memory.getErrorPattern('err-1');
      expect(retrieved).toEqual(errorPattern);
    });

    it('should increment error frequency', async () => {
      const errorPattern: ErrorPattern = {
        id: 'err-2',
        pattern: 'Connection timeout',
        frequency: 3,
        lastSeen: new Date(Date.now() - 86400000),
        solutions: ['Increase timeout', 'Add retry logic'],
        preventionMeasures: []
      };

      await memory.addErrorPattern(errorPattern);
      // Add small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 1));
      await memory.recordErrorOccurrence('err-2');

      const updated = await memory.getErrorPattern('err-2');
      expect(updated?.frequency).toBe(4);
      expect(updated?.lastSeen.getTime()).toBeGreaterThan(errorPattern.lastSeen.getTime());
    });

    it('should find similar error patterns', async () => {
      const pattern1: ErrorPattern = {
        id: 'e1',
        pattern: 'Cannot connect to database',
        frequency: 10,
        lastSeen: new Date(),
        solutions: ['Check connection string'],
        preventionMeasures: []
      };

      const pattern2: ErrorPattern = {
        id: 'e2',
        pattern: 'Database connection failed',
        frequency: 5,
        lastSeen: new Date(),
        solutions: ['Verify credentials'],
        preventionMeasures: []
      };

      await memory.addErrorPattern(pattern1);
      await memory.addErrorPattern(pattern2);

      const similar = await memory.findSimilarErrorPatterns('database');
      expect(similar).toHaveLength(2);
    });
  });

  describe('Knowledge Synthesis', () => {
    it('should synthesize knowledge from multiple agents', async () => {
      const contributions: AgentContribution[] = [
        {
          agentId: 'claude-1',
          contribution: 'Use async/await for better readability',
          timestamp: new Date(),
          confidence: 0.8,
          evidence: ['Code review feedback']
        },
        {
          agentId: 'claude-2',
          contribution: 'Async/await improves error handling',
          timestamp: new Date(),
          confidence: 0.9,
          evidence: ['Error rate decreased by 30%']
        }
      ];

      const synthesis = await memory.synthesizeKnowledge(contributions);
      expect(synthesis.confidence).toBeGreaterThan(0.8);
      expect(synthesis.synthesizedKnowledge.content).toContain('async/await');
    });

    it('should detect conflicts in knowledge', async () => {
      const contributions: AgentContribution[] = [
        {
          agentId: 'claude-1',
          contribution: 'Use MongoDB for flexibility',
          timestamp: new Date(),
          confidence: 0.7,
          evidence: []
        },
        {
          agentId: 'claude-2',
          contribution: 'Use PostgreSQL for ACID compliance',
          timestamp: new Date(),
          confidence: 0.8,
          evidence: []
        }
      ];

      const synthesis = await memory.synthesizeKnowledge(contributions);
      expect(synthesis.conflicts).toBeDefined();
      expect(synthesis.conflicts?.length).toBeGreaterThan(0);
    });

    it('should resolve conflicts', async () => {
      const conflict: Conflict = {
        id: 'conflict-1',
        type: 'decision',
        description: 'Database choice conflict',
        parties: ['claude-1', 'claude-2'],
        proposals: [
          {
            proposedBy: 'claude-1',
            solution: 'Use MongoDB',
            rationale: 'Better for unstructured data',
            support: ['claude-3'],
            opposition: ['claude-2']
          }
        ],
        status: 'open'
      };

      await memory.addConflict(conflict);

      const strategy: ResolutionStrategy = {
        type: 'voting',
        description: 'Team vote decided PostgreSQL',
        result: 'Use PostgreSQL',
        implementedBy: 'claude-2',
        timestamp: new Date()
      };

      await memory.resolveConflict('conflict-1', strategy);
      const resolved = await memory.getConflict('conflict-1');
      expect(resolved?.status).toBe('resolved');
    });
  });

  describe('Memory Cleanup and Maintenance', () => {
    it('should prune old insights', async () => {
      const oldInsight: Insight = {
        id: 'old-1',
        type: 'pattern',
        description: 'Old pattern',
        evidence: [],
        confidence: 0.5,
        timestamp: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days old
        contributor: 'claude-1'
      };

      const newInsight: Insight = {
        id: 'new-1',
        type: 'pattern',
        description: 'New pattern',
        evidence: [],
        confidence: 0.9,
        timestamp: new Date(),
        contributor: 'claude-2'
      };

      await memory.addInsight(oldInsight);
      await memory.addInsight(newInsight);

      await memory.pruneOldData(30); // Keep only last 30 days

      const old = await memory.getInsight('old-1');
      const recent = await memory.getInsight('new-1');

      expect(old).toBeNull();
      expect(recent).toBeDefined();
    });

    it('should export and import memory state', async () => {
      const insight: Insight = {
        id: 'export-1',
        type: 'optimization',
        description: 'Test insight',
        evidence: [],
        confidence: 0.8,
        timestamp: new Date(),
        contributor: 'claude-1'
      };

      await memory.addInsight(insight);

      const exported = await memory.exportState();

      // Create new memory instance
      const newMemory = new SharedMemoryManager();
      await newMemory.importState(exported);

      const imported = await newMemory.getInsight('export-1');
      expect(imported?.description).toBe('Test insight');
    });
  });

  describe('Memory Search and Query', () => {
    it('should search across all knowledge types', async () => {
      const insight: Insight = {
        id: 'search-1',
        type: 'optimization',
        description: 'Cache database queries',
        evidence: [],
        confidence: 0.8,
        timestamp: new Date(),
        contributor: 'claude-1'
      };

      const pattern: Pattern = {
        id: 'search-2',
        type: 'success',
        description: 'Caching reduces database load',
        occurrences: 5,
        context: [],
        impact: 0.9,
        recommendations: []
      };

      await memory.addInsight(insight);
      await memory.addPattern(pattern);

      const results = await memory.search('database');
      expect(results).toHaveLength(2);
    });

    it('should rank search results by relevance', async () => {
      const highRelevance: Insight = {
        id: 'hr-1',
        type: 'bug',
        description: 'Critical database bug',
        evidence: [],
        confidence: 0.95,
        timestamp: new Date(),
        contributor: 'claude-1'
      };

      const lowRelevance: Insight = {
        id: 'lr-1',
        type: 'pattern',
        description: 'Minor pattern with database mention',
        evidence: [],
        confidence: 0.3,
        timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        contributor: 'claude-2'
      };

      await memory.addInsight(highRelevance);
      await memory.addInsight(lowRelevance);

      const results = await memory.search('database');
      expect(results[0].id).toBe('hr-1'); // Higher confidence and newer should rank first
    });
  });
});