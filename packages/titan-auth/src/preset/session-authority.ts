import { Public, Service } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import type { SessionAuthorityLookup } from './shared-session.js';

/** Optional RPC adapter. The owner supplies persistence; peer credentials remain transport-owned. */
@Service('SessionAuthority@1.0.0')
export class SessionAuthorityService {
  constructor(private readonly lookup: SessionAuthorityLookup) {}

  @Public({ auth: { roles: ['service_role'], permissions: ['sessions.resolve'] } })
  async resolve(data: { sessionId: string; userId: string }) {
    if (!data || ![data.sessionId, data.userId].every(value =>
      typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value))
      throw Errors.badRequest('Bounded session and subject identifiers are required');
    const authority = await this.lookup(data.sessionId, data.userId);
    return authority?.userId === data.userId ? authority : null;
  }
}
