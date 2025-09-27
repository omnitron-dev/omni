import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../storage/interface.js';
import { Author, DevelopmentNodeType } from './types.js';

export interface Session {
  id: string;
  agentId: string;
  startTime: Date;
  endTime?: Date;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  currentTask?: string;
  completedTasks: string[];
  context?: CompressedContext;
}

export interface CompressedContext {
  // Essential task information
  currentTask?: {
    id: string;
    title: string;
    progress: number;
    status: string;
  };

  // Completed work summary
  completedSteps: string[];

  // Next steps
  nextSteps: string[];

  // Critical decisions (key-value pairs)
  decisions: Record<string, string>;

  // Active files (just paths, not contents)
  activeFiles: string[];

  // Key insights
  insights: string[];

  // Blockers or issues
  blockers?: string[];

  // Session metadata
  timestamp: Date;
  agentId: string;
  sessionId: string;
}

export interface Handoff {
  fromSession: string;
  toSession?: string;
  task: string;
  context: CompressedContext;
  instructions: string;
  timestamp: Date;
}

export class SessionManager {
  private activeSessions: Map<string, Session> = new Map();
  private sessionContexts: Map<string, CompressedContext> = new Map();

  constructor(private storage: Storage) {}

  /**
   * Start a new session for an agent
   */
  async startSession(agentId: string): Promise<Session> {
    const session: Session = {
      id: uuidv4(),
      agentId,
      startTime: new Date(),
      status: 'ACTIVE',
      completedTasks: [],
    };

    this.activeSessions.set(session.id, session);
    await this.saveSession(session);

    return session;
  }

  /**
   * End a session and save final context
   */
  async endSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.endTime = new Date();
    session.status = 'COMPLETED';

    await this.saveSession(session);
    this.activeSessions.delete(sessionId);
  }

  /**
   * Save context for a session
   */
  async saveContext(sessionId: string, context: any): Promise<void> {
    const compressed = this.compressContext(context, sessionId);
    this.sessionContexts.set(sessionId, compressed);

    // Save to storage
    await this.storage.createNode?.({
      nodeId: `context-${sessionId}-${Date.now()}`,
      author: Author.SYSTEM,
      parentIds: [],
      nodeType: DevelopmentNodeType.DECISION,
      payload: compressed,
      metadata: {
        // Session info is stored in payload
      },
    });
  }

  /**
   * Load context for a session or the most recent context
   */
  async loadContext(sessionId?: string): Promise<CompressedContext | null> {
    if (sessionId) {
      return this.sessionContexts.get(sessionId) || null;
    }

    // Load most recent context from storage
    const nodes = this.storage.queryNodes ? await this.storage.queryNodes({
      type: DevelopmentNodeType.DECISION,
      metadata: { type: 'context' },
      limit: 1,
    }) : [];

    if (nodes.length > 0) {
      return nodes[0].payload as CompressedContext;
    }

    return null;
  }

  /**
   * Prepare handoff from one session to another
   */
  async prepareHandoff(fromSessionId: string, instructions?: string): Promise<Handoff> {
    const session = this.activeSessions.get(fromSessionId);
    if (!session) {
      throw new Error(`Session ${fromSessionId} not found`);
    }

    const context = await this.loadContext(fromSessionId);
    if (!context) {
      throw new Error(`No context found for session ${fromSessionId}`);
    }

    const handoff: Handoff = {
      fromSession: fromSessionId,
      task: session.currentTask || '',
      context,
      instructions: instructions || 'Continue from where previous session left off',
      timestamp: new Date(),
    };

    // Save handoff to storage
    await this.storage.createNode?.({
      nodeId: `handoff-${Date.now()}`,
      author: Author.SYSTEM,
      parentIds: [],
      nodeType: DevelopmentNodeType.DECISION,
      payload: handoff,
      metadata: {
        // Handoff info is stored in payload
      },
    });

    return handoff;
  }

  /**
   * Accept a handoff in a new session
   */
  async acceptHandoff(handoffId: string, newSessionId: string): Promise<void> {
    // Load handoff from storage
    const nodes = this.storage.queryNodes ? await this.storage.queryNodes({
      metadata: { type: 'handoff' },
      limit: 1,
    }) : [];

    if (nodes.length === 0) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    const handoff = nodes[0].payload as Handoff;
    handoff.toSession = newSessionId;

    const session = this.activeSessions.get(newSessionId);
    if (session) {
      session.currentTask = handoff.task;
      session.context = handoff.context;
      await this.saveSession(session);
    }
  }

  /**
   * Resume work from a previous session
   */
  async resumeWork(agentId: string): Promise<{
    task?: string;
    context?: CompressedContext;
    instructions: string;
  }> {
    // Find last session for this agent
    const nodes = this.storage.queryNodes ? await this.storage.queryNodes({
      metadata: { agentId, type: 'session' },
      limit: 1,
    }) : [];

    if (nodes.length > 0) {
      const lastSession = nodes[0].payload as Session;
      const context = await this.loadContext(lastSession.id);

      if (lastSession.currentTask && lastSession.status !== 'COMPLETED') {
        return {
          task: lastSession.currentTask,
          context: context || undefined,
          instructions: 'Continue from where you left off in the previous session',
        };
      }
    }

    // No unfinished work, pick new task
    return {
      instructions: 'No unfinished work found. Please select a new task from the backlog.',
    };
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Update session with current task
   */
  async updateSessionTask(sessionId: string, taskId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.currentTask = taskId;
      await this.saveSession(session);
    }
  }

  /**
   * Mark task as completed in session
   */
  async markTaskCompleted(sessionId: string, taskId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.completedTasks.push(taskId);
      if (session.currentTask === taskId) {
        session.currentTask = undefined;
      }
      await this.saveSession(session);
    }
  }

  /**
   * Compress context to reduce token usage
   */
  private compressContext(context: any, sessionId: string): CompressedContext {
    const session = this.activeSessions.get(sessionId);
    const agentId = session?.agentId || 'unknown';

    // Extract essential information only
    const compressed: CompressedContext = {
      timestamp: new Date(),
      agentId,
      sessionId,
      completedSteps: [],
      nextSteps: [],
      decisions: {},
      activeFiles: [],
      insights: [],
    };

    // Extract current task info if present
    if (context.currentTask) {
      compressed.currentTask = {
        id: context.currentTask.id || context.currentTask,
        title: context.currentTask.title || 'Unknown',
        progress: context.currentTask.progress || 0,
        status: context.currentTask.status || 'IN_PROGRESS',
      };
    }

    // Extract completed steps (summarize if too many)
    if (context.completedSteps && Array.isArray(context.completedSteps)) {
      compressed.completedSteps = context.completedSteps.slice(-10); // Keep last 10
    }

    // Extract next steps
    if (context.nextSteps && Array.isArray(context.nextSteps)) {
      compressed.nextSteps = context.nextSteps.slice(0, 10); // Keep next 10
    }

    // Extract key decisions
    if (context.decisions && typeof context.decisions === 'object') {
      // Keep only key-value pairs, limit size
      const keys = Object.keys(context.decisions).slice(0, 20);
      keys.forEach(key => {
        const value = context.decisions[key];
        if (typeof value === 'string' && value.length < 200) {
          compressed.decisions[key] = value;
        } else if (typeof value === 'string') {
          // Truncate long values
          compressed.decisions[key] = value.substring(0, 197) + '...';
        }
      });
    }

    // Extract active files (paths only)
    if (context.files && Array.isArray(context.files)) {
      compressed.activeFiles = context.files
        .map((f: any) => typeof f === 'string' ? f : f.path)
        .filter((f: any) => f)
        .slice(0, 20); // Limit to 20 files
    }

    // Extract insights
    if (context.insights && Array.isArray(context.insights)) {
      compressed.insights = context.insights
        .map((i: any) => typeof i === 'string' ? i : i.description)
        .filter((i: any) => i)
        .slice(0, 10); // Keep top 10 insights
    }

    // Extract blockers
    if (context.blockers && Array.isArray(context.blockers)) {
      compressed.blockers = context.blockers.slice(0, 5); // Keep top 5 blockers
    }

    return compressed;
  }

  /**
   * Save session to storage
   */
  private async saveSession(session: Session): Promise<void> {
    await this.storage.createNode?.({
      nodeId: `session-${session.id}`,
      author: Author.SYSTEM,
      parentIds: [],
      nodeType: DevelopmentNodeType.DECISION,
      payload: session,
      metadata: {
        // Session info is stored in payload
      },
    });
  }

  /**
   * Calculate context size in bytes (for monitoring)
   */
  getContextSize(context: CompressedContext): number {
    return JSON.stringify(context).length;
  }

  /**
   * Prune old contexts to save space
   */
  async pruneOldContexts(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // This would need to be implemented in the storage layer
    // For now, return 0
    return 0;
  }
}