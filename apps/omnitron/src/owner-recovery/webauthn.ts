import { createHash, createPublicKey, verify } from 'node:crypto';

export interface OwnerCredential {
  id: string;
  publicKey: string;
  userHandle: string;
}

function bytes(value: unknown, limit: number): Buffer {
  if (typeof value !== 'string' || !value.length || value.length > limit * 2 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('Invalid assertion');
  const data = Buffer.from(value, 'base64url');
  if (data.byteLength > limit || data.toString('base64url') !== value) throw Error('Invalid assertion');
  return data;
}

export function verifyOwnerCredential(credential: OwnerCredential): void {
  bytes(credential.id, 1023);
  bytes(credential.userHandle, 64);
  if (typeof credential.publicKey !== 'string' || !/^-----BEGIN PUBLIC KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(credential.publicKey)) {
    throw Error('Expected only the public credential in SPKI PEM format');
  }
  const key = createPublicKey(credential.publicKey);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw Error('Owner recovery requires a pinned ES256 WebAuthn public key');
  }
}

export function ownerAssertionOptions(credential: OwnerCredential, origin: string, challenge: string, timeout: number) {
  return {
    challenge, rpId: new URL(origin).hostname, timeout, userVerification: 'required' as const,
    allowCredentials: [{ type: 'public-key' as const, id: credential.id }],
  };
}

/** Narrow ES256 assertion profile. The commissioning signature pins the credential independently. */
export function verifyOwnerAssertion(
  assertion: unknown, credential: OwnerCredential, origin: string, challenge: string, previousCounter: number,
): number {
  const input = assertion as { id?: unknown; rawId?: unknown; type?: unknown;
    response?: { signature?: unknown; clientDataJSON?: unknown; authenticatorData?: unknown; userHandle?: unknown } } | null;
  if (!input || input.type !== 'public-key' || input.rawId !== credential.id || input.id !== credential.id || !input.response) throw Error('Invalid assertion');
  const { response } = input;
  const clientData = bytes(response.clientDataJSON, 4096);
  const client = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clientData));
  if (client.type !== 'webauthn.get' || client.origin !== origin || client.challenge !== challenge ||
      (client.crossOrigin !== undefined && client.crossOrigin !== false) || client.topOrigin !== undefined ||
      (response.userHandle != null && response.userHandle !== credential.userHandle)) throw Error('Invalid assertion');
  const authenticator = bytes(response.authenticatorData, 37);
  const rpHash = createHash('sha256').update(new URL(origin).hostname).digest();
  const flags = authenticator[32] ?? 0;
  if (authenticator.length !== 37 || !authenticator.subarray(0, 32).equals(rpHash) || (flags & 5) !== 5 ||
      (flags & 0xe2) !== 0 || ((flags & 16) !== 0 && (flags & 8) === 0)) throw Error('Invalid assertion');
  const counter = authenticator.readUInt32BE(33);
  if ((previousCounter !== 0 || counter !== 0) && counter <= previousCounter) throw Error('Invalid assertion');
  const signed = Buffer.concat([authenticator, createHash('sha256').update(clientData).digest()]);
  if (!verify('sha256', signed, credential.publicKey, bytes(response.signature, 72))) throw Error('Invalid assertion');
  return counter;
}
