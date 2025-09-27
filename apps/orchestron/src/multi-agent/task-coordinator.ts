import { v4 as uuid } from 'uuid';
import { AgentIdentityManager } from './agent-identity.js';
import { SharedMemoryManager } from './shared-memory.js';
import {
  AgentAssignment,
  TaskDistribution,
  CollaborationPattern,
  AgentPerformance,
  TaskRequirements,
  AgentIdentity
} from './types.js';

interface Task {
  taskId: string;
  type: string;
  requirements?: TaskRequirements;
}

interface ExecutionOptions {
  maxConcurrency: number;
  timeout: number;
}

interface PatternExecution {
  patternName: string;
  agents: string[];
  status: string;
  startTime: Date;
}

interface SwarmOptions {
  minAgents: number;
  maxAgents: number;
  strategy: string;
}

interface SwarmResult {
  participatingAgents: string[];
  assignments: AgentAssignment[];
}

interface HandoffRequest {
  targetAgent: string;
  reason: string;
  context: any;
}

interface HandoffResult {
  fromAgent: string;
  toAgent: string;
  taskId: string;
  progress: number;
  timestamp: Date;
}

interface VotingRequest {
  question: string;
  options: string[];
  voters: string[];
  deadline: Date;
}

interface VotingResult {
  votes: Array<{ voter: string; choice: string }>;
  winner: string;
  consensus: number;
}

interface ConsensusRequest {
  topic: string;
  participants: string[];
  proposals: Array<{ agent: string; proposal: string; rationale: string }>;
  method: string;
}

interface ConsensusResult {
  finalDecision: string;
  agreement: number;
  dissent: string[];
}

interface DependencyGraph {
  [taskId: string]: {
    dependencies: string[];
    type: string;
  };
}

interface GraphExecution {
  executionOrder: string[];
  parallelGroups: string[][];
}

export class TaskCoordinator {
  private assignments: Map<string, AgentAssignment> = new Map();
  private patterns: Map<string, CollaborationPattern> = new Map();
  private performance: Map<string, AgentPerformance> = new Map();
  private taskProgress: Map<string, number> = new Map();
  private unavailableAgents: Set<string> = new Set();
  private patternExecutions: Map<string, PatternExecution> = new Map();

  constructor(
    private identityManager: AgentIdentityManager,
    private memoryManager: SharedMemoryManager
  ) {}

  async assignTask(task: Task): Promise<AgentAssignment> {
    // Find best agent for task
    const availableAgents = await this.identityManager.getAvailableAgents();
    let selectedAgent: AgentIdentity | null = null;

    // Check if task has specific requirements
    if (task.requirements && Object.keys(task.requirements).length > 0) {
      selectedAgent = await this.identityManager.findBestAgentForTask(task.requirements);
    }

    // If no specific match, try to find agent by task type
    if (!selectedAgent && task.type && availableAgents.length > 0) {
      // Filter out unavailable agents
      const activeAgents = availableAgents.filter(a => !this.unavailableAgents.has(a.id));

      // Try to find agent with matching specialization
      selectedAgent = activeAgents.find(a => a.specialization?.includes(task.type)) || null;

      // If still no match, pick first available
      if (!selectedAgent && activeAgents.length > 0) {
        selectedAgent = activeAgents[0];
      }
    }

    if (!selectedAgent) {
      throw new Error('No available agents for task');
    }

    const assignment: AgentAssignment = {
      id: uuid(),
      agentId: selectedAgent.id,
      taskId: task.taskId,
      assignedAt: new Date(),
      status: 'pending',
      progress: 0
    };

    this.assignments.set(assignment.id, assignment);
    this.taskProgress.set(task.taskId, 0);

    // Mark agent as busy with this task
    await this.identityManager.assignTask(selectedAgent.id, task.taskId);

    return assignment;
  }

  async distributeTasks(
    tasks: Task[],
    strategy: 'round-robin' | 'expertise' | 'load-balanced' | 'auction' | 'performance-based'
  ): Promise<TaskDistribution> {
    const assignments = new Map<string, string[]>();
    const availableAgents = await this.identityManager.getAvailableAgents();

    // Initialize assignment map
    availableAgents.forEach(agent => {
      if (!this.unavailableAgents.has(agent.id)) {
        assignments.set(agent.id, []);
      }
    });

    switch (strategy) {
      case 'round-robin':
        await this.distributeRoundRobin(tasks, Array.from(assignments.keys()), assignments);
        break;

      case 'expertise':
        await this.distributeByExpertise(tasks, availableAgents, assignments);
        break;

      case 'load-balanced':
        await this.distributeLoadBalanced(tasks, Array.from(assignments.keys()), assignments);
        break;

      case 'performance-based':
        await this.distributeByPerformance(tasks, Array.from(assignments.keys()), assignments);
        break;

      case 'auction':
        // Simplified auction strategy - similar to expertise for now
        await this.distributeByExpertise(tasks, availableAgents, assignments);
        break;
    }

    // Create actual assignments
    for (const [agentId, taskIds] of assignments) {
      for (const taskId of taskIds) {
        const assignment: AgentAssignment = {
          id: uuid(),
          agentId,
          taskId,
          assignedAt: new Date(),
          status: 'pending',
          progress: 0
        };
        this.assignments.set(assignment.id, assignment);
        this.taskProgress.set(taskId, 0);
      }
    }

    return {
      strategy,
      assignments,
      rationale: `Tasks distributed using ${strategy} strategy`,
      expectedCompletion: new Date(Date.now() + 86400000) // 1 day estimate
    };
  }

  private async distributeRoundRobin(
    tasks: Task[],
    agents: string[],
    assignments: Map<string, string[]>
  ): Promise<void> {
    let agentIndex = 0;
    for (const task of tasks) {
      const agentId = agents[agentIndex % agents.length];
      assignments.get(agentId)?.push(task.taskId);
      agentIndex++;
    }
  }

  private async distributeByExpertise(
    tasks: Task[],
    agents: AgentIdentity[],
    assignments: Map<string, string[]>
  ): Promise<void> {
    for (const task of tasks) {
      let bestAgent: AgentIdentity | null = null;

      // Find agent with matching specialization
      for (const agent of agents) {
        if (this.unavailableAgents.has(agent.id)) continue;

        if (agent.specialization?.includes(task.type)) {
          bestAgent = agent;
          break;
        }
      }

      // Fallback to first available agent
      if (!bestAgent) {
        bestAgent = agents.find(a => !this.unavailableAgents.has(a.id)) || null;
      }

      if (bestAgent) {
        assignments.get(bestAgent.id)?.push(task.taskId);
      }
    }
  }

  private async distributeLoadBalanced(
    tasks: Task[],
    agents: string[],
    assignments: Map<string, string[]>
  ): Promise<void> {
    // Count existing assignments
    const load = new Map<string, number>();
    for (const agent of agents) {
      const existingTasks = Array.from(this.assignments.values()).filter(
        a => a.agentId === agent && a.status !== 'completed'
      ).length;
      load.set(agent, existingTasks);
    }

    // Distribute tasks to least loaded agents
    for (const task of tasks) {
      let minLoad = Infinity;
      let selectedAgent = '';

      for (const [agent, agentLoad] of load) {
        const currentLoad = agentLoad + (assignments.get(agent)?.length || 0);
        if (currentLoad < minLoad) {
          minLoad = currentLoad;
          selectedAgent = agent;
        }
      }

      if (selectedAgent) {
        assignments.get(selectedAgent)?.push(task.taskId);
      }
    }
  }

  private async distributeByPerformance(
    tasks: Task[],
    agents: string[],
    assignments: Map<string, string[]>
  ): Promise<void> {
    // Sort agents by performance
    const sortedAgents = agents.sort((a, b) => {
      const perfA = this.performance.get(a);
      const perfB = this.performance.get(b);

      if (!perfA) return 1;
      if (!perfB) return -1;

      // Sort by success rate and speed
      const scoreA = perfA.successRate * (1 / perfA.avgCompletionTime);
      const scoreB = perfB.successRate * (1 / perfB.avgCompletionTime);

      return scoreB - scoreA;
    });

    // Assign critical tasks to best performers
    for (const task of tasks) {
      const isCritical = task.type === 'critical';
      const agent = isCritical ? sortedAgents[0] : sortedAgents[sortedAgents.length - 1];

      assignments.get(agent)?.push(task.taskId);
    }
  }

  async updateProgress(assignmentId: string, progress: number): Promise<void> {
    const assignment = this.assignments.get(assignmentId);
    if (assignment) {
      assignment.progress = progress;
      this.taskProgress.set(assignment.taskId, progress);

      if (progress > 0) {
        assignment.status = 'in_progress';
      }
    }
  }

  async getTaskProgress(taskId: string): Promise<number> {
    return this.taskProgress.get(taskId) || 0;
  }

  async completeTask(
    assignmentId: string,
    result: { success: boolean; error?: string }
  ): Promise<void> {
    const assignment = this.assignments.get(assignmentId);
    if (assignment) {
      assignment.status = result.success ? 'completed' : 'failed';
      assignment.progress = result.success ? 100 : assignment.progress;
      this.taskProgress.set(assignment.taskId, assignment.progress);

      // Update agent reputation
      await this.identityManager.updateReputation(assignment.agentId, {
        success: result.success
      });
    }
  }

  async getAssignmentStatus(assignmentId: string): Promise<string> {
    return this.assignments.get(assignmentId)?.status || 'unknown';
  }

  async executeInParallel(tasks: Task[], options: ExecutionOptions): Promise<AgentAssignment[]> {
    const results: AgentAssignment[] = [];
    const batches: Task[][] = [];

    // Split tasks into batches based on concurrency
    for (let i = 0; i < tasks.length; i += options.maxConcurrency) {
      batches.push(tasks.slice(i, i + options.maxConcurrency));
    }

    // Execute batches
    for (const batch of batches) {
      const batchAssignments = await Promise.allSettled(
        batch.map(task => this.assignTask(task))
      );

      for (let i = 0; i < batchAssignments.length; i++) {
        const result = batchAssignments[i];
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          // Create a pending assignment for failed tasks
          const failedTask = batch[i];
          const pendingAssignment: AgentAssignment = {
            id: uuid(),
            agentId: '',  // No agent assigned yet
            taskId: failedTask.taskId,
            assignedAt: new Date(),
            status: 'pending',
            progress: 0
          };
          results.push(pendingAssignment);
        }
      }
    }

    return results;
  }

  async registerPattern(pattern: CollaborationPattern): Promise<void> {
    this.patterns.set(pattern.name, pattern);
  }

  async getPattern(name: string): Promise<CollaborationPattern | null> {
    return this.patterns.get(name) || null;
  }

  async executePattern(
    patternName: string,
    context: { taskId: string; context: any }
  ): Promise<PatternExecution> {
    const pattern = this.patterns.get(patternName);
    if (!pattern) {
      throw new Error(`Pattern ${patternName} not found`);
    }

    // Find agents for each role
    const agents: string[] = [];
    for (const role of pattern.agents) {
      const agent = await this.identityManager.findBestAgentForTask({
        requiredTools: role.requiredCapabilities
      });
      if (agent) {
        agents.push(agent.id);
      }
    }

    const execution: PatternExecution = {
      patternName,
      agents,
      status: 'in_progress',
      startTime: new Date()
    };

    this.patternExecutions.set(context.taskId, execution);
    return execution;
  }

  async executeSwarm(tasks: Task[], options: SwarmOptions): Promise<SwarmResult> {
    const availableAgents = await this.identityManager.getAvailableAgents();
    const activeAgents = availableAgents.filter(a => !this.unavailableAgents.has(a.id));

    // Select agents for swarm
    const agentCount = Math.min(
      Math.max(options.minAgents, activeAgents.length),
      options.maxAgents
    );

    const participatingAgents = activeAgents.slice(0, agentCount).map(a => a.id);

    // Distribute tasks among swarm
    const assignments: AgentAssignment[] = [];
    let agentIndex = 0;

    for (const task of tasks) {
      const assignment: AgentAssignment = {
        id: uuid(),
        agentId: participatingAgents[agentIndex % participatingAgents.length],
        taskId: task.taskId,
        assignedAt: new Date(),
        status: 'pending',
        progress: 0
      };

      assignments.push(assignment);
      this.assignments.set(assignment.id, assignment);
      agentIndex++;
    }

    return {
      participatingAgents,
      assignments
    };
  }

  async markAgentUnavailable(agentId: string): Promise<void> {
    this.unavailableAgents.add(agentId);
  }

  async rebalanceTasks(): Promise<TaskDistribution> {
    const activeAssignments = Array.from(this.assignments.values()).filter(
      a => a.status === 'pending' || a.status === 'in_progress'
    );

    // Get tasks from unavailable agents
    const tasksToRebalance: Task[] = [];
    for (const assignment of activeAssignments) {
      if (this.unavailableAgents.has(assignment.agentId)) {
        tasksToRebalance.push({
          taskId: assignment.taskId,
          type: 'general'
        });
      }
    }

    // Redistribute tasks
    return this.distributeTasks(tasksToRebalance, 'load-balanced');
  }

  async updatePerformance(performance: AgentPerformance): Promise<void> {
    this.performance.set(performance.agentId, performance);
  }

  async executeDependencyGraph(graph: DependencyGraph): Promise<GraphExecution> {
    // Check for circular dependencies
    if (this.hasCircularDependency(graph)) {
      throw new Error('Circular dependency detected');
    }

    // Build execution order
    const executionOrder: string[] = [];
    const parallelGroups: string[][] = [];
    const visited = new Set<string>();

    // Find tasks with no dependencies
    const rootTasks = Object.keys(graph).filter(
      task => graph[task].dependencies.length === 0
    );

    if (rootTasks.length > 0) {
      parallelGroups.push(rootTasks);
      rootTasks.forEach(t => {
        executionOrder.push(t);
        visited.add(t);
      });
    }

    // Build remaining groups
    while (visited.size < Object.keys(graph).length) {
      const nextGroup: string[] = [];

      for (const [task, info] of Object.entries(graph)) {
        if (!visited.has(task)) {
          const depsResolved = info.dependencies.every(dep => visited.has(dep));
          if (depsResolved) {
            nextGroup.push(task);
          }
        }
      }

      if (nextGroup.length > 0) {
        parallelGroups.push(nextGroup);
        nextGroup.forEach(t => {
          executionOrder.push(t);
          visited.add(t);
        });
      }
    }

    return {
      executionOrder,
      parallelGroups
    };
  }

  private hasCircularDependency(graph: DependencyGraph): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (task: string): boolean => {
      visited.add(task);
      recursionStack.add(task);

      const deps = graph[task]?.dependencies || [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) {
            return true;
          }
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }

      recursionStack.delete(task);
      return false;
    };

    for (const task of Object.keys(graph)) {
      if (!visited.has(task)) {
        if (hasCycle(task)) {
          return true;
        }
      }
    }

    return false;
  }

  async initiateHandoff(
    assignmentId: string,
    request: HandoffRequest
  ): Promise<HandoffResult> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) {
      throw new Error('Assignment not found');
    }

    const progress = this.taskProgress.get(assignment.taskId) || 0;

    // Save original agent before updating
    const originalAgent = assignment.agentId;

    // Create handoff
    await this.identityManager.createHandoff({
      fromAgent: originalAgent,
      toAgent: request.targetAgent,
      task: assignment.taskId,
      context: {
        currentProgress: progress,
        completedSteps: [],
        remainingWork: [],
        sharedKnowledge: request.context,
        warnings: []
      },
      reason: request.reason
    });

    // Update assignment
    assignment.agentId = request.targetAgent;
    assignment.status = 'handed_off';

    return {
      fromAgent: originalAgent,
      toAgent: request.targetAgent,
      taskId: assignment.taskId,
      progress,
      timestamp: new Date()
    };
  }

  async coordinateVoting(request: VotingRequest): Promise<VotingResult> {
    const votes: Array<{ voter: string; choice: string }> = [];

    // Simulate voting (in real implementation, would query agents)
    for (const voter of request.voters) {
      const choice = request.options[Math.floor(Math.random() * request.options.length)];
      votes.push({ voter, choice });
    }

    // Count votes
    const counts = new Map<string, number>();
    for (const vote of votes) {
      counts.set(vote.choice, (counts.get(vote.choice) || 0) + 1);
    }

    // Find winner
    let winner = '';
    let maxVotes = 0;
    for (const [option, count] of counts) {
      if (count > maxVotes) {
        winner = option;
        maxVotes = count;
      }
    }

    return {
      votes,
      winner,
      consensus: maxVotes / votes.length
    };
  }

  async buildConsensus(request: ConsensusRequest): Promise<ConsensusResult> {
    // Simulate consensus building
    const finalDecision = request.proposals[0].proposal; // Simplified
    const agreement = 0.75; // 75% agreement
    const dissent = request.participants.slice(1); // Simplified

    return {
      finalDecision,
      agreement,
      dissent
    };
  }
}