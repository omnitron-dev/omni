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
   * Make a secret here and keep it — random bytes of the given length, in the
   * given encoding — and answer with its name only.
   *
   * For a key nobody should have to type or paste: a secret set with `set`
   * has passed through a terminal, an argument list and a clipboard first. A
   * key that already exists is refused rather than replaced — it is somebody's
   * secret, and whatever it protects would be lost with it; `delete` first,
   * on purpose, if that is the intent.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async generate(data: {
    key: string;
    bytes?: number;
    encoding?: 'base64' | 'base64url' | 'hex';
  }): Promise<{ key: string; bytes: number; encoding: 'base64' | 'base64url' | 'hex' }> {
    const key = data.key?.trim();
    if (!key) throw new Error('A secret needs a key');
    const bytes = data.bytes ?? 32;
    if (!Number.isInteger(bytes) || bytes < 16 || bytes > 1024) {
      throw new Error(`--bytes must be a whole number from 16 to 1024, not ${String(data.bytes)}`);
    }
    const encoding = data.encoding ?? 'base64';
    if (!['base64', 'base64url', 'hex'].includes(encoding)) {
      throw new Error(`--encoding must be base64, base64url or hex, not ${String(data.encoding)}`);
    }
    if ((await this.secrets.get(key)) !== null) {
      throw new Error(`The vault already holds '${key}' — nothing was generated. Delete it first if replacing it is the intent`);
    }
    const { randomBytes } = await import('node:crypto');
    await this.secrets.set(key, randomBytes(bytes).toString(encoding));
    await this.audit?.record({ action: 'secret.generate', resourceType: 'secret', resourceId: key, details: { bytes, encoding } });
    return { key, bytes, encoding };
  }

  /**
   * A second key holding the same secret, made here — the answer names the
   * two keys, never the value. See `SecretsService.copy`.
   *
   * Recorded as what it is: a read of `from` whose value went to `to`.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async copy(data: { from: string; to: string }): Promise<{ from: string; to: string }> {
    const from = data.from?.trim() ?? '';
    const to = data.to?.trim() ?? '';
    await this.secrets.copy(from, to);
    await this.audit?.record({ action: 'secret.copy', resourceType: 'secret', resourceId: to, details: { from } });
    return { from, to };
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
