/** Scope on the process owner; a deployed allocation may have a different public stack name. */
export interface StackExecutionScope { project: string; stack: string }
/** A child scope never grants authority over the other applications of its stack. */
export interface ExecutionScope extends StackExecutionScope { application?: string }
export interface StackExecutionIntent {
  revision: number;
  phase: 'running' | 'stopping' | 'stopped' | 'starting';
  remaining?: string[];
  pendingApp?: string;
  operationId?: string;
  fingerprint?: string;
}
export interface InstalledAppBinding {
  entrySha256: string;
  releaseId: string;
  manifestSha256: string;
  artifactSha256: string;
  treeSha256: string;
}
export interface StackExecutionPlan extends StackExecutionScope {
  revision: number;
  phase: StackExecutionIntent['phase'];
  apps: Array<{ name: string; generation: string; installed?: InstalledAppBinding }>;
}
export interface InstalledStackExecutionPlan extends StackExecutionPlan {
  apps: Array<{ name: string; generation: string; installed: InstalledAppBinding }>;
}
export interface StackExecutionStop {
  operationId: string;
  plan: StackExecutionPlan;
}
export interface StackExecutionReceipt extends StackExecutionScope {
  operationId: string;
  revision: number;
  stopped: string[];
  observedAt: string;
}
export interface ExecutionPlan extends StackExecutionPlan, ExecutionScope {
  /** Bind a child operation to the reviewed parent intent, including deliberate stops. */
  parentRevision?: number;
}
export interface ExecutionStop { operationId: string; plan: ExecutionPlan }
export interface ExecutionReceipt extends StackExecutionReceipt, ExecutionScope {}
export function stackExecutionKey(scope: StackExecutionScope): string {
  if (!scope || ![scope.project, scope.stack].every(value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value))) {
    throw new Error('A canonical project and stack identity is required');
  }
  return `${scope.project}/${scope.stack}`;
}
export function executionScopeKey(scope: ExecutionScope): string {
  const stack = stackExecutionKey(scope);
  if (scope.application === undefined) return stack;
  if (typeof scope.application !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(scope.application)) {
    throw new Error('A canonical application identity is required');
  }
  return `${stack}/${scope.application}`;
}
export function executionScopeOwns(scope: ExecutionScope, name: string): boolean {
  const key = executionScopeKey(scope);
  return scope.application === undefined ? name.startsWith(`${key}/`) : name === key;
}
export function validateStackExecutionIntent(value: StackExecutionIntent | null): StackExecutionIntent {
  if (value === null) return { revision: 0, phase: 'running' };
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !['running', 'stopping', 'stopped', 'starting'].includes(value.phase) ||
      (value.phase === 'starting' && (!Array.isArray(value.remaining) || !value.remaining.length ||
        !value.remaining.every(name => typeof name === 'string') || new Set(value.remaining).size !== value.remaining.length ||
        (value.pendingApp !== undefined && !value.remaining.includes(value.pendingApp)))) ||
      (value.phase !== 'running' && (typeof value.operationId !== 'string' || typeof value.fingerprint !== 'string'))) {
    throw new Error('Corrupt stack execution intent; automatic mutation is refused');
  }
  return value;
}
