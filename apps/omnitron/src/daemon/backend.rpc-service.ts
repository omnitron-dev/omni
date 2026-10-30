import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import { ADMIN_ROLES, CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import { getCurrentAuth } from '../services/auth-context.js';
import type { OmnitronDaemon } from './daemon.js';
import type { BackendRuntimeStatus } from '../shared/dto/backend.js';

@Service({ name: 'OmnitronBackend' })
export class BackendRpcService {
  constructor(private readonly daemon: OmnitronDaemon) {}

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async status(): Promise<BackendRuntimeStatus> { return this.daemon.backendRuntimeStatus(); }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async controlAddress(): Promise<{ socket: string }> {
    if (getCurrentAuth()?.metadata?.['source'] !== 'local-unix-socket') {
      throw Errors.forbidden('Backend artifact activation requires the local administrator socket');
    }
    return { socket: this.daemon.backendControlAddress() };
  }
}
