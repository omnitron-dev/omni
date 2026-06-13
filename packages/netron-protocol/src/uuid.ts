/**
 * UUIDv7 generation (RFC 9562) — time-ordered, monotonic-within-a-millisecond.
 *
 * Used to mint opaque service-Definition identifiers. Uses the Web Crypto API
 * (`globalThis.crypto.getRandomValues`), which is available in both browsers and
 * Node ≥ 18, so the SAME generator runs on both ends of a connection. (titan
 * previously used a `node:crypto`-pooled variant and netron-browser a
 * `crypto.getRandomValues` variant of this identical algorithm — they are
 * unified here. Definition IDs are opaque and independently minted per side, so
 * the randomness source has no wire-format impact.)
 */

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let _lastMs = 0;
let _seq = 0;

function randomSeq(): number {
  const buf = new Uint8Array(2);
  globalThis.crypto.getRandomValues(buf);
  return ((buf[0]! << 8) | buf[1]!) & 0xfff;
}

export function uuid(): string {
  const now = Date.now();

  if (now > _lastMs) {
    _lastMs = now;
    _seq = randomSeq();
  } else {
    _seq++;
    if (_seq > 0xfff) {
      _lastMs++;
      _seq = randomSeq();
    }
  }

  const ms = _lastMs;
  const msHi = Math.trunc(ms / 0x100000000);
  const msLo = ms >>> 0;

  const rand = new Uint8Array(8);
  globalThis.crypto.getRandomValues(rand);

  return (
    HEX[(msHi >>> 8) & 0xff]! +
    HEX[msHi & 0xff]! +
    HEX[(msLo >>> 24) & 0xff]! +
    HEX[(msLo >>> 16) & 0xff]! +
    '-' +
    HEX[(msLo >>> 8) & 0xff]! +
    HEX[msLo & 0xff]! +
    '-' +
    HEX[0x70 | ((_seq >>> 8) & 0x0f)]! +
    HEX[_seq & 0xff]! +
    '-' +
    HEX[0x80 | (rand[0]! & 0x3f)]! +
    HEX[rand[1]!]! +
    '-' +
    HEX[rand[2]!]! +
    HEX[rand[3]!]! +
    HEX[rand[4]!]! +
    HEX[rand[5]!]! +
    HEX[rand[6]!]! +
    HEX[rand[7]!]!
  );
}
