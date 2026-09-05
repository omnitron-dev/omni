import type { IMcpToolDef } from '../types.js';
import type { DaemonClient } from '../../daemon/daemon-client.js';
import type {
  IProjectRpcService,
  IOmnitronSecretsService,
  IOmnitronBackupsService,
  IOmnitronDeployService,
  IOmnitronFleetService,
  IOmnitronPipelinesService,
  IOmnitronKubernetesService,
} from '../../shared/dto/services.js';

/**
 * Stacks, secrets, backups, deploys, fleet, k8s, projects, pipelines.
 *
 * Every handler here used to call a method on `DaemonClient` that does not
 * exist — `stackList`, `secretGet`, `fleetStatus`, twenty-odd more. The
 * parameter was typed `any`, so nothing objected at build time, and each one
 * failed at call time with `TypeError: daemonClient.X is not a function`.
 * Confirmed against a running daemon: `fleet.status` threw exactly that.
 *
 * `DaemonClient` has methods for the daemon's own service and a generic
 * `service<T>(name)` for everything else, which is the path the CLI takes.
 * Handlers now go through it with the DTO interface as the type argument, so
 * a method that does not exist is a compile error rather than a runtime one.
 *
 * Two tools are gone rather than repaired. `webapp.status` and
 * `webapp.build` have no RPC behind them at all — the console is managed by
 * `omnitron webapp`, a CLI command that runs Docker locally, and there is no
 * service an agent could call. Leaving them as stubs would tell the agent a
 * capability exists.
 */
export function createManagementTools(client: DaemonClient): IMcpToolDef[] {
  const project = () => client.service<IProjectRpcService>('OmnitronProject');
  const secrets = () => client.service<IOmnitronSecretsService>('OmnitronSecrets');
  const backups = () => client.service<IOmnitronBackupsService>('OmnitronBackups');
  const deploy = () => client.service<IOmnitronDeployService>('OmnitronDeploy');
  const fleet = () => client.service<IOmnitronFleetService>('OmnitronFleet');
  const pipelines = () => client.service<IOmnitronPipelinesService>('OmnitronPipelines');
  const k8s = () => client.service<IOmnitronKubernetesService>('OmnitronKubernetes');

  return [
    // ---- Projects & stacks --------------------------------------------------
    {
      name: 'project.list',
      description: 'List registered projects.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await project()).listProjects(),
    },
    {
      name: 'project.scan',
      description: 'Scan a project for the infrastructure its apps declare.',
      inputSchema: {
        type: 'object',
        properties: { project: { type: 'string', description: 'Project name' } },
        required: ['project'],
      },
      handler: async (params: any) => (await project()).scanRequirements({ project: params.project }),
    },
    {
      name: 'project.apps',
      description: 'Apps in a project, with their per-stack status.',
      inputSchema: {
        type: 'object',
        properties: { project: { type: 'string', description: 'Project name' } },
        required: ['project'],
      },
      handler: async (params: any) => (await project()).getProjectApps({ project: params.project }),
    },
    {
      name: 'stack.list',
      description: 'List a project’s stacks (dev / test / staging / prod).',
      inputSchema: {
        type: 'object',
        properties: { project: { type: 'string', description: 'Project name' } },
        required: ['project'],
      },
      handler: async (params: any) => (await project()).listStacks({ project: params.project }),
    },
    {
      name: 'stack.status',
      description: 'Runtime status of one stack: which apps run, which containers back them.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name' },
          stack: { type: 'string', description: 'Stack name' },
        },
        required: ['project', 'stack'],
      },
      handler: async (params: any) =>
        (await project()).getStackStatus({ project: params.project, stack: params.stack }),
    },
    {
      name: 'stack.start',
      description: 'Start every app in a stack, provisioning its infrastructure first.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name' },
          stack: { type: 'string', description: 'Stack name' },
        },
        required: ['project', 'stack'],
      },
      handler: async (params: any) =>
        (await project()).startStack({ project: params.project, stack: params.stack }),
    },
    {
      name: 'stack.stop',
      description: 'Stop every app in a stack.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name' },
          stack: { type: 'string', description: 'Stack name' },
        },
        required: ['project', 'stack'],
      },
      handler: async (params: any) =>
        (await project()).stopStack({ project: params.project, stack: params.stack }),
    },

    // ---- Secrets ------------------------------------------------------------
    {
      name: 'secret.list',
      description: 'List secret keys. Values are never returned by this call.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await secrets()).list(),
    },
    {
      name: 'secret.get',
      description: 'Read and decrypt one secret.',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string', description: 'Secret key' } },
        required: ['key'],
      },
      handler: async (params: any) => (await secrets()).get({ key: params.key }),
    },
    {
      name: 'secret.set',
      description: 'Encrypt and store a secret.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Secret key' },
          value: { type: 'string', description: 'Secret value' },
        },
        required: ['key', 'value'],
      },
      handler: async (params: any) => (await secrets()).set({ key: params.key, value: params.value }),
    },

    // ---- Backups ------------------------------------------------------------
    {
      name: 'backup.create',
      description: 'Back up one database now.',
      inputSchema: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database name' },
          compress: { type: 'boolean', description: 'gzip the dump', default: true },
        },
        required: ['database'],
      },
      handler: async (params: any) =>
        (await backups()).createBackup({ database: params.database, compress: params.compress }),
    },
    {
      name: 'backup.list',
      description: 'List available backups.',
      inputSchema: {
        type: 'object',
        properties: { database: { type: 'string', description: 'Filter by database' } },
      },
      handler: async (params: any) => (await backups()).listBackups({ database: params.database }),
    },
    {
      name: 'backup.restore',
      description: 'Restore a database from a backup. Overwrites the current contents.',
      inputSchema: {
        type: 'object',
        properties: { backupId: { type: 'string', description: 'Backup id from backup.list' } },
        required: ['backupId'],
      },
      handler: async (params: any) => (await backups()).restoreBackup({ backupId: params.backupId }),
    },
    {
      name: 'backup.schedules',
      description: 'List configured recurring backups.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await backups()).listSchedules(),
    },

    // ---- Deploys ------------------------------------------------------------
    {
      name: 'deploy.app',
      description: 'Deploy an app version with the chosen strategy.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'App name' },
          version: { type: 'string', description: 'Version to deploy' },
          strategy: {
            type: 'string',
            description: 'rolling | all-at-once | blue-green | canary',
          },
        },
        required: ['app', 'version'],
      },
      handler: async (params: any) =>
        (await deploy()).deployApp({
          app: params.app,
          version: params.version,
          strategy: params.strategy,
          deployedBy: 'mcp',
        }),
    },
    {
      name: 'deploy.rollback',
      description: 'Roll an app back to its previous version.',
      inputSchema: {
        type: 'object',
        properties: { app: { type: 'string', description: 'App name' } },
        required: ['app'],
      },
      handler: async (params: any) => (await deploy()).rollback({ app: params.app, deployedBy: 'mcp' }),
    },
    {
      name: 'deploy.history',
      description: 'Deployment history, newest first.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'Filter by app' },
          limit: { type: 'number', description: 'Max records', default: 20 },
        },
      },
      handler: async (params: any) =>
        (await deploy()).getHistory({ app: params.app, limit: params.limit ?? 20 }),
    },

    // ---- Fleet --------------------------------------------------------------
    {
      name: 'fleet.status',
      description: 'Every node in the fleet: role, status, last heartbeat.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await fleet()).listNodes(),
    },
    {
      name: 'fleet.summary',
      description: 'Fleet counts: total, online, offline.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await fleet()).getSummary(),
    },

    // ---- Kubernetes ---------------------------------------------------------
    {
      name: 'k8s.pods',
      description: 'List pods.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace (default: current context)' },
          labelSelector: { type: 'string', description: 'Label selector' },
        },
      },
      handler: async (params: any) =>
        (await k8s()).listPods({ namespace: params.namespace, labelSelector: params.labelSelector }),
    },
    {
      name: 'k8s.scale',
      description: 'Scale a deployment.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Deployment name' },
          replicas: { type: 'number', description: 'Desired replica count' },
          namespace: { type: 'string', description: 'Namespace' },
        },
        required: ['name', 'replicas'],
      },
      handler: async (params: any) =>
        (await k8s()).scaleDeployment({
          name: params.name,
          replicas: params.replicas,
          namespace: params.namespace,
        }),
    },

    // ---- Pipelines ----------------------------------------------------------
    {
      name: 'pipeline.list',
      description: 'List CI/CD pipelines.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await pipelines()).listPipelines(),
    },
    {
      name: 'pipeline.run',
      description: 'Execute a pipeline.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline id' },
          params: { type: 'object', description: 'Parameters passed to the run' },
        },
        required: ['id'],
      },
      handler: async (params: any) =>
        (await pipelines()).executePipeline({ id: params.id, params: params.params }),
    },
    {
      name: 'pipeline.status',
      description: 'Status of one pipeline run.',
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string', description: 'Run id from pipeline.run' } },
        required: ['runId'],
      },
      handler: async (params: any) => (await pipelines()).getRunStatus({ runId: params.runId }),
    },
  ];
}
