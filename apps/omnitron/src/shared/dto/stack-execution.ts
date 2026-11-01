/** Scope on the process owner; a deployed allocation may have a different public stack name. */
export interface StackExecutionScope { project: string; stack: string }
export interface StackExecutionIntent {
  revision: number;
  phase: 'running' | 'stopping' | 'stopped';
  operationId?: string;
  fingerprint?: string;
}
export interface StackExecutionPlan extends StackExecutionScope {
  revision: number;
  phase: StackExecutionIntent['phase'];
  apps: Array<{ name: string; generation: string }>;
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
export function stackExecutionKey(scope: StackExecutionScope): string {
  if (!scope || ![scope.project, scope.stack].every(value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value))) {
    throw new Error('A canonical project and stack identity is required');
  }
  return `${scope.project}/${scope.stack}`;
}
export function validateStackExecutionIntent(value: StackExecutionIntent | null): StackExecutionIntent {
  if (value === null) return { revision: 0, phase: 'running' };
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !['running', 'stopping', 'stopped'].includes(value.phase) ||
      (value.phase !== 'running' && (typeof value.operationId !== 'string' || typeof value.fingerprint !== 'string'))) {
    throw new Error('Corrupt stack execution intent; automatic mutation is refused');
  }
  return value;
}
