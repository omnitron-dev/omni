import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import { ADMIN_ROLES, CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import { getCurrentAuth } from '../services/auth-context.js';
import type { OmnitronDaemon } from './daemon.js';
import type { BackendRuntimeStatus } from '../shared/dto/backend.js';

@Service({ name: 'OmnitronBackend' })
export class BackendRpcService {
  constructor(private readonly daemon: Pick<OmnitronDaemon, 'backendRuntimeStatus' | 'backendControlAddress' | 'startConsole'>) {}

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async status(): Promise<BackendRuntimeStatus> { return this.daemon.backendRuntimeStatus(); }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async startConsole(options: { force?: boolean; temporary?: boolean } = {}) {
    if (getCurrentAuth()?.metadata?.['source'] !== 'local-unix-socket')
      throw Errors.forbidden('Console publication requires the local administrator socket');
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        ![null, Object.prototype].includes(Object.getPrototypeOf(options)) || Object.entries(options).some(([key, value]) =>
      !['force', 'temporary'].includes(key) || typeof value !== 'boolean'))
      throw Error('Invalid Console start options');
    return this.daemon.startConsole(options);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async controlAddress(): Promise<{ socket: string }> {
    if (getCurrentAuth()?.metadata?.['source'] !== 'local-unix-socket') {
      throw Errors.forbidden('Backend artifact activation requires the local administrator socket');
    }
    return { socket: this.daemon.backendControlAddress() };
  }
}
