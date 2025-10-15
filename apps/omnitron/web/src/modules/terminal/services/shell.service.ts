import { Injectable } from '@omnitron-dev/aether/di';
import { signal } from '@omnitron-dev/aether';

export interface ShellSession {
  id: string;
  name: string;
  cwd: string;
  createdAt: Date;
  active: boolean;
}

/**
 * Shell Service
 *
 * Manages shell sessions
 */
@Injectable({ scope: 'module' })
export class ShellService {
  private sessions = signal<ShellSession[]>([]);
  private activeSessionId = signal<string | null>(null);

  constructor() {
    // Create default session
    this.createSession('Default');
  }

  /**
   * Get all sessions
   */
  getSessions() {
    return this.sessions();
  }

  /**
   * Get active session
   */
  getActiveSession(): ShellSession | undefined {
    return this.sessions().find(s => s.id === this.activeSessionId());
  }

  /**
   * Create a new session
   */
  createSession(name: string): ShellSession {
    const session: ShellSession = {
      id: Date.now().toString(),
      name,
      cwd: '/home/omnitron',
      createdAt: new Date(),
      active: false,
    };

    this.sessions.update(sessions => [...sessions, session]);
    this.setActiveSession(session.id);

    return session;
  }

  /**
   * Set active session
   */
  setActiveSession(sessionId: string) {
    this.activeSessionId.set(sessionId);
    this.sessions.update(sessions =>
      sessions.map(s => ({ ...s, active: s.id === sessionId }))
    );
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string) {
    const sessions = this.sessions().filter(s => s.id !== sessionId);
    this.sessions.set(sessions);

    if (this.activeSessionId() === sessionId && sessions.length > 0) {
      this.setActiveSession(sessions[0].id);
    }
  }

  /**
   * Update session working directory
   */
  updateSessionCwd(sessionId: string, cwd: string) {
    this.sessions.update(sessions =>
      sessions.map(s => (s.id === sessionId ? { ...s, cwd } : s))
    );
  }
}
