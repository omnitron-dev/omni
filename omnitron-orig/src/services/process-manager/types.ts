/**
 * Interface for process options
 */
export type ProcessOptions = {
  name: string;
  script: string;
  cwd?: string;
  instances?: number;
  args?: string[];
  env?: Record<string, string>;
  logFile?: string;
  errorFile?: string;
  autorestart?: boolean;
  maxRestarts?: number;
  restartDelay?: number;
  maxMemoryRestart?: string;
  interpreter?: string;
  execMode?: 'fork' | 'cluster' | 'exec';
};

export type ConfigProcessOptions = ProcessOptions & {
  id: string;
  pid: number;
  status: 'running' | 'stopped' | 'restarting' | 'error';
  error?: string;
};

/**
 * Interface for process manager service
 */
export interface IProcessManager {
  start(app: string, options: ProcessOptions): Promise<void>;
  stop(id?: string): Promise<void>;
  restart(id?: string): Promise<void>;
  list(): Promise<void>;
}
