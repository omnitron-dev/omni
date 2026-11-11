import { Inject, Injectable, Service } from '@omnitron-dev/titan';
import { Public, getCurrentInvocationContext } from '@omnitron-dev/titan/netron';
import { Errors } from '@omnitron-dev/titan/errors';
import { LUMEN_SERVICE_TOKEN } from '../lumen.tokens.js';
import { LumenRpcService } from './lumen-rpc.service.js';
import type {
  ILumenRpcService,
  LiveEditPayload,
  LiveEditResult,
  LumenSessionContext,
  PlaygroundResult,
  SearchOptions,
  SearchResult,
  SymbolContract,
  TheoremGraphData,
} from '../interfaces.js';

function invocationSession(required = false): LumenSessionContext {
  const auth = getCurrentInvocationContext()?.auth;
  if (auth) return { valid: true, userId: auth.userId, roles: [...auth.roles] };
  if (required) throw Errors.unauthorized('An authenticated Netron invocation is required');
  return { valid: false, roles: ['anonymous'] };
}

/** Authentication and operation permissions belong to Netron; document ACLs to Lumen. */
@Service({ name: 'Lumen' })
@Injectable()
export class LumenRpcController implements ILumenRpcService {
  constructor(@Inject(LUMEN_SERVICE_TOKEN) private readonly service: LumenRpcService) {}

  @Public({ auth: { allowAnonymous: true } })
  async search(query: string, searchOptions?: SearchOptions): Promise<SearchResult[]> {
    const session = invocationSession();
    return this.service.search(query, {
      ...searchOptions,
      filter: { ...searchOptions?.filter, roles: session.roles },
    }, session);
  }

  @Public({ auth: { permissions: ['lumen.playground.execute'] } })
  async executePlayground(code: string): Promise<PlaygroundResult> {
    return this.service.executePlayground(code, invocationSession(true));
  }

  @Public({ auth: { allowAnonymous: true } })
  async getDocument(docPath: string): Promise<string | null> {
    return this.service.getDocument(docPath, invocationSession());
  }

  @Public({ auth: { allowAnonymous: true } })
  async getSymbolContract(symbol: string): Promise<SymbolContract | null> {
    return this.service.getSymbolContract(symbol, invocationSession());
  }

  @Public({ auth: { allowAnonymous: true } })
  async getTheoremGraph(): Promise<TheoremGraphData> {
    return this.service.getTheoremGraph(invocationSession());
  }

  @Public({ auth: { permissions: ['lumen.documents.write'] } })
  async saveLiveEdit(payload: LiveEditPayload): Promise<LiveEditResult> {
    return this.service.saveLiveEdit(payload, invocationSession(true));
  }
}
