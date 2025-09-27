/**
 * Claude Service
 * Main service for managing Claude Code interactions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Storage } from '../../../storage/interface.js';
import { ClaudeBinaryService } from './claude-binary.service.js';
import { ClaudeProcessManager } from './claude-process.manager.js';

export interface Project {
  id: string;
  path: string;
  sessions: string[];
  createdAt: number;
  mostRecentSession?: number;
}

export interface Session {
  id: string;
  projectId: string;
  projectPath: string;
  createdAt: number;
  firstMessage?: string;
  messageTimestamp?: string;
}

export interface ClaudeSettings {
  [key: string]: any;
}

export class ClaudeService {
  private claudeDir: string;
  private projectsDir: string;
  private settingsPath: string;

  constructor(
    private storage: Storage,
    private binaryService: ClaudeBinaryService,
    private processManager: ClaudeProcessManager,
    private eventsService: any,
    private logger: any
  ) {
    this.claudeDir = path.join(os.homedir(), '.claude');
    this.projectsDir = path.join(this.claudeDir, 'projects');
    this.settingsPath = path.join(this.claudeDir, 'settings.json');
  }

  async initialize(): Promise<void> {
    // Ensure Claude directories exist
    if (!fs.existsSync(this.claudeDir)) {
      fs.mkdirSync(this.claudeDir, { recursive: true });
    }
    if (!fs.existsSync(this.projectsDir)) {
      fs.mkdirSync(this.projectsDir, { recursive: true });
    }

    this.logger?.info('ClaudeService initialized', {
      claudeDir: this.claudeDir,
      projectsDir: this.projectsDir
    });
  }

  /**
   * List all Claude projects
   */
  async listProjects(): Promise<Project[]> {
    if (!fs.existsSync(this.projectsDir)) {
      return [];
    }

    const projects: Project[] = [];
    const entries = fs.readdirSync(this.projectsDir);

    for (const entry of entries) {
      const projectPath = path.join(this.projectsDir, entry);
      if (fs.statSync(projectPath).isDirectory()) {
        const project = await this.loadProject(entry);
        if (project) {
          projects.push(project);
        }
      }
    }

    // Sort by most recent session
    projects.sort((a, b) => {
      const aTime = a.mostRecentSession || a.createdAt;
      const bTime = b.mostRecentSession || b.createdAt;
      return bTime - aTime;
    });

    return projects;
  }

  /**
   * Create a new project
   */
  async createProject(projectPath: string): Promise<Project> {
    const projectId = projectPath.replace(/\//g, '-');
    const projectDir = path.join(this.projectsDir, projectId);

    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const project: Project = {
      id: projectId,
      path: projectPath,
      sessions: [],
      createdAt: Date.now()
    };

    this.logger?.info('Project created', { projectId, projectPath });
    return project;
  }

  /**
   * Get sessions for a project
   */
  async getProjectSessions(projectId: string): Promise<Session[]> {
    const projectDir = path.join(this.projectsDir, projectId);
    if (!fs.existsSync(projectDir)) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const sessions: Session[] = [];
    const files = fs.readdirSync(projectDir);

    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        const sessionId = file.replace('.jsonl', '');
        const session = await this.loadSession(projectId, sessionId);
        if (session) {
          sessions.push(session);
        }
      }
    }

    // Sort by creation time (newest first)
    sessions.sort((a, b) => b.createdAt - a.createdAt);
    return sessions;
  }

  /**
   * Load session history
   */
  async loadSessionHistory(projectId: string, sessionId: string): Promise<any[]> {
    const sessionPath = path.join(this.projectsDir, projectId, `${sessionId}.jsonl`);
    if (!fs.existsSync(sessionPath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const messages: any[] = [];
    const content = fs.readFileSync(sessionPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (line.trim()) {
        try {
          messages.push(JSON.parse(line));
        } catch (error) {
          this.logger?.warn('Failed to parse JSONL line', { error });
        }
      }
    }

    return messages;
  }

  /**
   * Get Claude settings
   */
  async getSettings(): Promise<ClaudeSettings> {
    if (!fs.existsSync(this.settingsPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(this.settingsPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      this.logger?.error('Failed to read Claude settings', { error });
      return {};
    }
  }

  /**
   * Save Claude settings
   */
  async saveSettings(settings: ClaudeSettings): Promise<void> {
    const content = JSON.stringify(settings, null, 2);
    fs.writeFileSync(this.settingsPath, content);
    this.logger?.info('Claude settings saved');
  }

  /**
   * Get system prompt (CLAUDE.md)
   */
  async getSystemPrompt(): Promise<string> {
    const claudeMdPath = path.join(this.claudeDir, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      return '';
    }
    return fs.readFileSync(claudeMdPath, 'utf-8');
  }

  /**
   * Save system prompt (CLAUDE.md)
   */
  async saveSystemPrompt(content: string): Promise<void> {
    const claudeMdPath = path.join(this.claudeDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, content);
    this.logger?.info('System prompt saved');
  }

  /**
   * Execute Claude Code
   */
  async executeClaude(
    projectPath: string,
    prompt: string,
    options: {
      model?: string;
      resume?: string;
      continue?: boolean;
    } = {}
  ): Promise<string> {
    const model = options.model || 'claude-3.5-sonnet';

    // Create or get project
    const projectId = projectPath.replace(/\//g, '-');
    await this.createProject(projectPath);

    // Start Claude process
    const sessionId = await this.processManager.startClaude(
      projectPath,
      prompt,
      {
        model,
        resume: options.resume,
        continue: options.continue
      }
    );

    this.logger?.info('Claude execution started', {
      sessionId,
      projectPath,
      model
    });

    return sessionId;
  }

  /**
   * Cancel Claude execution
   */
  async cancelClaude(sessionId: string): Promise<void> {
    await this.processManager.stopClaude(sessionId);
    this.logger?.info('Claude execution cancelled', { sessionId });
  }

  /**
   * Get running Claude sessions
   */
  async getRunningSessions(): Promise<any[]> {
    return this.processManager.getRunningSessions();
  }

  /**
   * Check Claude version
   */
  async checkVersion(): Promise<{
    isInstalled: boolean;
    version?: string;
    output: string;
  }> {
    return this.binaryService.checkVersion();
  }

  // Private helper methods

  private async loadProject(projectId: string): Promise<Project | null> {
    const projectDir = path.join(this.projectsDir, projectId);

    try {
      const stats = fs.statSync(projectDir);
      const sessions: string[] = [];
      let mostRecentSession: number | undefined;

      // Get actual project path from sessions
      const projectPath = await this.getProjectPathFromSessions(projectDir) ||
                         this.decodeProjectPath(projectId);

      // List sessions
      const files = fs.readdirSync(projectDir);
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          sessions.push(file.replace('.jsonl', ''));

          const filePath = path.join(projectDir, file);
          const fileStats = fs.statSync(filePath);
          const modTime = fileStats.mtimeMs;

          if (!mostRecentSession || modTime > mostRecentSession) {
            mostRecentSession = modTime;
          }
        }
      }

      return {
        id: projectId,
        path: projectPath,
        sessions,
        createdAt: stats.birthtimeMs,
        mostRecentSession
      };
    } catch (error) {
      this.logger?.error('Failed to load project', { projectId, error });
      return null;
    }
  }

  private async loadSession(projectId: string, sessionId: string): Promise<Session | null> {
    const sessionPath = path.join(this.projectsDir, projectId, `${sessionId}.jsonl`);

    try {
      const stats = fs.statSync(sessionPath);
      const projectPath = await this.getProjectPathFromSessions(path.join(this.projectsDir, projectId)) ||
                         this.decodeProjectPath(projectId);

      // Extract first user message
      const { firstMessage, messageTimestamp } = await this.extractFirstUserMessage(sessionPath);

      return {
        id: sessionId,
        projectId,
        projectPath,
        createdAt: stats.birthtimeMs,
        firstMessage,
        messageTimestamp
      };
    } catch (error) {
      this.logger?.error('Failed to load session', { projectId, sessionId, error });
      return null;
    }
  }

  private async getProjectPathFromSessions(projectDir: string): Promise<string | null> {
    try {
      const files = fs.readdirSync(projectDir);
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const filePath = path.join(projectDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n')[0];

          if (firstLine) {
            const json = JSON.parse(firstLine);
            if (json.cwd) {
              return json.cwd;
            }
          }
        }
      }
    } catch (error) {
      this.logger?.warn('Failed to get project path from sessions', { error });
    }
    return null;
  }

  private decodeProjectPath(encoded: string): string {
    return encoded.replace(/-/g, '/');
  }

  private async extractFirstUserMessage(sessionPath: string): Promise<{
    firstMessage?: string;
    messageTimestamp?: string;
  }> {
    try {
      const content = fs.readFileSync(sessionPath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line);
          if (entry.message?.role === 'user' && entry.message?.content) {
            const content = entry.message.content;

            // Skip system messages
            if (content.includes('Caveat: The messages below were generated') ||
                content.startsWith('<command-name>') ||
                content.startsWith('<local-command-stdout>')) {
              continue;
            }

            return {
              firstMessage: content,
              messageTimestamp: entry.timestamp
            };
          }
        } catch {
          // Ignore parse errors
        }
      }
    } catch (error) {
      this.logger?.warn('Failed to extract first user message', { error });
    }

    return {};
  }
}