import { v4 as uuid } from 'uuid';
import {
  AgentIdentity,
  AgentCapability,
  AgentSession,
  AgentHandoff,
  HandoffContext,
  SessionMetrics,
  ErrorInfo,
  TaskRequirements,
  SessionInfo
} from './types.js';

export class AgentIdentityManager {
  private agents: Map<string, AgentIdentity> = new Map();
  private sessions: Map<string, AgentSession> = new Map();
  private handoffs: AgentHandoff[] = [];
  private activeTasks: Map<string, Set<string>> = new Map();

  async registerAgent(agent: AgentIdentity): Promise<AgentIdentity> {
    if (this.agents.has(agent.id)) {
      throw new Error('Agent already registered');
    }
    this.agents.set(agent.id, agent);
    this.activeTasks.set(agent.id, new Set());
    return agent;
  }

  async getAgent(agentId: string): Promise<AgentIdentity | null> {
    return this.agents.get(agentId) || null;
  }

  async updateCapabilities(agentId: string, capabilities: AgentCapability[]): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    agent.capabilities = [...agent.capabilities, ...capabilities];
  }

  async startSession(agentId: string): Promise<AgentSession> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    const session: AgentSession = {
      agentId,
      sessionId: uuid(),
      startTime: new Date(),
      tasksCompleted: [],
      knowledgeGenerated: [],
      errors: [],
      performance: {
        tasksCompleted: 0,
        errors: 0,
        successRate: 1.0
      }
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  async endSession(sessionId: string): Promise<AgentSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.endTime = new Date();
    session.performance.duration = session.endTime.getTime() - session.startTime.getTime();

    // Update agent's session history
    const agent = this.agents.get(session.agentId);
    if (agent) {
      const sessionInfo: SessionInfo = {
        sessionId: session.sessionId,
        startTime: session.startTime,
        endTime: session.endTime,
        tasksCompleted: session.tasksCompleted.length,
        errors: session.errors.length,
        performance: session.performance
      };

      agent.sessionHistory.push(sessionInfo);

      // Keep only last 10 sessions
      if (agent.sessionHistory.length > 10) {
        agent.sessionHistory = agent.sessionHistory.slice(-10);
      }
    }

    return session;
  }

  async getSession(sessionId: string): Promise<AgentSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  async recordTaskCompletion(sessionId: string, taskId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.tasksCompleted.push(taskId);
    session.performance.tasksCompleted++;
    this.updateSuccessRate(session);
  }

  async recordError(sessionId: string, error: ErrorInfo): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.errors.push(error);
    session.performance.errors++;
    this.updateSuccessRate(session);
  }

  private updateSuccessRate(session: AgentSession): void {
    const total = session.performance.tasksCompleted + session.performance.errors;
    if (total > 0) {
      session.performance.successRate = session.performance.tasksCompleted / total;
    }
  }

  async getSessionMetrics(sessionId: string): Promise<SessionMetrics> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    return session.performance;
  }

  async createHandoff(handoff: AgentHandoff): Promise<AgentHandoff> {
    const fromAgent = this.agents.get(handoff.fromAgent);
    const toAgent = this.agents.get(handoff.toAgent);

    if (!fromAgent) {
      throw new Error('Source agent not found');
    }
    if (!toAgent) {
      throw new Error('Target agent not found');
    }

    handoff.timestamp = new Date();
    this.handoffs.push(handoff);

    // Transfer task from one agent to another
    const fromTasks = this.activeTasks.get(handoff.fromAgent);
    const toTasks = this.activeTasks.get(handoff.toAgent);

    if (fromTasks) {
      fromTasks.delete(handoff.task);
    }
    if (toTasks) {
      toTasks.add(handoff.task);
    }

    return handoff;
  }

  async getHandoffHistory(taskId: string): Promise<AgentHandoff[]> {
    return this.handoffs.filter(h => h.task === taskId);
  }

  async findBySpecialization(specialization: string): Promise<AgentIdentity[]> {
    return Array.from(this.agents.values()).filter(
      agent => agent.specialization?.includes(specialization) || false
    );
  }

  async findBestAgentForTask(requirements: TaskRequirements): Promise<AgentIdentity | null> {
    let candidates = Array.from(this.agents.values());

    // Filter by specialization
    if (requirements.requiredSpecialization?.length) {
      candidates = candidates.filter(agent =>
        requirements.requiredSpecialization!.some(spec =>
          agent.specialization?.includes(spec)
        )
      );
    }

    // Filter by required tools
    if (requirements.requiredTools?.length) {
      candidates = candidates.filter(agent =>
        requirements.requiredTools!.every(tool =>
          agent.capabilities.some(cap => cap.tool === tool)
        )
      );
    }

    // Filter by reputation
    if (requirements.preferredReputation !== undefined) {
      candidates = candidates.filter(
        agent => agent.reputation.score >= requirements.preferredReputation!
      );
    }

    // Sort by reputation and return best
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.reputation.score - a.reputation.score);
      return candidates[0];
    }

    return null;
  }

  async updateReputation(agentId: string, outcome: { success: boolean }): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    agent.reputation.totalTasks++;
    if (outcome.success) {
      agent.reputation.successfulTasks++;
    } else {
      agent.reputation.failedTasks++;
    }

    // Calculate weighted reputation score
    if (agent.reputation.totalTasks > 0) {
      agent.reputation.score = agent.reputation.successfulTasks / agent.reputation.totalTasks;
    }
  }

  async assignTask(agentId: string, taskId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    const tasks = this.activeTasks.get(agentId);
    if (tasks) {
      tasks.add(taskId);
    }
  }

  async isAgentAvailable(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    const activeTasks = this.activeTasks.get(agentId);
    const currentTaskCount = activeTasks?.size || 0;

    return currentTaskCount < agent.preferences.maxConcurrentTasks;
  }

  async getAvailableAgents(): Promise<AgentIdentity[]> {
    const available: AgentIdentity[] = [];

    for (const [agentId, agent] of this.agents) {
      const isAvailable = await this.isAgentAvailable(agentId);
      if (isAvailable) {
        available.push(agent);
      }
    }

    return available;
  }
}