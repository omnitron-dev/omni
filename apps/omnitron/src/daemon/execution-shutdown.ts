/** Shutdown proof used before the managed owner may publish its clean receipt. */
export async function shutdownExecutionOwner(steps: {
  phase(stage: string): void;
  stopWatching(): void | Promise<void>;
  stopApplications(): Promise<unknown>;
  stopProcesses(): Promise<void>;
  flushState(): Promise<void>;
  flushLogs(): Promise<void>;
  stopRpc(): Promise<void>;
  closeStorage(): Promise<void>;
  removePid(): void;
}): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async (stage: string, work: () => unknown) => {
    steps.phase(stage);
    try { await work(); }
    catch (error) { failures.push(new Error(`Execution owner shutdown ${stage} failed: ${String(error)}`, { cause: error })); }
  };
  await attempt('watchers', () => steps.stopWatching());
  await attempt('applications', () => steps.stopApplications());
  // Application failures must not skip termination of remaining owned workers.
  await attempt('processes', () => steps.stopProcesses());
  if (failures.length) throw new AggregateError(failures, 'Execution owner process termination is unconfirmed');
  // Once processes are stopped, attempt every durable flush/close. A failed
  // flush still forbids clean:true even if all other cleanup succeeds.
  await attempt('state', () => steps.flushState());
  await attempt('logs', () => steps.flushLogs());
  await attempt('rpc', () => steps.stopRpc());
  await attempt('storage', () => steps.closeStorage());
  if (failures.length) throw new AggregateError(failures, 'Execution owner persistence shutdown is incomplete');
  steps.removePid();
  steps.phase('complete');
}
