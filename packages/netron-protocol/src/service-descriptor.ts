/**
 * Shared service identity for Titan and browser/React clients.
 * Define a descriptor beside the service interface and use it on both ends.
 *
 * @example
 * ```ts
 * import { ServiceDescriptor } from '@omnitron-dev/netron-protocol';
 * interface Catalog { read(id: string): Promise<string> }
 * export const CatalogService = ServiceDescriptor.of<Catalog>('Catalog', '1.0.0');
 * // Server: @Service(CatalogService)
 * // Client: client.service(CatalogService).read('guide')
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

/** Method names and invocation types derived from the shared service interface. */
export type ServiceMethodName<I> = {
  [K in keyof I]-?: I[K] extends (...args: never[]) => unknown ? K : never;
}[keyof I] & string;
export type ServiceArguments<I, M extends ServiceMethodName<I>> = I[M] extends (...args: infer A) => unknown ? A : never;
export type ServiceResult<I, M extends ServiceMethodName<I>> = I[M] extends (...args: never[]) => infer R ? Awaited<R> : never;
