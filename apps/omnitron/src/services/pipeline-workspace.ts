import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { ISeedProject } from '../config/types.js';
import { dialectOf } from '../database/dialect.js';
import type { OmnitronDatabase } from '../database/schema.js';
import type { PipelineWorkspace } from '../shared/dto/pipelines.js';

/** Match declared targets in current definitions and in the graph each run actually admitted. */
export function pipelineWorkspaceQueries(db: Kysely<OmnitronDatabase>, workspace: PipelineWorkspace, registrations: ISeedProject[]) {
  const dialect = dialectOf(db);
  if (dialect !== 'postgres' && dialect !== 'sqlite') throw Error('Unsupported pipeline database');
  const postgres = dialect === 'postgres';
  const pinned = postgres ? sql`(admission ->> 'definition')::jsonb` : sql`(admission ->> 'definition')`;
  const target = sql`(step.value -> 'target')`;
  const projectNames = [workspace.project];
  const matches = [sql`(${target} ->> 'project' = ${workspace.project}
    ${workspace.stack ? sql`AND ${target} ->> 'stack' = ${workspace.stack}` : sql``})`];
  for (const source of registrations) {
    if (source.configuration?.project !== workspace.project || source.name === workspace.project) continue;
    projectNames.push(source.name);
    const stacks = Object.entries(source.configuration.stacks)
      .filter(([, publicName]) => !workspace.stack || publicName === workspace.stack)
      .map(([runtimeName]) => runtimeName);
    if (stacks.length) matches.push(sql`(${target} ->> 'project' = ${source.name}
      AND ${target} ->> 'stack' IN (${sql.join(stacks)}))`);
  }
  const containsTarget = (steps: RawBuilder<unknown>) => {
    const entries = postgres ? sql`jsonb_array_elements(${steps}) AS step(value)` : sql`json_each(${steps}) AS step`;
    return sql<boolean>`EXISTS (SELECT 1 FROM ${entries}
      WHERE step.value ->> 'kind' IN ('release', 'deploy') AND (${sql.join(matches, sql` OR `)}))`;
  };
  const runTargets = containsTarget(sql`${pinned} -> 'steps'`);
  // Admissions predating pinned definitions retained explicit project names only.
  const projects = sql`admission -> 'review' -> 'projects'`;
  const legacy = postgres ? sql`jsonb_array_elements_text(${projects}) AS project(value)` : sql`json_each(${projects}) AS project`;
  return {
    definitions: containsTarget(sql.ref('pipelines.steps')),
    runs: workspace.stack ? runTargets : sql<boolean>`(${runTargets} OR (${pinned} IS NULL
      AND EXISTS (SELECT 1 FROM ${legacy} WHERE project.value IN (${sql.join(projectNames)}))))`,
    name: sql<string | null>`${pinned} ->> 'name'`,
  };
}
