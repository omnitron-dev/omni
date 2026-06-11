/**
 * Eager, synchronous registration of the StreamReference msgpack type (107).
 *
 * WIRE-13: registration previously happened lazily via an async dynamic
 * `import('../streams/stream-reference.js')` (`ensureStreamReferenceRegistered`),
 * kicked off fire-and-forget from a `serializer.encode` monkey-patch. So the
 * FIRST StreamReference ever encoded raced the registration and went out as a
 * plain object (wrong wire format), only self-correcting on later encodes.
 *
 * This module sits ABOVE the serializer↔stream import cycle
 * (serializer → stream-reference → readable/writable-stream → packet → serializer):
 * it is imported for side-effect by `netron.ts`, so by the time its body runs
 * both `serializer` and `StreamReference` are fully resolved and it can register
 * the codec SYNCHRONOUSLY, before any StreamReference is encoded. No dynamic
 * import, no monkey-patch, no race.
 */

import type { SmartBuffer } from '@omnitron-dev/msgpack/smart-buffer';

import { serializer } from '../packet/serializer.js';
import { StreamReference } from './stream-reference.js';

/** msgpack custom-type id for StreamReference (kept in lockstep with netron-browser). */
export const STREAM_REFERENCE_TYPE_ID = 107;

let registered = false;

/**
 * Idempotently register the StreamReference codec (type 107) with the netron
 * packet serializer. Safe to call multiple times.
 */
export function registerStreamReference(): void {
  if (registered) return;
  registered = true;

  serializer.register(
    STREAM_REFERENCE_TYPE_ID,
    StreamReference,
    // Encode: stream identity, type, liveness, owning peer.
    (obj: any, buf: SmartBuffer) => {
      serializer.encode(obj.streamId.toString(), buf);
      buf.writeUInt8(obj.type === 'writable' ? 1 : 0);
      buf.writeUInt8(obj.isLive ? 1 : 0);
      serializer.encode(obj.peerId, buf);
    },
    // Decode: reconstruct the StreamReference.
    (buf: SmartBuffer) => {
      const streamId = Number(serializer.decode(buf));
      const streamType = buf.readUInt8() === 1 ? 'writable' : 'readable';
      const isLive = buf.readUInt8() === 1;
      const peerId = serializer.decode(buf);
      return new StreamReference(streamId, streamType, isLive, peerId);
    }
  );
}

// Register eagerly at module load (side-effect import from netron.ts).
registerStreamReference();
