/**
 * Deploy DTOs — the wire shapes of the OmnitronDeploy service.
 *
 * Declared away from `services/deploy.service.ts` for the reason set out in
 * `./auth.ts`.
 */

export interface DeployResult {
  id: string;
  app: string;
  version: string;
  previousVersion: string | null;
  strategy: string;
  status: 'success' | 'failed' | 'rolled_back';
  duration: number;
  error?: string | undefined;
}

export interface DeploymentRecord {
  id: string;
  app: string;
  version: string;
  previousVersion: string | null;
  strategy: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  deployedBy: string | null;
}
