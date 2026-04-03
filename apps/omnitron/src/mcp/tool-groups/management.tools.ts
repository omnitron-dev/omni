import type { IMcpToolDef } from '../types.js';

/**
 * Management MCP tools — stacks, secrets, backup, deploy, cluster, fleet, k8s, project.
 * These are thin RPC bridges to existing daemon services.
 */
export function createManagementTools(daemonClient: any): IMcpToolDef[] {
  return [
    // ---- Stack Management ---------------------------------------------------
    {
      name: 'stack.list',
      description: 'List all stacks with their status.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Filter by project name' },
        },
      },
      handler: async (params: any) => daemonClient.stackList(params),
    },
    {
      name: 'stack.create',
      description: 'Create a new stack.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', description: 'Stack type' },
          apps: { type: 'array', items: { type: 'string' }, description: 'Apps to include' },
        },
        required: ['project', 'name'],
      },
      handler: async (params: any) => daemonClient.stackCreate(params),
    },
    {
      name: 'stack.status',
      description: 'Get detailed status of a stack.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['project', 'name'],
      },
      handler: async (params: any) => daemonClient.stackStatus(params),
    },
    {
      name: 'stack.start',
      description: 'Start a stack.',
      inputSchema: {
        type: 'object',
        properties: { project: { type: 'string' }, name: { type: 'string' } },
        required: ['project', 'name'],
      },
      handler: async (params: any) => daemonClient.stackStart(params),
    },
    {
      name: 'stack.stop',
      description: 'Stop a stack.',
      inputSchema: {
        type: 'object',
        properties: { project: { type: 'string' }, name: { type: 'string' } },
        required: ['project', 'name'],
      },
      handler: async (params: any) => daemonClient.stackStop(params),
    },

    // ---- Secrets Management -------------------------------------------------
    {
      name: 'secret.list',
      description: 'List all stored secrets (names only, not values).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.secretList(),
    },
    {
      name: 'secret.get',
      description: 'Get a secret value by key.',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
      handler: async (params: any) => daemonClient.secretGet(params.key),
    },
    {
      name: 'secret.set',
      description: 'Set a secret value.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['key', 'value'],
      },
      handler: async (params: any) => daemonClient.secretSet(params.key, params.value),
    },

    // ---- Backup -------------------------------------------------------------
    {
      name: 'backup.create',
      description: 'Create a database backup.',
      inputSchema: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database name (default: all)' },
        },
      },
      handler: async (params: any) => daemonClient.backupCreate(params),
    },
    {
      name: 'backup.list',
      description: 'List available backups.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.backupList(),
    },
    {
      name: 'backup.restore',
      description: 'Restore a backup by ID.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      handler: async (params: any) => daemonClient.backupRestore(params.id),
    },

    // ---- Deploy -------------------------------------------------------------
    {
      name: 'deploy.app',
      description: 'Deploy an application.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string' },
          strategy: { type: 'string', enum: ['rolling', 'blue-green', 'canary'] },
          version: { type: 'string' },
          target: { type: 'string', description: 'Target node/cluster' },
        },
        required: ['app'],
      },
      handler: async (params: any) => daemonClient.deployApp(params),
    },
    {
      name: 'deploy.build',
      description: 'Build an application for deployment.',
      inputSchema: {
        type: 'object',
        properties: { app: { type: 'string' } },
        required: ['app'],
      },
      handler: async (params: any) => daemonClient.deployBuild(params.app),
    },
    {
      name: 'deploy.rollback',
      description: 'Rollback an application to a previous version.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string' },
          target: { type: 'string', description: 'Target version or deployment ID' },
        },
        required: ['app'],
      },
      handler: async (params: any) => daemonClient.rollback(params),
    },

    // ---- Cluster & Fleet ----------------------------------------------------
    {
      name: 'cluster.status',
      description: 'Get cluster status: leader, followers, election term.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.clusterStatus(),
    },
    {
      name: 'fleet.status',
      description: 'Get aggregated fleet status across all nodes.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.fleetStatus(),
    },
    {
      name: 'fleet.health',
      description: 'Get fleet-wide health report.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.fleetHealth(),
    },

    // ---- K8s ----------------------------------------------------------------
    {
      name: 'k8s.pods',
      description: 'List Kubernetes pods.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'K8s namespace (default: default)' },
        },
      },
      handler: async (params: any) => daemonClient.k8sPods(params),
    },
    {
      name: 'k8s.scale',
      description: 'Scale a Kubernetes deployment.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          replicas: { type: 'number' },
          namespace: { type: 'string' },
        },
        required: ['name', 'replicas'],
      },
      handler: async (params: any) => daemonClient.k8sScale(params),
    },

    // ---- Project & Webapp ---------------------------------------------------
    {
      name: 'project.list',
      description: 'List registered seed projects.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.projectList(),
    },
    {
      name: 'project.scan',
      description: 'Scan a project for infrastructure requirements.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.projectScan(),
    },
    {
      name: 'webapp.status',
      description: 'Get webapp (portal UI) status.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.webappStatus(),
    },
    {
      name: 'webapp.build',
      description: 'Build the webapp.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.webappBuild(),
    },

    // ---- Pipeline -----------------------------------------------------------
    {
      name: 'pipeline.list',
      description: 'List CI/CD pipelines.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.pipelineList(),
    },
    {
      name: 'pipeline.run',
      description: 'Run a CI/CD pipeline.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      handler: async (params: any) => daemonClient.pipelineRun(params.id),
    },
    {
      name: 'pipeline.status',
      description: 'Get pipeline run status.',
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string' } },
        required: ['runId'],
      },
      handler: async (params: any) => daemonClient.pipelineStatus(params.runId),
    },
  ];
}
