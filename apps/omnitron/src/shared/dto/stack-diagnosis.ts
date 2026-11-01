/** Read-only pre-start evidence. No environment, credentials or container commands. */
export interface StackDiagnosisCheck {
  code: string;
  resource: string;
  state: 'pass' | 'change' | 'blocked' | 'unknown';
  message: string;
  action?: string;
}

export interface StackDiagnosis {
  project: string;
  stack: string;
  checkedAt: string;
  durationMs: number;
  status: 'ready' | 'changes' | 'blocked' | 'unknown';
  checks: StackDiagnosisCheck[];
  /** Explicit boundaries: prerequisites are not a successful launch or migration. */
  deferred: string[];
}

export function diagnosisStatus(checks: readonly StackDiagnosisCheck[]): StackDiagnosis['status'] {
  if (checks.some(check => check.state === 'blocked')) return 'blocked';
  if (checks.some(check => check.state === 'unknown')) return 'unknown';
  return checks.some(check => check.state === 'change') ? 'changes' : 'ready';
}
