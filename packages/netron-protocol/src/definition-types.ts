/**
 * Service-definition shape types — the structural contract describing a service
 * (its name, version, public properties, and public methods) as it travels over
 * the wire in a `Definition`.
 *
 * These were byte-identical in titan (`interfaces/core-types.ts`) and
 * netron-browser (`core/types.ts`); defined once here so the shape both ends
 * marshal/unmarshal cannot drift. Pure types — erased at runtime.
 */

/**
 * Information about a method argument (position + type), used for type checking
 * and documentation.
 */
export interface ArgumentInfo {
  /** Zero-based index of the argument in the method signature. */
  index: number;
  /** The argument's type as a string (primitive, class, or interface name). */
  type: string;
}

/**
 * Information about a method: its return type and arguments.
 */
export interface MethodInfo {
  /** The method's return type as a string. */
  type: string;
  /** Each argument's position and type. */
  arguments: ArgumentInfo[];
}

/**
 * Information about a property: its type and mutability.
 */
export interface PropertyInfo {
  /** The property's type as a string. */
  type: string;
  /** Whether the property is read-only. */
  readonly: boolean;
}

/**
 * Metadata for a service — name, version, and its public property/method maps.
 * Only public members appear in the maps.
 */
export interface ServiceMetadata {
  /** Service name (alphanumerics + dots). */
  name: string;
  /** Service version (semver when specified). */
  version: string;
  /** Public property name → metadata. */
  properties: Record<string, PropertyInfo>;
  /** Public method name → metadata. */
  methods: Record<string, MethodInfo>;
}

/**
 * Service contract type for validation — the expected interface of a service.
 */
export type ServiceContract = Record<string, unknown>;

/**
 * Service metadata extended with its (optional) contract. Used internally by
 * service stubs.
 */
export interface ServiceMetadataWithContract extends ServiceMetadata {
  contract?: ServiceContract;
}
