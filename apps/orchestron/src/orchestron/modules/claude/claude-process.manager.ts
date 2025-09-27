/**
 * Claude Process Manager
 * Manages running Claude Code processes and their lifecycles
 */

import { ChildProcess, spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { ClaudeBinaryService } from './claude-binary.service.js';
import * as readline from 'readline';

export interface ClaudeProcessInfo {
  runId: string;
  sessionId: string;
  projectPath: string;
  pid: number;
  startTime: number;
  prompt: string;
  model: string;
  process: ChildProcess;
}

export interface ClaudeExecutionOptions {
  model?: string;
  resume?: string;
  continue?: boolean;
}

export class ClaudeProcessManager {
  private processes: Map<string, ClaudeProcessInfo> = new Map();

  constructor(
    private binaryService: ClaudeBinaryService,
    private eventsService: any,
    private logger: any
  ) {}

  /**
   * Start a new Claude process
   */
  async startClaude(
    projectPath: string,
    prompt: string,
    options: ClaudeExecutionOptions = {}
  ): Promise<string> {
    // Find Claude binary
    await this.binaryService.findClaude();

    // Prepare command arguments
    const args: string[] = [];

    if (options.resume) {
      args.push('--resume', options.resume);
    } else if (options.continue) {
      args.push('-c');
    }

    args.push(
      '-p', prompt,
      '--model', options.model || 'claude-3.5-sonnet',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions'
    );

    // Create command with proper environment
    const { command, args: finalArgs, env } = this.binaryService.createCommand(args);

    // Spawn the process
    const proc = spawn(command, finalArgs, {
      cwd: projectPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const runId = uuidv4();
    let sessionId: string | null = null;

    // Set up output handling
    if (proc.stdout) {
      const rl = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        this.logger?.debug('Claude stdout', { line });

        // Parse JSON output
        try {
          const msg = JSON.parse(line);

          // Extract session ID from init message
          if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
            sessionId = msg.session_id;
            this.logger?.info('Claude session ID extracted', { sessionId });

            // Update process info with session ID
            const info = this.processes.get(runId);
            if (info && sessionId) {
              info.sessionId = sessionId;
            }
          }

          // Emit events for different message types
          this.emitClaudeEvent('output', { runId, sessionId, message: msg });
        } catch {
          // Not JSON, emit as raw output
          this.emitClaudeEvent('output', { runId, sessionId, line });
        }
      });
    }

    // Set up error handling
    if (proc.stderr) {
      const rl = readline.createInterface({
        input: proc.stderr,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        this.logger?.error('Claude stderr', { line });
        this.emitClaudeEvent('error', { runId, sessionId, error: line });
      });
    }

    // Handle process exit
    proc.on('exit', (code, signal) => {
      this.logger?.info('Claude process exited', { runId, sessionId, code, signal });
      this.processes.delete(runId);
      this.emitClaudeEvent('complete', {
        runId,
        sessionId,
        success: code === 0,
        code,
        signal
      });
    });

    proc.on('error', (error) => {
      this.logger?.error('Claude process error', { runId, error });
      this.processes.delete(runId);
      this.emitClaudeEvent('error', { runId, sessionId, error: error.message });
    });

    // Store process info
    const processInfo: ClaudeProcessInfo = {
      runId,
      sessionId: sessionId || runId,
      projectPath,
      pid: proc.pid || 0,
      startTime: Date.now(),
      prompt,
      model: options.model || 'claude-3.5-sonnet',
      process: proc
    };

    this.processes.set(runId, processInfo);

    this.logger?.info('Claude process started', {
      runId,
      pid: proc.pid,
      projectPath,
      model: processInfo.model
    });

    return runId;
  }

  /**
   * Stop a Claude process
   */
  async stopClaude(runIdOrSessionId: string): Promise<void> {
    let processInfo: ClaudeProcessInfo | undefined;

    // Try to find by run ID first
    processInfo = this.processes.get(runIdOrSessionId);

    // If not found, search by session ID
    if (!processInfo) {
      for (const info of this.processes.values()) {
        if (info.sessionId === runIdOrSessionId) {
          processInfo = info;
          break;
        }
      }
    }

    if (!processInfo) {
      this.logger?.warn('Claude process not found', { id: runIdOrSessionId });
      return;
    }

    // Kill the process
    try {
      processInfo.process.kill('SIGTERM');

      // Give it a moment to terminate gracefully
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Force kill if still running
      if (!processInfo.process.killed) {
        processInfo.process.kill('SIGKILL');
      }

      this.logger?.info('Claude process stopped', {
        runId: processInfo.runId,
        sessionId: processInfo.sessionId
      });
    } catch (error) {
      this.logger?.error('Failed to stop Claude process', {
        runId: processInfo.runId,
        error
      });
    } finally {
      this.processes.delete(processInfo.runId);
      this.emitClaudeEvent('cancelled', {
        runId: processInfo.runId,
        sessionId: processInfo.sessionId
      });
    }
  }

  /**
   * Stop all running Claude processes
   */
  async stopAll(): Promise<void> {
    const runIds = Array.from(this.processes.keys());

    for (const runId of runIds) {
      await this.stopClaude(runId);
    }

    this.logger?.info('All Claude processes stopped', {
      count: runIds.length
    });
  }

  /**
   * Get running Claude sessions
   */
  getRunningSessions(): any[] {
    return Array.from(this.processes.values()).map(info => ({
      runId: info.runId,
      sessionId: info.sessionId,
      projectPath: info.projectPath,
      pid: info.pid,
      startTime: info.startTime,
      prompt: info.prompt,
      model: info.model,
      uptime: Date.now() - info.startTime
    }));
  }

  /**
   * Get process info by session ID
   */
  getProcessBySessionId(sessionId: string): ClaudeProcessInfo | undefined {
    for (const info of this.processes.values()) {
      if (info.sessionId === sessionId) {
        return info;
      }
    }
    return undefined;
  }

  /**
   * Check if a session is running
   */
  isSessionRunning(sessionId: string): boolean {
    return !!this.getProcessBySessionId(sessionId);
  }

  /**
   * Get process count
   */
  getProcessCount(): number {
    return this.processes.size;
  }

  private emitClaudeEvent(event: string, data: any): void {
    if (this.eventsService) {
      this.eventsService.emit(`claude:${event}`, data);

      // Also emit session-specific events if we have a session ID
      if (data.sessionId) {
        this.eventsService.emit(`claude:${data.sessionId}:${event}`, data);
      }
    }
  }
}