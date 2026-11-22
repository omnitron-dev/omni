import { Public, Service } from '@omnitron-dev/titan/decorators';
import { getCurrentInvocationContext } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { ADMIN_ROLES } from '../shared/roles.js';
import { assertBinding, fields } from '../infrastructure/retained-binding-ticket.js';
import type { RetainedBindings, ApproveRetained, ApplyRetained } from './retained-bindings.js';

/** Both historical owners authorize locally on the normal, owner-only Netron socket. */
@Service({ name: 'OmnitronRetainedBindings', transports: [new UnixSocketTransport()] })
export class RetainedBindingsRpcService {
  constructor(private readonly provider: RetainedBindings) {}
  private async local<T>(call: () => T | Promise<T>) {
    const context = getCurrentInvocationContext();
    assertBinding(context?.transport === 'unix' && context.auth?.userId === 'omnitron-local' &&
      context.auth.metadata?.['source'] === 'local-unix-socket' && context.auth.roles.length === 1 && context.auth.roles[0] === 'admin');
    try { return await call(); } catch { throw Error('The retained binding operation was not confirmed by this owner'); }
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  identity() { return this.local(() => this.provider.identity()); }
  @Public({ auth: { roles: ADMIN_ROLES } })
  approve(input: ApproveRetained) { return this.local(() => this.provider.approve(input)); }
  @Public({ auth: { roles: ADMIN_ROLES } })
  apply(input: ApplyRetained) { return this.local(() => this.provider.apply(input)); }
  @Public({ auth: { roles: ADMIN_ROLES } })
  revoke(input: { id: string; expect: string }) {
    return this.local(() => { assertBinding(fields(input, ['id', 'expect'])); return this.provider.revoke(input.id, input.expect); });
  }
}
