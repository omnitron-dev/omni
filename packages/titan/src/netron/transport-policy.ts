import { Errors } from '../errors/index.js';

/** Transport implementation identity; registry aliases are not additional grants. */
export function canonicalTransportName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || (/\s/u.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) {
    throw Errors.badRequest('Transport name must be a non-empty identifier without whitespace');
  }
  return value === 'ws' ? 'websocket' : value;
}

/** Omitted means unrestricted; an explicit empty list publishes no remote surface. */
export function normalizeTransportPolicy(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw Errors.badRequest('Transport restriction must be an array of names');
  return [...new Set(value.map(canonicalTransportName))];
}

export function transportAllowed(policy: readonly string[] | undefined, transport: string | undefined): boolean {
  return policy === undefined || (transport !== undefined && policy.includes(canonicalTransportName(transport)));
}

export function transportSurfaceAllowed(servicePolicy: readonly string[] | undefined,
  memberPolicy: unknown, transport: string | undefined, localMemberPolicy?: unknown): boolean {
  return transportAllowed(servicePolicy, transport) &&
    transportAllowed(normalizeTransportPolicy(memberPolicy), transport) &&
    transportAllowed(normalizeTransportPolicy(localMemberPolicy), transport);
}
