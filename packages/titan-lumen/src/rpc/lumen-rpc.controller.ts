import { Inject, Injectable, Service } from '@omnitron-dev/titan';
import {
  Public,
  RequireAuth,
  UnauthorizedError,
  type IAuthContext,
  type IAuthDecoratorContext,
  type IAuthMiddleware,
} from '@omnitron-dev/titan-auth';
import { LUMEN_SERVICE_TOKEN } from '../lumen.tokens.js';
import type { AccessFilterService } from '../access/access-filter.service.js';
import { LumenRpcService } from './lumen-rpc.service.js';
import type {
  ILumenModuleOptions,
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

const PRIVILEGED_RPC_ROLES = ['staff', 'security_officer', 'admin'];
const ANONYMOUS_RPC_SESSION: LumenSessionContext = Object.freeze({
  valid: false,
  roles: ['anonymous'],
});

const rawMethodRegistry = new WeakMap<object, Map<string | symbol, (...args: any[]) => Promise<any>>>();

function CaptureRpcMethod(): MethodDecorator {
  return function captureRpcMethod(
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    let methodMap = rawMethodRegistry.get(target);
    if (!methodMap) {
      methodMap = new Map();
      rawMethodRegistry.set(target, methodMap);
    }
    if (typeof descriptor.value === 'function') {
      methodMap.set(propertyKey, descriptor.value);
    }
    return descriptor;
  };
}

function EnforceRpcOrHttpAuth(): MethodDecorator {
  return function enforceRpcOrHttpAuth(
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const httpAuthWrapped = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    const rawMethod = rawMethodRegistry.get(target)?.get(propertyKey);

    descriptor.value = async function invokeProtectedRpcMethod(
      this: IAuthDecoratorContext,
      ...args: unknown[]
    ): Promise<unknown> {
      const hasHttpMiddlewareRequest =
        Boolean(this.__authMiddleware__) &&
        args.some((arg) => typeof arg === 'object' && arg !== null && 'headers' in arg);

      if (hasHttpMiddlewareRequest) {
        try {
          return await httpAuthWrapped.apply(this, args);
        } catch (err: unknown) {
          if (err instanceof UnauthorizedError) {
            throw err;
          }
          throw new UnauthorizedError(err instanceof Error ? err.message : 'Unauthorized');
        } finally {
          this.__authContext__ = undefined;
        }
      }

      if (!rawMethod) {
        throw new UnauthorizedError('Unauthorized');
      }
      return rawMethod.apply(this, args);
    };

    return descriptor;
  };
}

@Service({ name: 'Lumen' })
@Injectable()
export class LumenRpcController implements ILumenRpcService, IAuthDecoratorContext {
  __authMiddleware__?: IAuthMiddleware;
  __authContext__?: IAuthContext;

  constructor(
    @Inject(LUMEN_SERVICE_TOKEN) private readonly service: LumenRpcService,
    authMiddleware: IAuthMiddleware | undefined = undefined
  ) {
    this.__authMiddleware__ = authMiddleware;
  }

  private resolvePublicSession(session?: LumenSessionContext): LumenSessionContext {
    if (session && session.valid === true && Array.isArray(session.roles) && session.roles.length > 0) {
      const cleanRoles = session.roles.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
      if (cleanRoles.length > 0) {
        return {
          valid: true,
          roles: cleanRoles,
          userId: session.userId,
        };
      }
    }

    if (this.__authContext__ && this.__authContext__.userId !== 'anonymous' && this.__authContext__.role) {
      return {
        valid: true,
        roles: [this.__authContext__.role],
        userId: this.__authContext__.userId,
      };
    }

    return ANONYMOUS_RPC_SESSION;
  }

  private assertPrivilegedSession(session?: LumenSessionContext): LumenSessionContext {
    let effectiveSession = session;
    if (
      (!effectiveSession || typeof effectiveSession.valid !== 'boolean') &&
      this.__authContext__ &&
      this.__authContext__.userId !== 'anonymous'
    ) {
      effectiveSession = {
        valid: true,
        roles: [this.__authContext__.role],
        userId: this.__authContext__.userId,
      };
    }

    if (
      !effectiveSession ||
      effectiveSession.valid !== true ||
      !Array.isArray(effectiveSession.roles) ||
      effectiveSession.roles.length === 0
    ) {
      throw new UnauthorizedError('Authentication required: valid staff, security_officer, or admin session needed');
    }

    const hasPrivilegedRole = effectiveSession.roles.some(
      (role) => typeof role === 'string' && PRIVILEGED_RPC_ROLES.includes(role)
    );
    if (!hasPrivilegedRole) {
      throw new UnauthorizedError('Insufficient permissions: staff, security_officer, or admin role required');
    }

    return effectiveSession;
  }

  @Public()
  async search(query: string, searchOptions?: SearchOptions, session?: LumenSessionContext): Promise<SearchResult[]> {
    const effectiveSession = this.resolvePublicSession(session);
    const hasAccessFilterGetter =
      typeof (this.service as { getAccessFilterService?: unknown }).getAccessFilterService === 'function';
    const verifiedRoles = hasAccessFilterGetter
      ? this.service.getAccessFilterService().getEffectiveRoles(effectiveSession)
      : effectiveSession.valid === true && Array.isArray(effectiveSession.roles) && effectiveSession.roles.length > 0
        ? effectiveSession.roles
        : ['anonymous'];

    // Never trust caller-supplied searchOptions.filter.roles on network/RPC entrypoints:
    // explicitly overwrite with verified session clearance roles.
    const sanitizedOptions: SearchOptions = {
      ...(searchOptions ?? {}),
      filter: {
        ...(searchOptions?.filter ?? {}),
        roles: verifiedRoles,
      },
    };

    return this.service.search(query, sanitizedOptions, effectiveSession);
  }

  @EnforceRpcOrHttpAuth()
  @RequireAuth({ roles: ['staff', 'security_officer', 'admin'] })
  @CaptureRpcMethod()
  async executePlayground(code: string, session?: LumenSessionContext): Promise<PlaygroundResult> {
    const verifiedSession = this.assertPrivilegedSession(session);
    return this.service.executePlayground(code, verifiedSession);
  }

  @Public()
  async getDocument(docPath: string, session?: LumenSessionContext): Promise<string | null> {
    return this.service.getDocument(docPath, this.resolvePublicSession(session));
  }

  @Public()
  async getSymbolContract(symbol: string, session?: LumenSessionContext): Promise<SymbolContract | null> {
    return this.service.getSymbolContract(symbol, this.resolvePublicSession(session));
  }

  @Public()
  async getTheoremGraph(session?: LumenSessionContext): Promise<TheoremGraphData> {
    return this.service.getTheoremGraph(this.resolvePublicSession(session));
  }

  @EnforceRpcOrHttpAuth()
  @RequireAuth({ roles: ['staff', 'security_officer', 'admin'] })
  @CaptureRpcMethod()
  async saveLiveEdit(payload: LiveEditPayload, session?: LumenSessionContext): Promise<LiveEditResult> {
    const verifiedSession = this.assertPrivilegedSession(session);
    return this.service.saveLiveEdit(payload, verifiedSession);
  }

  getOptions(): ILumenModuleOptions {
    return this.service.getOptions();
  }

  getAccessFilterService(): AccessFilterService {
    return this.service.getAccessFilterService();
  }
}
