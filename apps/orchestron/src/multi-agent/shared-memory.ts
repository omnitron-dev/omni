import { v4 as uuid } from 'uuid';
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
  AgentContribution,
  Decision,
  TaskMetrics
} from './types.js';

interface SearchResult {
  id: string;
  type: string;
  description: string;
  relevance: number;
}

export class SharedMemoryManager {
  private memory: SharedMemory;
  private resolvedDecisions: Map<string, Decision> = new Map();
  private conflicts: Map<string, Conflict> = new Map();

  constructor() {
    this.memory = {
      insights: new Map(),
      patterns: new Map(),
      solutions: new Map(),
      activeContexts: new Map(),
      pendingDecisions: [],
      completedTasks: new Map(),
      learnedPatterns: [],
      errorDatabase: []
    };
  }

  async addInsight(insight: Insight): Promise<void> {
    this.memory.insights.set(insight.id, insight);
  }

  async getInsight(id: string): Promise<Insight | null> {
    return this.memory.insights.get(id) || null;
  }

  async getInsightsByType(type: string): Promise<Insight[]> {
    return Array.from(this.memory.insights.values()).filter(
      insight => insight.type === type
    );
  }

  async mergeInsights(insightIds: string[]): Promise<Insight> {
    const insights = insightIds
      .map(id => this.memory.insights.get(id))
      .filter(Boolean) as Insight[];

    if (insights.length === 0) {
      throw new Error('No insights found to merge');
    }

    const mergedEvidence = new Set<string>();
    let totalConfidence = 0;
    const contributors = new Set<string>();

    insights.forEach(insight => {
      insight.evidence.forEach(e => mergedEvidence.add(e));
      totalConfidence += insight.confidence;
      contributors.add(insight.contributor);
    });

    const merged: Insight = {
      id: uuid(),
      type: insights[0].type,
      description: insights[0].description,
      evidence: Array.from(mergedEvidence),
      confidence: Math.min(1, totalConfidence / insights.length * 1.1), // Slight boost for consensus
      timestamp: new Date(),
      contributor: Array.from(contributors).join(', ')
    };

    await this.addInsight(merged);
    return merged;
  }

  async addPattern(pattern: Pattern): Promise<void> {
    this.memory.patterns.set(pattern.id, pattern);
    this.memory.learnedPatterns.push(pattern);
  }

  async getPattern(id: string): Promise<Pattern | null> {
    return this.memory.patterns.get(id) || null;
  }

  async recordPatternOccurrence(patternId: string): Promise<void> {
    const pattern = this.memory.patterns.get(patternId);
    if (pattern) {
      pattern.occurrences++;
    }
  }

  async findPatternsByContext(context: string): Promise<Pattern[]> {
    return Array.from(this.memory.patterns.values()).filter(
      pattern => pattern.context.includes(context)
    );
  }

  async addSolution(solution: Solution): Promise<void> {
    this.memory.solutions.set(solution.id, solution);
  }

  async getSolution(id: string): Promise<Solution | null> {
    return this.memory.solutions.get(id) || null;
  }

  async recordSolutionUsage(solutionId: string, agentId: string): Promise<void> {
    const solution = this.memory.solutions.get(solutionId);
    if (solution && !solution.usedBy.includes(agentId)) {
      solution.usedBy.push(agentId);
    }
  }

  async getSolutionsForProblem(problemId: string): Promise<Solution[]> {
    return Array.from(this.memory.solutions.values()).filter(
      solution => solution.problemId === problemId
    );
  }

  async setWorkingContext(agentId: string, context: WorkingContext): Promise<void> {
    this.memory.activeContexts.set(agentId, context);
  }

  async getWorkingContext(agentId: string): Promise<WorkingContext | null> {
    return this.memory.activeContexts.get(agentId) || null;
  }

  async updateWorkingContext(
    agentId: string,
    updates: Partial<WorkingContext>
  ): Promise<void> {
    const context = this.memory.activeContexts.get(agentId);
    if (context) {
      Object.assign(context, updates);
    }
  }

  async clearWorkingContext(agentId: string): Promise<void> {
    this.memory.activeContexts.delete(agentId);
  }

  async addDecisionRequest(request: DecisionRequest): Promise<void> {
    this.memory.pendingDecisions.push(request);
  }

  async getPendingDecisions(): Promise<DecisionRequest[]> {
    return this.memory.pendingDecisions;
  }

  async resolveDecision(
    decisionId: string,
    selectedOption: string,
    rationale: string
  ): Promise<void> {
    const index = this.memory.pendingDecisions.findIndex(d => d.id === decisionId);
    if (index !== -1) {
      const request = this.memory.pendingDecisions[index];

      const decision: Decision = {
        id: decisionId,
        type: request.type,
        description: request.description,
        rationale,
        madeBy: 'system',
        timestamp: new Date(),
        confidence: 0.8
      };

      this.resolvedDecisions.set(decisionId, decision);
      this.memory.pendingDecisions.splice(index, 1);
    }
  }

  async getResolvedDecision(decisionId: string): Promise<Decision | null> {
    return this.resolvedDecisions.get(decisionId) || null;
  }

  async recordTaskCompletion(completion: TaskCompletion): Promise<void> {
    this.memory.completedTasks.set(completion.taskId, completion);
  }

  async getTaskCompletion(taskId: string): Promise<TaskCompletion | null> {
    return this.memory.completedTasks.get(taskId) || null;
  }

  async getAverageTaskMetrics(): Promise<TaskMetrics> {
    const completions = Array.from(this.memory.completedTasks.values());

    if (completions.length === 0) {
      return {
        duration: 0,
        linesAdded: 0,
        linesRemoved: 0,
        filesChanged: 0,
        testsAdded: 0,
        testsPassed: 0,
        coverage: 0
      };
    }

    const sum = completions.reduce((acc, completion) => {
      const m = completion.metrics;
      return {
        duration: acc.duration + m.duration,
        linesAdded: acc.linesAdded + m.linesAdded,
        linesRemoved: acc.linesRemoved + m.linesRemoved,
        filesChanged: acc.filesChanged + m.filesChanged,
        testsAdded: acc.testsAdded + m.testsAdded,
        testsPassed: acc.testsPassed + m.testsPassed,
        coverage: acc.coverage + m.coverage
      };
    }, {
      duration: 0,
      linesAdded: 0,
      linesRemoved: 0,
      filesChanged: 0,
      testsAdded: 0,
      testsPassed: 0,
      coverage: 0
    });

    const count = completions.length;
    return {
      duration: sum.duration / count,
      linesAdded: sum.linesAdded / count,
      linesRemoved: sum.linesRemoved / count,
      filesChanged: sum.filesChanged / count,
      testsAdded: sum.testsAdded / count,
      testsPassed: sum.testsPassed / count,
      coverage: sum.coverage / count
    };
  }

  async addErrorPattern(pattern: ErrorPattern): Promise<void> {
    this.memory.errorDatabase.push(pattern);
  }

  async getErrorPattern(id: string): Promise<ErrorPattern | null> {
    return this.memory.errorDatabase.find(p => p.id === id) || null;
  }

  async recordErrorOccurrence(patternId: string): Promise<void> {
    const pattern = this.memory.errorDatabase.find(p => p.id === patternId);
    if (pattern) {
      pattern.frequency++;
      pattern.lastSeen = new Date();
    }
  }

  async findSimilarErrorPatterns(search: string): Promise<ErrorPattern[]> {
    const searchLower = search.toLowerCase();
    return this.memory.errorDatabase.filter(
      pattern => pattern.pattern.toLowerCase().includes(searchLower)
    );
  }

  async synthesizeKnowledge(contributions: AgentContribution[]): Promise<KnowledgeSynthesis> {
    const combinedContent: string[] = [];
    const allEvidence: string[] = [];
    let totalConfidence = 0;
    const contributors: string[] = [];

    contributions.forEach(contrib => {
      combinedContent.push(contrib.contribution);
      allEvidence.push(...contrib.evidence);
      totalConfidence += contrib.confidence;
      contributors.push(contrib.agentId);
    });

    // Check for conflicts
    const conflicts = this.detectConflicts(contributions);

    const synthesized: Knowledge = {
      id: uuid(),
      type: 'synthesized',
      content: combinedContent.join('. '),
      metadata: {
        created: new Date(),
        updated: new Date(),
        quality: totalConfidence / contributions.length,
        verifiedBy: [],
        tags: []
      },
      version: 1,
      contributors
    };

    return {
      sources: contributions,
      synthesizedKnowledge: synthesized,
      confidence: totalConfidence / contributions.length,
      conflicts: conflicts.length > 0 ? conflicts : undefined
    };
  }

  private detectConflicts(contributions: AgentContribution[]): Conflict[] {
    const conflicts: Conflict[] = [];

    // Simple conflict detection based on contradictory keywords
    const contradictions = [
      ['MongoDB', 'PostgreSQL'],
      ['REST', 'GraphQL'],
      ['synchronous', 'asynchronous']
    ];

    for (const [term1, term2] of contradictions) {
      const hasterm1 = contributions.filter(c => c.contribution.includes(term1));
      const hasterm2 = contributions.filter(c => c.contribution.includes(term2));

      if (hasterm1.length > 0 && hasterm2.length > 0) {
        conflicts.push({
          id: uuid(),
          type: 'decision',
          description: `Conflict between ${term1} and ${term2}`,
          parties: [...hasterm1.map(c => c.agentId), ...hasterm2.map(c => c.agentId)],
          proposals: [],
          status: 'open'
        });
      }
    }

    return conflicts;
  }

  async addConflict(conflict: Conflict): Promise<void> {
    this.conflicts.set(conflict.id, conflict);
  }

  async getConflict(id: string): Promise<Conflict | null> {
    return this.conflicts.get(id) || null;
  }

  async resolveConflict(conflictId: string, strategy: ResolutionStrategy): Promise<void> {
    const conflict = this.conflicts.get(conflictId);
    if (conflict) {
      conflict.status = 'resolved';
      // Store resolution strategy with the conflict
      (conflict as any).resolution = strategy;
    }
  }

  async pruneOldData(daysToKeep: number): Promise<void> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    // Prune old insights
    for (const [id, insight] of this.memory.insights) {
      if (insight.timestamp < cutoffDate) {
        this.memory.insights.delete(id);
      }
    }

    // Prune old error patterns
    this.memory.errorDatabase = this.memory.errorDatabase.filter(
      pattern => pattern.lastSeen >= cutoffDate
    );

    // Prune old completed tasks
    for (const [id, task] of this.memory.completedTasks) {
      if (task.endTime < cutoffDate) {
        this.memory.completedTasks.delete(id);
      }
    }
  }

  async exportState(): Promise<string> {
    const state = {
      insights: Array.from(this.memory.insights.entries()),
      patterns: Array.from(this.memory.patterns.entries()),
      solutions: Array.from(this.memory.solutions.entries()),
      activeContexts: Array.from(this.memory.activeContexts.entries()),
      pendingDecisions: this.memory.pendingDecisions,
      completedTasks: Array.from(this.memory.completedTasks.entries()),
      learnedPatterns: this.memory.learnedPatterns,
      errorDatabase: this.memory.errorDatabase,
      resolvedDecisions: Array.from(this.resolvedDecisions.entries()),
      conflicts: Array.from(this.conflicts.entries())
    };

    return JSON.stringify(state, null, 2);
  }

  async importState(stateJson: string): Promise<void> {
    const state = JSON.parse(stateJson);

    this.memory.insights = new Map(state.insights);
    this.memory.patterns = new Map(state.patterns);
    this.memory.solutions = new Map(state.solutions);
    this.memory.activeContexts = new Map(state.activeContexts);
    this.memory.pendingDecisions = state.pendingDecisions;
    this.memory.completedTasks = new Map(state.completedTasks);
    this.memory.learnedPatterns = state.learnedPatterns;
    this.memory.errorDatabase = state.errorDatabase;
    this.resolvedDecisions = new Map(state.resolvedDecisions || []);
    this.conflicts = new Map(state.conflicts || []);
  }

  async search(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    // Search insights
    for (const insight of this.memory.insights.values()) {
      if (insight.description.toLowerCase().includes(queryLower)) {
        results.push({
          id: insight.id,
          type: 'insight',
          description: insight.description,
          relevance: this.calculateRelevance(insight.description, query, insight.confidence, insight.timestamp)
        });
      }
    }

    // Search patterns
    for (const pattern of this.memory.patterns.values()) {
      if (pattern.description.toLowerCase().includes(queryLower)) {
        results.push({
          id: pattern.id,
          type: 'pattern',
          description: pattern.description,
          relevance: this.calculateRelevance(pattern.description, query, pattern.impact, new Date())
        });
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);
    return results;
  }

  private calculateRelevance(
    text: string,
    query: string,
    confidence: number,
    timestamp: Date
  ): number {
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();

    // Base relevance on exact match
    let relevance = textLower === queryLower ? 1.0 : 0.5;

    // Boost for confidence
    relevance *= confidence;

    // Recency factor (newer is better)
    const ageInDays = (Date.now() - timestamp.getTime()) / (24 * 60 * 60 * 1000);
    const recencyFactor = Math.max(0.5, 1 - ageInDays / 365);
    relevance *= recencyFactor;

    return relevance;
  }
}