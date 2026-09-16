/**
 * Service Stub for Netron Framework
 *
 * @stable
 * @since 0.1.0
 */

import { isAsyncGenerator } from '@omnitron-dev/common';

// Use type-only imports from interfaces to break circular dependencies
import type { ILocalPeer, ServiceMetadata, ServiceMetadataExtended } from './interfaces/core-types.js';
import { Definition } from './definition.js';
import { StreamReference, NetronWritableStream } from './streams/index.js';
import {
  isNetronStream,
  isNetronService,
  isServiceReference,
  isServiceDefinition,
  isNetronStreamReference,
} from './predicates.js';
import { Interface } from './interface.js';
import { Errors } from '../errors/index.js';
import { getServiceMetadata } from './utils.js';

/**
 * ServiceStub is a proxy object for a service instance in the Netron system.
 * This class provides transparent interaction with remote services,
 * handling data transformation and managing the lifecycle of service definitions.
 *
 * @stable
 * @since 0.1.0
 *
 * @example
 * ```typescript
 * const stub = new ServiceStub(peer, myServiceInstance, metadata);
 * const result = await stub.call('methodName', [arg1, arg2]);
 * ```
 */
export class ServiceStub {
  /** Service definition containing metadata and interface specification */
  public definition: Definition;

  /** Transport names this service is exposed on (server-side only) */
  public transports?: string[];

  /**
   * SEC-5: per-remote-peer reference counts for DYNAMIC sub-service stubs.
   *
   * A nested service returned by a method call is deduped into ONE shared stub
   * (refService keys by instance) that may be referenced by many remote peers.
   * `unref_service` is an ungated core-task, so without per-peer accounting a
   * malicious peer A could call it to evict a shared dynamic stub that peer B
   * still uses (cross-peer eviction DoS). Each remote caller's references are
   * tracked here; a remote unref decrements only that caller's own count, and
   * the stub is evicted only when the total across all peers reaches zero. The
   * LOCAL authoritative release path (unexposeService / local releaseInterface,
   * which call unrefService with no peer id) bypasses this and force-removes —
   * the parent service is going away regardless of remote references.
   */
  private refsByPeer = new Map<string, number>();

  /** SEC-5: record that `peerId` holds a reference to this (dynamic) stub. */
  addRef(peerId: string): void {
    this.refsByPeer.set(peerId, (this.refsByPeer.get(peerId) ?? 0) + 1);
  }

  /**
   * SEC-5: release ONE reference held by `peerId`. Returns whether the peer
   * actually held a reference — `false` means over-decrement / never-referenced,
   * and the caller MUST NOT treat it as an eviction trigger.
   */
  releaseRef(peerId: string): boolean {
    const current = this.refsByPeer.get(peerId);
    if (!current) return false;
    if (current <= 1) this.refsByPeer.delete(peerId);
    else this.refsByPeer.set(peerId, current - 1);
    return true;
  }

  /** SEC-5: total outstanding references across all remote peers. */
  totalRefs(): number {
    let total = 0;
    for (const n of this.refsByPeer.values()) total += n;
    return total;
  }

  /**
   * Creates a new ServiceStub instance.
   *
   * @param {LocalPeer} peer - Local peer associated with this service
   * @param {any} instance - Service instance that this stub represents
   * @param {ServiceMetadata | Definition} metaOrDefinition - Service metadata or ready-made definition
   * @throws {Error} If unable to create service definition
   */
  constructor(
    public peer: ILocalPeer,
    public instance: any,
    metaOrDefinition: ServiceMetadata | Definition
  ) {
    if (isServiceDefinition(metaOrDefinition)) {
      this.definition = metaOrDefinition;
    } else {
      this.definition = new Definition(Definition.nextId(), peer.id, metaOrDefinition);
    }

    // Extract transports from metadata (but don't include in definition)
    const meta = isServiceDefinition(metaOrDefinition) ? metaOrDefinition.meta : metaOrDefinition;

    const extendedMeta = meta as ServiceMetadataExtended;
    if (extendedMeta.transports) {
      this.transports = extendedMeta.transports;
    }
  }

  /**
   * Sets the value of a service property.
   *
   * @param {string} prop - Property name to set
   * @param {any} value - Value to set
   * @returns {void}
   * @throws {Error} If property does not exist or is not writable
   */
  set(prop: string, value: any) {
    Reflect.set(this.instance, prop, this.processValue(value));
  }

  /**
   * Gets the value of a service property.
   *
   * @param {string} prop - Property name to get
   * @returns {any} Processed property value
   * @throws {Error} If property does not exist or is not readable
   */
  get(prop: string, callerPeer?: any) {
    return this.processResult(this.instance[prop], callerPeer);
  }

  /**
   * Calls a service method with the given arguments.
   *
   * @param {string} method - Method name to call
   * @param {any[]} args - Arguments to pass to the method
   * @returns {Promise<any>} Processed result of the method call
   * @throws {Error} If method does not exist or call fails with an error
   */
  async call(method: string, args: any[], callerPeer?: any) {
    const processedArgs = this.processArgs(args);
    let result = this.instance[method](...processedArgs);

    // Check if result is an AsyncGenerator before awaiting Promise
    if (isAsyncGenerator(result)) {
      // If callerPeer is null, this is a local call - return the generator directly
      if (callerPeer === null) {
        // For local calls within the same process, we can return the generator directly
        return result;
      }

      // We need a RemotePeer to create a stream
      if (!callerPeer) {
        // Try to get the first connected remote peer (not LocalPeer)
        const peers = Array.from(this.peer.netron.peers.values());
        callerPeer = peers.find((p: any) => p.id !== this.peer.id);
        if (!callerPeer) {
          // If no remote peer, but not explicitly local call, return the generator
          return result;
        }
      }

      // Create a writable stream and pipe the generator to it
      const stream = new NetronWritableStream({
        peer: callerPeer,
        isLive: true,
      });

      // Start piping in background (don't await)
      stream.pipeFrom(result).catch((error) => {
        this.peer.logger.error({ error }, 'Failed to pipe AsyncGenerator');
        stream.destroy(error);
      });

      // Return stream reference immediately
      return StreamReference.from(stream);
    }

    if (result instanceof Promise) {
      result = await result;
    }
    return this.processResult(result, callerPeer);
  }

  /**
   * Processes the result of service interaction.
   * Converts special data types (services, streams) into corresponding references.
   *
   * SECURITY (T#49): when the result is a nested service instance (the
   * called method returned ANOTHER service), we used to ref it
   * unconditionally and return its definition to the caller — leaking
   * the existence and shape of services the caller might not be
   * authorised to use. If the wire-level handler eventually rejects
   * `call(nestedDefId, …)` via T#34, the caller still saw the nested
   * service's metadata via `query_interface`-like exposure. Now we
   * consult `IAuthorizationManager.canAccessService` BEFORE creating
   * the ref; on denial we throw `Errors.forbidden` so the leaked
   * definition never reaches the wire.
   *
   * The check is skipped when no `callerPeer` is supplied (local /
   * trusted code paths) or when no authorization manager is
   * configured (backwards compat for un-authed netrons).
   *
   * @param {any} result - Result to process
   * @param {any} [callerPeer] - The remote peer that initiated the call,
   *   used to resolve auth context for the nested-service authz check.
   * @returns {any} Processed result
   * @private
   */
  private processResult(result: any, callerPeer?: any) {
    if (isNetronService(result) || result instanceof Interface) {
      this.enforceNestedServiceAccess(result, callerPeer);
      // SEC-5: attribute the dynamic-stub reference to the calling remote peer
      // (when there is one) so unref_service can refcount per-peer. Local/trusted
      // calls (no callerPeer) create an un-attributed stub torn down by the local
      // release path.
      return this.peer.refService(result, this.definition, callerPeer?.id);
    } else if (isNetronStream(result)) {
      return StreamReference.from(result);
    }
    return result;
  }

  /**
   * T#49 guard for nested-service leakage. See `processResult` for
   * rationale.
   */
  private enforceNestedServiceAccess(serviceOrIface: any, callerPeer: any): void {
    if (!callerPeer) return;
    const netron: any = (this.peer as any).netron;
    const authzManager: any = netron?.authorizationManager;
    if (!authzManager || typeof authzManager.canAccessService !== 'function') return;

    // Resolve the nested service's qualified name. Interface instances
    // carry their definition via `$def`; raw service instances have
    // metadata accessible via the same `getServiceMetadata` helper the
    // local-peer uses elsewhere — but we already know the result is a
    // service or Interface, so grabbing `meta` defensively is enough.
    const meta = serviceOrIface instanceof Interface
      ? serviceOrIface.$def?.meta
      : getServiceMetadata(serviceOrIface);
    if (!meta?.name) return; // shape unknown — fail open is consistent
    // with how the wire-level handler treats meta-less stubs (T#34).

    const qualifiedName = meta.version ? `${meta.name}@${meta.version}` : meta.name;
    const authContext = typeof callerPeer.getAuthContext === 'function' ? callerPeer.getAuthContext() : undefined;
    if (authzManager.canAccessService(qualifiedName, authContext)) return;

    throw Errors.forbidden(`Access denied to nested service ${qualifiedName}`, {
      service: qualifiedName,
      reason: 'nested_service_unauthorized',
    });
  }

  /**
   * Processes an array of arguments for method call.
   * Converts each argument according to its type.
   *
   * @param {any[]} args - Arguments to process
   * @returns {any[]} Processed arguments
   * @private
   */
  private processArgs(args: any[]) {
    return args.map((arg: any) => this.processValue(arg));
  }

  /**
   * Processes a single value.
   * Converts service and stream references into corresponding objects.
   *
   * @param {any} obj - Value to process
   * @returns {any} Processed value
   * @throws {Error} If peer not found for stream reference
   * @private
   */
  private processValue(obj: any) {
    if (isServiceReference(obj)) {
      return this.peer.queryInterfaceByDefId(obj.defId);
    } else if (isNetronStreamReference(obj)) {
      const peer = this.peer.netron.peers.get(obj.peerId);
      if (!peer) {
        throw new Error(`Peer not found for stream reference: ${obj.peerId}`);
      }
      return StreamReference.to(obj, peer as any);
    }
    return obj;
  }
}
