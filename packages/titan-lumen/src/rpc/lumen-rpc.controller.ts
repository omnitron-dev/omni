import { Service } from '@omnitron-dev/titan';
import { Public } from '@omnitron-dev/titan-auth';
import { LumenRpcService } from './lumen-rpc.service.js';
import type {
  ILumenModuleOptions,
  ILumenRpcService,
  PlaygroundResult,
  SearchOptions,
  SearchResult,
  SymbolContract,
  TheoremGraphData,
  LiveEditPayload,
  LiveEditResult,
} from '../interfaces.js';

@Service({ name: 'Lumen' })
export class LumenRpcController implements ILumenRpcService {
  constructor(private readonly service: LumenRpcService) {}

  @Public()
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this.service.search(query, options);
  }

  @Public()
  async executePlayground(code: string): Promise<PlaygroundResult> {
    return this.service.executePlayground(code);
  }

  @Public()
  async getDocument(path: string): Promise<string | null> {
    return this.service.getDocument(path);
  }

  @Public()
  async getSymbolContract(symbol: string): Promise<SymbolContract | null> {
    return this.service.getSymbolContract(symbol);
  }

  @Public()
  async getTheoremGraph(): Promise<TheoremGraphData> {
    return this.service.getTheoremGraph();
  }

  @Public()
  async saveLiveEdit(payload: LiveEditPayload): Promise<LiveEditResult> {
    return this.service.saveLiveEdit(payload);
  }

  getOptions(): ILumenModuleOptions {
    return this.service.getOptions();
  }
}
