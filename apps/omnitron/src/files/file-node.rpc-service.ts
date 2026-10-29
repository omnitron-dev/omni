import { Service, Public } from '@omnitron-dev/titan/decorators';
import { getCurrentAuth } from '../services/auth-context.js';
import type { FileNodeRequest, IOmnitronFileNodeService } from '../shared/dto/files.js';
import type { FileNode } from './file-node.js';

/** Mesh-only endpoint. Human callers use OmnitronFiles and its live-session/audit boundary. */
@Service({ name: 'OmnitronFileNode' })
export class FileNodeRpcService implements IOmnitronFileNodeService {
  constructor(private readonly files: FileNode) {}
  @Public({ auth: { roles: ['service_role'] } })
  async invoke(data: { actor: string; request: FileNodeRequest }): Promise<unknown> {
    const principal = getCurrentAuth();
    if (
      !principal?.userId ||
      !principal.roles?.includes('service_role') ||
      !principal.userId.startsWith('mesh:') ||
      principal.metadata?.['isServiceRole'] !== true ||
      !data ||
      typeof data.actor !== 'string' ||
      data.actor.length > 150
    )
      throw new Error('File node protocol requires an authenticated control-plane peer');
    return this.files.invoke(`${principal.userId}:${data.actor}`, data.request);
  }
}
