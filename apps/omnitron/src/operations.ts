/** Operator-side automation primitives shared by CLI, Console pipelines and deployment tools.
 * Credentials stay in the daemon vault; this entry point does not expose them to browser code.
 */
export { createDaemonClient, LONG_REQUEST_TIMEOUT } from './daemon/daemon-client.js';
export { ExecutionService, type SSHTarget } from './execution/execution.service.js';
export { RemoteDeployer, type DeployTarget } from './services/remote-deployer.service.js';
export { buildBundle, archiveBundle } from './services/bundle-builder.js';
export { PLATFORM_PROBE, parsePlatformProbe, planProvisioning } from './services/remote-provisioner.js';
export { StackInfrastructureManager } from './infrastructure/stack-infra-manager.js';
export { summariseProvisioning } from './infrastructure/provisioning-outcome.js';
export type { IOmnitronPipelinesService, IOmnitronSecretsService } from './shared/dto/services.js';
export type { INodeWithStatus } from './shared/dto/nodes.js';
