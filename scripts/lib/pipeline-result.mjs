/** Preserve Xec's bounded step diagnostics when a release acceptance gate fails. */
export function assertPipelineSucceeded(result) {
  if (result.success) return;
  const failures = result.steps.filter(step => !step.success && !step.skipped);
  const diagnostic = failures.map(step => [
    `${step.name}: ${step.error ?? 'failed'} (exit ${step.exitCode ?? 'unknown'})`,
    step.stderr && `stderr:\n${step.stderr.slice(-16_384)}`,
    step.stdout && `stdout:\n${step.stdout.slice(-16_384)}`,
    step.outputTruncated && '[output truncated]',
  ].filter(Boolean).join('\n')).join('\n\n');
  throw new Error(diagnostic || 'Release acceptance did not complete');
}
