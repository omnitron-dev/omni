import type { BuildRecord, PipelineRunSummary, IProjectRpcService, IStackInfo } from '@omnitron-dev/omnitron/dto/services';
type RemoteReleasePreparationAttempt = Awaited<ReturnType<IProjectRpcService['listRemoteReleasePreparations']>>[number];
type StackDeploymentProgress = NonNullable<IStackInfo['deploymentOperation']>;

export interface DeploymentActivityChoice {
  key: string;
  aliases: Set<string>;
  releaseId?: string;
  manifestSha256?: string;
  at: string;
  build?: BuildRecord;
  producer?: PipelineRunSummary;
  rehearsal?: PipelineRunSummary;
  preparation?: RemoteReleasePreparationAttempt;
  operation?: StackDeploymentProgress;
  confirmation?: IStackInfo['launchConfirmation'];
}

/** Each unfinished producer remains selectable by its own ID after a manifest is issued. */
export function deploymentActivityChoices(builds: BuildRecord[], runs: PipelineRunSummary[],
  preparations: RemoteReleasePreparationAttempt[], operation?: StackDeploymentProgress, selected?: string | null,
  confirmation?: IStackInfo['launchConfirmation']) {
  const choices = new Map<string, DeploymentActivityChoice>();
  function entry(id: string, at: string, releaseId?: string | null, digest?: string) {
    const key = releaseId && digest ? releaseId + '/' + digest : id;
    const group: DeploymentActivityChoice = choices.get(key) ?? { key, at, aliases: new Set<string>(), ...(releaseId && { releaseId }), ...(digest && { manifestSha256: digest }) };
    group.aliases.add(id);
    if (at > group.at) group.at = at;
    choices.set(key, group);
    return group;
  }
  // The native services order records newest first. An explicitly reviewed QA run wins over later retries.
  for (const job of builds) {
    const group = entry('build/' + job.buildId, job.finishedAt ?? job.startedAt, job.releaseId, job.manifestSha256);
    if (!group.build || selected === 'build/' + job.buildId) group.build = job;
  }
  for (const run of runs) {
    const activity = run.activity;
    if (!activity) continue;
    const group = entry('run/' + run.id, run.completedAt ?? run.startedAt, activity.releaseId, activity.manifestSha256);
    if (activity.kind === 'build') {
      if (!group.producer || selected === 'run/' + run.id) group.producer = run;
    } else if (!group.rehearsal || operation?.recoveryRunId === run.id || selected === 'run/' + run.id) group.rehearsal = run;
  }
  for (const attempt of preparations) {
    const group = entry('preparation/' + attempt.attemptId, attempt.finishedAt ?? attempt.startedAt, attempt.release, attempt.manifestSha256);
    if (!group.preparation || selected === 'preparation/' + attempt.attemptId) group.preparation = attempt;
  }
  if (operation) {
    const qualification = runs.find(run => run.id === operation.recoveryRunId)?.activity;
    const digest = operation.manifestSha256 ?? (qualification?.kind === 'rehearsal' && qualification.releaseId === operation.release &&
      qualification.nodeId === operation.nodeId ? qualification.manifestSha256 : undefined);
    const group = entry('review/' + operation.review, '', operation.release, digest);
    group.operation = operation;
    if (operation.recoveryRunId && group.rehearsal?.id !== operation.recoveryRunId) delete group.rehearsal;
  }
  if (confirmation) {
    const group = entry('launch/' + confirmation.nodeId + '/' + confirmation.manifestSha256, confirmation.confirmedAt, confirmation.id, confirmation.manifestSha256);
    group.confirmation = confirmation;
  }
  const inProgress = (item: DeploymentActivityChoice) => item.operation && item.operation.phase !== 'confirmed' && !item.confirmation ? 1 : 0;
  return [...choices.values()].sort((a, b) => inProgress(b) - inProgress(a) || b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}
