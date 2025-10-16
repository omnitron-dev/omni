/**
 * Layer interfaces for Environment system
 */

export interface AccessLog {
  key: string;
  timestamp: Date;
  user: string;
  action: 'read' | 'write' | 'delete';
}

export interface ISecretsProvider {
  type: 'local' | 'vault' | 'aws-secrets' | '1password' | 'env';
  initialize(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface ISecretsLayer {
  readonly provider: ISecretsProvider;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getAll(): Promise<Record<string, string>>;
  setAll(secrets: Record<string, string>): Promise<void>;
  rotate(key: string): Promise<void>;
  rotateAll(): Promise<void>;
  getAccessLog(key: string): Promise<AccessLog[]>;
  interpolate(template: string): Promise<string>;
}

export interface IVariablesLayer {
  define(name: string, value: any): void;
  get(name: string): any;
  has(name: string): boolean;
  delete(name: string): void;
  defineComputed(name: string, fn: () => any): void;
  interpolate(template: string): string;
  interpolateAsync(template: string): Promise<string>;
  resolve(): Promise<void>;
  list(): string[];
  export(): Record<string, any>;
  import(vars: Record<string, any>): void;
}

export interface TaskConfig {
  command?: string;
  script?: string;
  steps?: TaskStep[];
  dependsOn?: string[];
  description?: string;
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;
  retries?: number;
  onError?: 'abort' | 'continue' | TaskStep[];
  when?: string;
}

export interface TaskStep {
  name: string;
  command?: string;
  task?: string;
  target?: string;
  targets?: string[];
  parallel?: boolean;
  when?: string;
  onFailure?: 'abort' | 'continue' | { retry: number; delay: string };
}

export interface TaskDefinition {
  name: string;
  config: TaskConfig;
}

export interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  duration: number;
  steps?: Array<{
    name: string;
    success: boolean;
    output?: string;
    error?: string;
  }>;
}

export interface TaskInfo {
  name: string;
  description?: string;
  dependencies: string[];
  hasSteps: boolean;
}

export interface ITasksLayer {
  define(name: string, config: TaskConfig): void;
  get(name: string): TaskDefinition | null;
  has(name: string): boolean;
  delete(name: string): void;
  run(name: string, params?: Record<string, any>): Promise<TaskResult>;
  runOn(name: string, target: string, params?: Record<string, any>): Promise<TaskResult>;
  schedule(name: string, cron: string): void;
  unschedule(name: string): void;
  getDependencies(name: string): string[];
  getExecutionOrder(tasks: string[]): string[];
  list(): TaskInfo[];
  explain(name: string): string[];
}

export interface TargetConfig {
  type: 'local' | 'ssh' | 'docker' | 'kubernetes';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  container?: string;
  image?: string;
  namespace?: string;
  context?: string;
  workdir?: string;
  env?: Record<string, string>;
}

export interface ResolvedTarget {
  name: string;
  type: 'local' | 'ssh' | 'docker' | 'kubernetes';
  config: TargetConfig;
}

export interface ExecutionOptions {
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;
  shell?: string;
  capture?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface ITargetsLayer {
  define(name: string, config: TargetConfig): void;
  get(name: string): ResolvedTarget | null;
  has(name: string): boolean;
  delete(name: string): void;
  resolve(reference: string): Promise<ResolvedTarget>;
  find(pattern: string): Promise<ResolvedTarget[]>;
  list(): Promise<ResolvedTarget[]>;
  execute(
    target: string,
    command: string,
    options?: ExecutionOptions
  ): Promise<ExecutionResult>;
  autoDetect(name: string): Promise<ResolvedTarget | null>;
}
