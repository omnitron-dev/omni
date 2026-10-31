import fs from 'node:fs/promises';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IProjectRpcService } from '../shared/dto/services.js';
import type { TopologySpec } from '../shared/dto/topology.js';
import { emitJson, emitError, emitInfo, isJsonMode } from './output.js';

/** The same draft, validation and revision protocol used by Console. */
export async function topologyCommand(
  action: 'show' | 'export' | 'draft' | 'plan' | 'apply',
  project: string,
  stack: string,
  argument?: string
): Promise<void> {
  const client = createDaemonClient();
  try {
    const service = await client.service<IProjectRpcService>('OmnitronProject');
    const scope = { project, stack };
    if (action === 'apply') {
      if (!argument) throw new Error('An explicit plan ID is required');
      const result = await service.applyTopologyPlan({ ...scope, plan: argument });
      if (isJsonMode()) emitJson(result);
      else
        emitInfo(
          `Target topology accepted (${result.id}). Deployment and restart configuration are unchanged. This command does not execute runtime migrations.`
        );
      return;
    }
    const workspace = await service.getTopologyWorkspace(scope);
    if (action === 'export') {
      const document = workspace.draft?.spec ?? workspace.desired;
      if (!emitJson(document)) process.stdout.write(JSON.stringify(document, null, 2) + '\n');
      return;
    }
    if (action === 'draft') {
      if (!argument) throw new Error('A topology JSON file is required');
      const stat = await fs.stat(argument);
      if (stat.size > 1_048_576) throw new Error('Topology document exceeds 1 MiB');
      const spec = JSON.parse(await fs.readFile(argument, 'utf8')) as TopologySpec;
      const saved = await service.saveTopologyDraft({
        ...scope,
        baseRevision: workspace.revision,
        expectedDraft: workspace.draft?.revision ?? null,
        spec,
      });
      if (isJsonMode()) emitJson(saved);
      else emitInfo(`Draft ${saved.revision} saved. Run topology plan ${project} ${stack} to inspect changes.`);
      return;
    }
    if (action === 'plan') {
      if (!workspace.draft) throw new Error('Save a topology draft before planning');
      const plan = await service.planTopology({ ...scope, draftRevision: workspace.draft.revision });
      if (isJsonMode()) emitJson(plan);
      else {
        emitInfo(`Plan ${plan.id} · expires ${plan.expiresAt} · desired configuration only`);
        for (const change of plan.changes) {
          emitInfo(`${change.action} ${change.resource} ${change.name} @ ${change.node}`);
          for (const field of change.fields ?? [])
            emitInfo(`  ${field.field}: ${field.before ?? '(unset)'} → ${field.after ?? '(unset)'}`);
        }
        for (const issue of plan.issues) emitInfo(`${issue.severity}: ${issue.message}`);
      }
      if (plan.issues.some((issue) => issue.severity === 'error')) process.exitCode = 1;
      return;
    }
    if (isJsonMode()) emitJson(workspace);
    else {
      emitInfo(`${project}/${stack} · ${workspace.desired.type} · revision ${workspace.revision}`);
      emitInfo(`Applications: ${workspace.desired.apps.join(', ') || '(none)'}`);
      for (const node of workspace.desired.nodes)
        emitInfo(`${node.host}:${node.port} · ${node.role} · ${node.apps.join(', ') || 'infrastructure only'}`);
      for (const placement of workspace.observed.placements ?? [])
        for (const reason of placement.errors) emitInfo(`${placement.nodeKey}: ${reason}`);
      if (workspace.draft) emitInfo(`Saved draft: ${workspace.draft.revision}`);
      for (const warning of workspace.warnings) emitInfo(`Incomplete evidence: ${warning}`);
    }
  } catch (error) {
    emitError((error as Error).message);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
