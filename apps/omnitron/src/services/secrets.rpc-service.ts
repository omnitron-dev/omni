/**
 * Secrets RPC Service
 *
 * Netron RPC endpoints for encrypted secrets management.
 * All endpoints require authentication (admin role).
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { ADMIN_ROLES } from '../shared/roles.js';
import type { SecretsService } from './secrets.service.js';

import type { IOmnitronSecretsService } from '../shared/dto/services.js';

@Service({ name: 'OmnitronSecrets' })
export class SecretsRpcService implements IOmnitronSecretsService {
  constructor(
    private readonly secrets: SecretsService,
    /**
     * The audit trail, when this daemon has one.
     *
     * The vault is the one surface where READING is worth recording: a
     * value that leaves here can be used anywhere, and the only account of
     * who took it is this row.
     */
    private readonly audit?: import('./audit.service.js').AuditService | undefined,
  ) {}

  /**
   * Get a secret by key. Returns null if not found.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async get(data: { key: string }): Promise<{ key: string; value: string | null }> {
    const value = await this.secrets.get(data.key);
    await this.audit?.record({
      action: 'secret.read',
      resourceType: 'secret',
      resourceId: data.key,
      details: { found: value !== null },
    });
    return { key: data.key, value };
  }

  /**
   * Set a secret. Creates or updates the value.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async set(data: { key: string; value: string }): Promise<{ success: boolean }> {
    await this.secrets.set(data.key, data.value);
    // The KEY, never the value — see `scrubDetails`.
    await this.audit?.record({ action: 'secret.set', resourceType: 'secret', resourceId: data.key });
    return { success: true };
  }

  /**
   * Delete a secret by key.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async delete(data: { key: string }): Promise<{ success: boolean; existed: boolean }> {
    const existed = await this.secrets.delete(data.key);
    await this.audit?.record({
      action: 'secret.delete',
      resourceType: 'secret',
      resourceId: data.key,
      details: { existed },
    });
    return { success: true, existed };
  }

  /**
   * List all secret keys (values are NOT returned for security).
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async list(): Promise<{ keys: string[] }> {
    const keys = await this.secrets.list();
    return { keys };
  }
}
