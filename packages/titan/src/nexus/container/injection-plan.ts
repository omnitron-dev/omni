/**
 * Injection plan extraction
 *
 * Walks the prototype chain and reads the rich metadata produced by the
 * @Inject / @InjectAll / @Value / @InjectConfig / @InjectEnv / @ConditionalInject
 * / @Optional / @Lazy decorators (decorators/injection.ts).
 *
 * The container does not need to know about each decorator individually — it
 * works against a normalized list of `Dependency` descriptors. Adding a new
 * decorator means only adding a new descriptor variant here.
 *
 * @internal
 * @since 0.1.0
 */

import 'reflect-metadata';
import { Constructor, InjectionToken } from '../types.js';

// Decorator-side metadata keys. Mirrors decorators/core.ts METADATA_KEYS and
// decorators/constants.ts DECORATOR_METADATA — duplicated here as plain
// strings so the container does not import the decorator package, keeping
// the module dependency direction (decorators -> container) one-way.
const KEYS = {
  CONSTRUCTOR_PARAMS: 'nexus:constructor-params',
  PROPERTY_PARAMS: 'nexus:property-params',
  OPTIONAL: 'nexus:optional',
  INJECT_ALL: 'nexus:inject-all',
  INJECT: 'nexus:inject', // legacy fallback used by extractClassDependencies
  VALUES: 'titan:inject:values',
  ENV: 'titan:inject:env',
  CONFIG: 'titan:inject:config',
  CONDITIONAL: 'titan:inject:conditional',
  PROPERTY_VALUES: 'titan:inject:property:values',
  PROPERTY_ENV: 'titan:inject:property:env',
  PROPERTY_CONFIG: 'titan:inject:property:config',
  PROPERTY_CONDITIONAL: 'titan:inject:property:conditional',
  PROPERTY_INJECT_ALL: 'titan:inject:property:all',
} as const;

export const PROPERTY_DECORATOR_KEYS = {
  PROPERTY_VALUES: KEYS.PROPERTY_VALUES,
  PROPERTY_ENV: KEYS.PROPERTY_ENV,
  PROPERTY_CONFIG: KEYS.PROPERTY_CONFIG,
  PROPERTY_CONDITIONAL: KEYS.PROPERTY_CONDITIONAL,
  PROPERTY_INJECT_ALL: KEYS.PROPERTY_INJECT_ALL,
} as const;

export type Dependency =
  | { kind: 'token'; token: InjectionToken<unknown>; optional?: boolean }
  | { kind: 'all'; token: InjectionToken<unknown> }
  | { kind: 'value'; path: string; defaultValue?: unknown }
  | { kind: 'config'; path: string }
  | { kind: 'env'; key: string; defaultValue?: unknown }
  | {
      kind: 'conditional';
      token: InjectionToken<unknown>;
      condition: () => boolean;
      fallback?: unknown | (() => unknown);
    };

export interface PropertyInjection {
  property: string | symbol;
  dependency: Dependency;
}

export interface InjectionPlan {
  constructorParams: Array<Dependency | undefined>;
  properties: PropertyInjection[];
}

/**
 * Walk the prototype chain root-first (Object.prototype side), accumulating
 * own metadata at each level. Subclass entries override parent entries when
 * keyed by the same property name.
 */
function walkPrototypes(target: Constructor | undefined): Array<Constructor | object> {
  const chain: Array<Constructor | object> = [];
  let cur: any = target;
  while (cur && cur !== Function.prototype && cur !== Object.prototype) {
    chain.unshift(cur);
    cur = Object.getPrototypeOf(cur);
  }
  return chain;
}

function readArrayMeta<T>(key: string, target: any): T[] {
  return (Reflect.getOwnMetadata(key, target) as T[] | undefined) ?? [];
}

function readObjectMeta<T>(key: string, target: any): Record<string | symbol, T> {
  return (Reflect.getOwnMetadata(key, target) as Record<string | symbol, T> | undefined) ?? {};
}

/**
 * Collect the constructor parameter dependency at `index` from the most
 * specific source available, using this priority:
 *   InjectAll > Value > Env > Config > Conditional > Inject (token).
 */
function collectConstructorParam(
  ctor: Constructor,
  index: number,
  optionalSlots: boolean[]
): Dependency | undefined {
  const all = readArrayMeta<InjectionToken<unknown> | undefined>(KEYS.INJECT_ALL, ctor);
  if (all[index] != null) return { kind: 'all', token: all[index]! };

  const values = readArrayMeta<{ path: string; defaultValue?: unknown } | undefined>(KEYS.VALUES, ctor);
  if (values[index] != null) {
    return { kind: 'value', path: values[index]!.path, defaultValue: values[index]!.defaultValue };
  }

  const env = readArrayMeta<{ key: string; defaultValue?: unknown } | undefined>(KEYS.ENV, ctor);
  if (env[index] != null) return { kind: 'env', key: env[index]!.key, defaultValue: env[index]!.defaultValue };

  const config = readArrayMeta<string | undefined>(KEYS.CONFIG, ctor);
  if (config[index] != null) return { kind: 'config', path: config[index]! };

  const conditional = readArrayMeta<
    | {
        token: InjectionToken<unknown>;
        condition: () => boolean;
        fallback?: unknown | (() => unknown);
      }
    | undefined
  >(KEYS.CONDITIONAL, ctor);
  if (conditional[index] != null) {
    const c = conditional[index]!;
    return {
      kind: 'conditional',
      token: c.token,
      condition: c.condition,
      fallback: c.fallback,
    };
  }

  // Plain @Inject(token) sets CONSTRUCTOR_PARAMS; legacy @Injectable() sets INJECT.
  const params =
    readArrayMeta<InjectionToken<unknown> | undefined>(KEYS.CONSTRUCTOR_PARAMS, ctor) ??
    readArrayMeta<InjectionToken<unknown> | undefined>(KEYS.INJECT, ctor);
  const token = params[index];
  if (token != null) {
    return { kind: 'token', token, optional: optionalSlots[index] === true };
  }

  return undefined;
}

/**
 * Build a full injection plan for the given class constructor.
 */
export function buildInjectionPlan(ctor: Constructor | undefined): InjectionPlan {
  const plan: InjectionPlan = { constructorParams: [], properties: [] };
  if (!ctor) return plan;

  // Constructor params live on the constructor function (not the prototype).
  const optionalSlots = readArrayMeta<boolean | undefined>(KEYS.OPTIONAL, ctor).map((v) => v === true);
  const constructorIndices = new Set<number>();
  const sourcesForCount = [
    KEYS.CONSTRUCTOR_PARAMS,
    KEYS.INJECT,
    KEYS.INJECT_ALL,
    KEYS.VALUES,
    KEYS.ENV,
    KEYS.CONFIG,
    KEYS.CONDITIONAL,
  ];
  for (const key of sourcesForCount) {
    const arr = readArrayMeta<unknown>(key, ctor);
    arr.forEach((_, idx) => constructorIndices.add(idx));
  }
  const maxIndex = constructorIndices.size === 0 ? -1 : Math.max(...constructorIndices);
  for (let i = 0; i <= maxIndex; i++) {
    plan.constructorParams[i] = collectConstructorParam(ctor, i, optionalSlots);
  }

  // Property metadata is stored on the prototype by ParameterDecorator semantics.
  // Walk the chain so subclasses can override / extend.
  const seen = new Map<string | symbol, PropertyInjection>();
  for (const target of walkPrototypes(ctor.prototype as any)) {
    const propTokens = readObjectMeta<InjectionToken<unknown>>(KEYS.PROPERTY_PARAMS, target);
    for (const key of Reflect.ownKeys(propTokens)) {
      const token = propTokens[key as any];
      if (token != null) seen.set(key, { property: key, dependency: { kind: 'token', token } });
    }
    const propAll = readObjectMeta<InjectionToken<unknown>>(KEYS.PROPERTY_INJECT_ALL, target);
    for (const key of Reflect.ownKeys(propAll)) {
      const token = propAll[key as any];
      if (token != null) seen.set(key, { property: key, dependency: { kind: 'all', token } });
    }
    const propValues = readObjectMeta<{ path: string; defaultValue?: unknown }>(KEYS.PROPERTY_VALUES, target);
    for (const key of Reflect.ownKeys(propValues)) {
      const v = propValues[key as any];
      if (v != null) {
        seen.set(key, { property: key, dependency: { kind: 'value', path: v.path, defaultValue: v.defaultValue } });
      }
    }
    const propEnv = readObjectMeta<{ key: string; defaultValue?: unknown }>(KEYS.PROPERTY_ENV, target);
    for (const key of Reflect.ownKeys(propEnv)) {
      const v = propEnv[key as any];
      if (v != null) {
        seen.set(key, { property: key, dependency: { kind: 'env', key: v.key, defaultValue: v.defaultValue } });
      }
    }
    const propConfig = readObjectMeta<string>(KEYS.PROPERTY_CONFIG, target);
    for (const key of Reflect.ownKeys(propConfig)) {
      const path = propConfig[key as any];
      if (path != null) seen.set(key, { property: key, dependency: { kind: 'config', path } });
    }
    const propCond = readObjectMeta<{
      token: InjectionToken<unknown>;
      condition: () => boolean;
      fallback?: unknown | (() => unknown);
    }>(KEYS.PROPERTY_CONDITIONAL, target);
    for (const key of Reflect.ownKeys(propCond)) {
      const v = propCond[key as any];
      if (v != null) {
        seen.set(key, {
          property: key,
          dependency: { kind: 'conditional', token: v.token, condition: v.condition, fallback: v.fallback },
        });
      }
    }
  }
  plan.properties = [...seen.values()];

  return plan;
}

/**
 * Read a dot-separated path from a nested object.
 *
 * `getPath({ app: { port: 3000 } }, 'app.port') === 3000`
 *
 * Returns `defaultValue` (or undefined) if any path segment is missing.
 */
export function getPath(source: unknown, path: string, defaultValue?: unknown): unknown {
  if (!path) return source ?? defaultValue;
  const parts = path.split('.');
  let cur: any = source;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return defaultValue;
    cur = cur[part];
  }
  return cur === undefined ? defaultValue : cur;
}
