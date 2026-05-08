/**
 * ServiceDescriptor — compile-time link between a service's wire name
 * and its TypeScript interface.
 *
 * Why: today's bug — the backend declared `@Service({ name:
 * 'SwapV2AdminService' })` while the frontend called the service by
 * literal `'SwapAdminService'`. Both string literals, no relationship,
 * no compile error. Production discovered the mismatch via 404 at
 * runtime.
 *
 * Pattern: define the descriptor ONCE in a shared DTO module. Both
 * sides import it. Renaming the service name (or its interface) is
 * a single edit; any consumer that drifted lights up the type checker.
 *
 * @example
 * ```ts
 * // shared DTO (apps/main/src/shared/dto/services.ts):
 * import { ServiceDescriptor } from '@omnitron-dev/titan/netron';
 *
 * export interface IAuthService {
 *   signIn(input: SignInInput): Promise<Session>;
 *   ...
 * }
 *
 * export const AuthService = ServiceDescriptor.of<IAuthService>('Auth', '1.0.0');
 *
 *
 * // backend (apps/main/src/modules/auth/auth.rpc-service.ts):
 * import { AuthService } from '@daos/main/dto';
 *
 * @Service(AuthService)        // accepts ServiceDescriptor — name + version come from it
 * class AuthRpcService implements IAuthService { ... }
 *
 *
 * // frontend (apps/portal/src/netron/rpc.ts):
 * import { AuthService } from 'main/dto/services';
 *
 * export function authRpc<M extends keyof IAuthService>(
 *   method: M,
 *   ...args: Parameters<IAuthService[M]>
 * ): Promise<Awaited<ReturnType<IAuthService[M]>>> {
 *   return invokeDescriptor('main', AuthService, method, args);
 *   // descriptor.name flows into the wire name; renaming on backend
 *   // forces frontend to recompile too.
 * }
 * ```
 */

/**
 * Phantom type marker so a descriptor is bound to a specific
 * interface at the type level. The runtime payload only carries
 * `name` and `version` — the `_interface` field never holds a value.
 */
declare const __serviceInterface: unique symbol;

export interface ServiceDescriptor<TInterface> {
  /** Wire-format name (e.g. 'Auth', 'SwapAdminService'). */
  readonly name: string;
  /** Semver version string (e.g. '1.0.0'). May be empty for unversioned. */
  readonly version: string;
  /** Combined `name@version` form used by Netron's qualified registry. */
  readonly qualifiedName: string;
  /** Phantom — never populated; ties this descriptor to TInterface. */
  readonly [__serviceInterface]?: TInterface;
}

/**
 * Build a typed ServiceDescriptor. Pass the interface as the type
 * parameter and the wire name (and optional version) at runtime.
 */
function ofImpl<TInterface>(name: string, version = ''): ServiceDescriptor<TInterface> {
  if (!name) throw new Error('ServiceDescriptor.of: name is required');
  return Object.freeze({
    name,
    version,
    qualifiedName: version ? `${name}@${version}` : name,
  }) as ServiceDescriptor<TInterface>;
}

/**
 * Type-only narrowing helper. Lets consumers extract `TInterface`
 * from a descriptor at the type level — useful for generic helpers
 * over multiple services.
 */
export type InterfaceOf<D> = D extends ServiceDescriptor<infer I> ? I : never;

/**
 * Type-guard that lets the @Service decorator accept either a string
 * literal, a ServiceOptions object, or a ServiceDescriptor.
 */
export function isServiceDescriptor(value: unknown): value is ServiceDescriptor<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { qualifiedName?: unknown }).qualifiedName === 'string'
  );
}

/**
 * Public surface — kept as a const-with-method so callers do
 * `ServiceDescriptor.of<IAuth>(...)` symmetrically with how
 * other typed factories in titan are spelled (e.g. `Token.of`).
 */
export const ServiceDescriptor = {
  of: ofImpl,
};
