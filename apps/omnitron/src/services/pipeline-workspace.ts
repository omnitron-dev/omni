import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { ISeedProject } from '../config/types.js';
import { dialectOf } from '../database/dialect.js';
import type { OmnitronDatabase } from '../database/schema.js';
import type { PipelineWorkspace } from '../shared/dto/pipelines.js';

export function pinnedPipelineDefinition(db: Kysely<OmnitronDatabase>) {
  return dialectOf(db) === 'postgres' ? sql`(admission ->> 'definition')::jsonb` : sql`(admission ->> 'definition')`;
}

/** Match declared targets in current definitions and in the graph each run actually admitted. */
export function pipelineWorkspaceQueries(db: Kysely<OmnitronDatabase>, workspace: PipelineWorkspace, registrations: ISeedProject[],
  priorRuns: ReadonlyMap<string, Required<PipelineWorkspace>> = new Map()) {
  const dialect = dialectOf(db);
  if (dialect !== 'postgres' && dialect !== 'sqlite') throw Error('Unsupported pipeline database');
  const postgres = dialect === 'postgres';
  const pinned = pinnedPipelineDefinition(db);
  const projectNames = [workspace.project];
  const scopes: Array<{ project: string; stacks?: string[] }> = [{ project: workspace.project, ...(workspace.stack && { stacks: [workspace.stack] }) }];
  for (const source of registrations) {
    if (source.configuration?.project !== workspace.project || source.name === workspace.project) continue;
    projectNames.push(source.name);
    const stacks = Object.entries(source.configuration.stacks)
      .filter(([, publicName]) => !workspace.stack || publicName === workspace.stack)
      .map(([runtimeName]) => runtimeName);
    if (stacks.length) scopes.push({ project: source.name, stacks });
  }
  const matches = (target: RawBuilder<unknown>) => sql.join(scopes.map(scope => sql`(${target} ->> 'project' = ${scope.project}
    ${scope.stacks ? sql`AND ${target} ->> 'stack' IN (${sql.join(scope.stacks)})` : sql``})`), sql` OR `);
  const containsTarget = (steps: RawBuilder<unknown>) => {
    const entries = postgres ? sql`jsonb_array_elements(${steps}) AS step(value)` : sql`json_each(${steps}) AS step`;
    return sql<boolean>`EXISTS (SELECT 1 FROM ${entries}
      WHERE step.value ->> 'kind' IN ('release', 'deploy') AND (${matches(sql`(step.value -> 'target')`)}))`;
  };
  const prior = [...priorRuns].filter(([, target]) => scopes.some(scope =>
    scope.project === target.project && (!scope.stacks || scope.stacks.includes(target.stack)))).map(([id]) => id);
  const priorIds = postgres ? sql`SELECT value FROM jsonb_array_elements_text(${JSON.stringify(prior)}::jsonb) AS ids(value)`
    : sql`SELECT value FROM json_each(${JSON.stringify(prior)})`;
  const activity = sql<boolean>`(${matches(sql`(admission -> 'activity')`)}
    ${prior.length ? sql`OR CAST(id AS TEXT) IN (${priorIds})` : sql``})`;
  const runTargets = sql<boolean>`(${containsTarget(sql`${pinned} -> 'steps'`)} OR ${activity})`;
  // Admissions predating pinned definitions retained explicit project names only.
  const projects = sql`admission -> 'review' -> 'projects'`;
  const legacy = postgres ? sql`jsonb_array_elements_text(${projects}) AS project(value)` : sql`json_each(${projects}) AS project`;
  return {
    activity,
    definitions: containsTarget(sql.ref('pipelines.steps')),
    runs: workspace.stack ? runTargets : sql<boolean>`(${runTargets} OR (${pinned} IS NULL
      AND EXISTS (SELECT 1 FROM ${legacy} WHERE project.value IN (${sql.join(projectNames)}))))`,
    name: sql<string | null>`${pinned} ->> 'name'`,
  };
}
