import { v4 as uuid } from 'uuid';
import { Conflict, ResolutionStrategy, ConflictProposal as ConflictProposalType } from './types';

interface ConflictProposal {
  agent: string;
  value: any;
  type: string;
}

interface PriorityTask {
  agent: string;
  taskId: string;
  priority: number;
}

interface ExpertiseInfo {
  domain: string;
  level: number;
}

interface ConsensusOptions {
  method: string;
  rounds: number;
  threshold: number;
}

interface EscalationOptions {
  reason: string;
  escalateTo: string;
  priority?: string;
}

interface EscalatedConflict extends Conflict {
  escalation?: {
    reason: string;
    escalateTo: string;
    priority?: string;
    timestamp: Date;
  };
}

interface ResolutionAnalysis {
  mostUsed: string;
  methodCounts: Map<string, number>;
  successRate?: number;
}

type EscalationCallback = (event: { conflictId: string; reason: string }) => void;

export class ConflictResolver {
  private resolutionHistory: Map<string, ResolutionStrategy[]> = new Map();
  private escalationCallbacks: EscalationCallback[] = [];

  async detectConflict(proposals: ConflictProposal[]): Promise<Conflict | null> {
    // Check if all proposals have the same value
    const values = new Set(proposals.map(p => JSON.stringify(p.value)));

    if (values.size === 1) {
      // No conflict - all agree
      return null;
    }

    // Conflict detected
    return {
      id: uuid(),
      type: 'data',
      description: `Conflicting values for ${proposals[0].type}`,
      parties: proposals.map(p => p.agent),
      proposals: proposals.map(p => ({
        proposedBy: p.agent,
        solution: String(p.value),
        rationale: '',
        support: [],
        opposition: []
      })),
      status: 'open'
    };
  }

  async detectPriorityConflict(tasks: PriorityTask[]): Promise<Conflict | null> {
    // Group by taskId
    const taskGroups = new Map<string, PriorityTask[]>();
    for (const task of tasks) {
      const group = taskGroups.get(task.taskId) || [];
      group.push(task);
      taskGroups.set(task.taskId, group);
    }

    // Check for conflicts
    for (const [taskId, group] of taskGroups) {
      const priorities = new Set(group.map(t => t.priority));
      if (priorities.size > 1) {
        return {
          id: uuid(),
          type: 'priority',
          description: `Priority conflict for task ${taskId}`,
          parties: group.map(t => t.agent),
          proposals: group.map(t => ({
            proposedBy: t.agent,
            solution: `Priority ${t.priority}`,
            rationale: '',
            support: [],
            opposition: []
          })),
          status: 'open'
        };
      }
    }

    return null;
  }

  async resolveByVoting(conflict: Conflict): Promise<ResolutionStrategy> {
    // Count support for each proposal
    const voteCounts = new Map<string, number>();

    for (const proposal of conflict.proposals) {
      const support = proposal.support.length + 1; // +1 for proposer
      voteCounts.set(proposal.solution, support);
    }

    // Find winner
    let winner = '';
    let maxVotes = 0;
    for (const [solution, votes] of voteCounts) {
      if (votes > maxVotes) {
        winner = solution;
        maxVotes = votes;
      }
    }

    const strategy: ResolutionStrategy = {
      type: 'voting',
      description: `Resolved by majority vote (${maxVotes} votes)`,
      result: winner,
      implementedBy: conflict.parties[0],
      timestamp: new Date()
    };

    await this.recordResolution(conflict.id, strategy);
    return strategy;
  }

  async resolveByExpertise(
    conflict: Conflict,
    expertise: Map<string, ExpertiseInfo>
  ): Promise<ResolutionStrategy> {
    // Find proposal from agent with highest expertise
    let bestProposal = conflict.proposals[0];
    let maxExpertise = 0;

    for (const proposal of conflict.proposals) {
      const agentExpertise = expertise.get(proposal.proposedBy);
      if (agentExpertise && agentExpertise.level > maxExpertise) {
        maxExpertise = agentExpertise.level;
        bestProposal = proposal;
      }
    }

    const strategy: ResolutionStrategy = {
      type: 'expertise',
      description: `Resolved by domain expertise (${maxExpertise} level)`,
      result: bestProposal.solution,
      implementedBy: bestProposal.proposedBy,
      timestamp: new Date()
    };

    await this.recordResolution(conflict.id, strategy);
    return strategy;
  }

  async buildConsensus(
    conflict: Conflict,
    options: ConsensusOptions
  ): Promise<ResolutionStrategy> {
    // Simulate consensus building through discussion rounds
    // In a real implementation, this would involve actual agent communication

    // For simulation, pick the proposal with the best rationale
    const result = conflict.proposals[0]?.solution || 'Consensus reached';

    const strategy: ResolutionStrategy = {
      type: 'consensus',
      description: `Consensus built through ${options.rounds} rounds of discussion`,
      result,
      implementedBy: conflict.parties.join(', '),
      timestamp: new Date()
    };

    await this.recordResolution(conflict.id, strategy);
    return strategy;
  }

  async resolveByCompromise(conflict: Conflict): Promise<ResolutionStrategy> {
    // Find middle ground between proposals
    let compromiseResult = '';

    // Try to extract numeric values and average them
    const numericValues: number[] = [];
    for (const proposal of conflict.proposals) {
      const match = proposal.solution.match(/\d+/);
      if (match) {
        numericValues.push(parseInt(match[0]));
      }
    }

    if (numericValues.length > 0) {
      const average = Math.round(
        numericValues.reduce((a, b) => a + b, 0) / numericValues.length
      );
      compromiseResult = `${average} minutes`; // Assuming time-based conflict
    } else {
      // For non-numeric conflicts, combine solutions
      const solutions = conflict.proposals.map(p => p.solution);
      compromiseResult = `Hybrid approach: ${solutions.join(' + ')}`;
    }

    const strategy: ResolutionStrategy = {
      type: 'compromise',
      description: 'Resolved through compromise',
      result: compromiseResult,
      implementedBy: conflict.parties.join(', '),
      timestamp: new Date()
    };

    await this.recordResolution(conflict.id, strategy);
    return strategy;
  }

  async recordResolution(conflictId: string, strategy: ResolutionStrategy): Promise<void> {
    const history = this.resolutionHistory.get(conflictId) || [];
    history.push(strategy);
    this.resolutionHistory.set(conflictId, history);
  }

  async getResolutionHistory(conflictId: string): Promise<ResolutionStrategy[]> {
    return this.resolutionHistory.get(conflictId) || [];
  }

  async analyzeResolutionMethods(): Promise<ResolutionAnalysis> {
    const methodCounts = new Map<string, number>();

    for (const history of this.resolutionHistory.values()) {
      for (const resolution of history) {
        methodCounts.set(resolution.type, (methodCounts.get(resolution.type) || 0) + 1);
      }
    }

    // Find most used method
    let mostUsed = '';
    let maxCount = 0;
    for (const [method, count] of methodCounts) {
      if (count > maxCount) {
        mostUsed = method;
        maxCount = count;
      }
    }

    return {
      mostUsed,
      methodCounts
    };
  }

  async escalate(
    conflict: Conflict,
    options: EscalationOptions
  ): Promise<EscalatedConflict> {
    const escalated: EscalatedConflict = {
      ...conflict,
      status: 'escalated',
      escalation: {
        reason: options.reason,
        escalateTo: options.escalateTo,
        priority: options.priority,
        timestamp: new Date()
      }
    };

    // Notify callbacks
    for (const callback of this.escalationCallbacks) {
      callback({
        conflictId: conflict.id,
        reason: options.reason
      });
    }

    return escalated;
  }

  onEscalation(callback: EscalationCallback): void {
    this.escalationCallbacks.push(callback);
  }
}