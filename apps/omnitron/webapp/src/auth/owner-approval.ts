import { useEffect } from 'react';
import type { IOmnitronOwnerRecoveryService, OwnerRecoveryReview } from '@omnitron-dev/omnitron/dto/services';
import { daemonClient } from 'src/netron/client';

const service = 'OmnitronOwnerRecovery@1.0.0';
export const ownerApproval: IOmnitronOwnerRecoveryService = {
  enrollmentChallenge: input => daemonClient.invoke('daemon', service, 'enrollmentChallenge', [input], { skipAuth: true }),
  enroll: input => daemonClient.invoke('daemon', service, 'enroll', [input], { skipAuth: true }),
  getChallenge: input => daemonClient.invoke('daemon', service, 'getChallenge', [input], { skipAuth: true }),
  approve: input => daemonClient.invoke('daemon', service, 'approve', [input], { skipAuth: true }),
};

export const popupProtocol = 'omnitron.owner-recovery.v1';

export function usePrivateOwnerPage() {
  useEffect(() => {
    const policy = document.createElement('meta');
    policy.name = 'referrer';
    policy.content = 'no-referrer';
    document.head.append(policy);
    const hide = (event: PageTransitionEvent) => { if (event.persisted) document.documentElement.style.visibility = 'hidden'; };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => {
      policy.remove();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
}

export function receiveReview(event: MessageEvent, opener: Window, operationId: string): string | null {
  const data = event.data;
  if (event.source !== opener || event.origin === 'null' || data?.protocol !== popupProtocol ||
      data.operationId !== operationId || data.type !== 'review') return null;
  return typeof data.reviewToken === 'string' && data.reviewToken.length > 0 && data.reviewToken.length <= 512
    ? data.reviewToken : null;
}

function bytes(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

function base64url(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Only public registration data leaves the authenticator for offline commissioning. */
export async function createCommissioningCredential() {
  const userId = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: location.hostname, name: 'Omnitron' },
      user: { id: userId, name: 'installation-owner', displayName: 'Installation owner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { userVerification: 'required' },
      attestation: 'none',
    },
  });
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAttestationResponse) ||
      credential.response.getPublicKeyAlgorithm() !== -7) throw new Error('An ES256 credential is required');
  const key = credential.response.getPublicKey();
  if (!key) throw new Error('Public key export is unavailable');
  const encoded = btoa(String.fromCharCode(...new Uint8Array(key))).match(/.{1,64}/g)!.join('\n');
  return { id: base64url(credential.rawId), userHandle: base64url(userId.buffer),
    publicKey: `-----BEGIN PUBLIC KEY-----\n${encoded}\n-----END PUBLIC KEY-----` };
}

export async function verifyOwner(publicKey: OwnerRecoveryReview['publicKey'], signal: AbortSignal) {
  const result = await navigator.credentials.get({
    signal,
    publicKey: {
      ...publicKey,
      userVerification: 'required',
      challenge: bytes(publicKey.challenge),
      allowCredentials: publicKey.allowCredentials.map(key => ({ type: 'public-key' as const, id: bytes(key.id) })),
    },
  });
  if (!(result instanceof PublicKeyCredential) || !(result.response instanceof AuthenticatorAssertionResponse)) {
    throw new Error('An authenticator assertion is required');
  }
  const { clientDataJSON, authenticatorData, signature, userHandle } = result.response;
  return {
    id: result.id,
    rawId: base64url(result.rawId),
    type: 'public-key' as const,
    response: {
      clientDataJSON: base64url(clientDataJSON),
      authenticatorData: base64url(authenticatorData),
      signature: base64url(signature),
      ...(userHandle && { userHandle: base64url(userHandle) }),
    },
  };
}
