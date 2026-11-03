import { Definition } from './definition.js';
import type { ServiceStub } from './service-stub.js';
import { readMethodMetadata } from './auth/method-authorization.js';
import { transportSurfaceAllowed, transportAllowed } from './transport-policy.js';
import { publicServiceMetadata } from './service-metadata.js';

/** The same service/member intersection is used for dispatch and discovery. */
export function memberTransportAllowed(
  instance: object | null | undefined,
  servicePolicy: readonly string[] | undefined,
  member: string,
  transport: string | undefined,
  publishedPolicy?: unknown,
): boolean {
  return transportSurfaceAllowed(servicePolicy, publishedPolicy, transport, readMethodMetadata(instance, member)?.transports);
}

/** A per-connection view. Never alter the authoritative definition or its registry. */
export function projectTransportDefinition(stub: Pick<ServiceStub, 'definition' | 'instance' | 'transports'>,
  transport: string | undefined): Definition | null {
  if (!transportAllowed(stub.transports, transport)) return null;
  const original = stub.definition;
  const published = publicServiceMetadata(original.meta);
  const allowed = (name: string) => memberTransportAllowed(stub.instance, stub.transports, name, transport,
    (original.meta.methods?.[name] ?? original.meta.properties?.[name])?.transports);
  const projected = new Definition(original.id, original.peerId, {
    ...published,
    methods: Object.fromEntries(Object.entries(published.methods ?? {}).filter(([name]) => allowed(name))),
    properties: Object.fromEntries(Object.entries(published.properties ?? {}).filter(([name]) => allowed(name))),
  });
  projected.parentId = original.parentId;
  return projected;
}
