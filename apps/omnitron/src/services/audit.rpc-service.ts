/**
 * Reading the audit trail.
 *
 * Admin-only, and deliberately narrower than the table: `details` is
 * scrubbed on the way IN, so nothing here has to be trusted to redact — but
 * the rows still name who did what to which resource from which address,
 * and that is not a viewer's business.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';

import { ADMIN_ROLES } from '../shared/roles.js';
import type { AuditService, AuditQuery, AuditRow } from './audit.service.js';
import type { IOmnitronAuditService } from '../shared/dto/services.js';

@Service({ name: 'OmnitronAudit' })
export class AuditRpcService implements IOmnitronAuditService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Recent entries, newest first.
   *
   * `limit` is capped by the service, not by the caller: a page size is the
   * cost of the request, and the server is the only side that knows what it
   * can afford.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async list(data: AuditQuery = {}): Promise<AuditRow[]> {
    return this.audit.list(data);
  }

  /** Whether this daemon records anything at all. */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async available(): Promise<{ available: boolean }> {
    return { available: this.audit.available };
  }
}
