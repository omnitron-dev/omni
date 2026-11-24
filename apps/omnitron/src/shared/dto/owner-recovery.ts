/** Browser-facing methods. The private review token arrives from the enrolled application. */
export interface OwnerRecoveryReview {
  applicationOrigin: string;
  applicationLabel: string;
  accountLabel: string;
  installationLabel: string;
  publicKey: {
    challenge: string;
    rpId: string;
    allowCredentials: Array<{ id: string; type: 'public-key' }>;
    userVerification: 'required';
    timeout?: number;
  };
}

interface ReviewRequest {
  operationId: string;
  reviewToken: string;
}

export interface OwnerPairingProof {
  payload: {
    installationId: string;
    ownerId: string;
    ownerGeneration: number;
    recipientId: string;
    pairingGeneration: number;
    subjectId: string;
    applicationOrigin: string;
    nonce: string;
    issuedAt: number;
    expiresAt: number;
  };
  signature: string;
}

export interface IOmnitronOwnerRecoveryService {
  enrollmentChallenge(input: { enrollmentToken: string }): Promise<OwnerRecoveryReview & { pairingChallenge: OwnerPairingProof }>;
  enroll(input: {
    enrollmentToken: string;
    pairingProof: OwnerPairingProof;
    assertion: OwnerRecoveryAssertion;
  }): Promise<{ recoveryCodes: string[] }>;
  getChallenge(input: ReviewRequest): Promise<OwnerRecoveryReview>;
  approve(input: ReviewRequest & {
    recoveryCode: string;
    assertion: OwnerRecoveryAssertion;
  }): Promise<{ applicationOrigin: string; continuation: string }>;
}

export interface OwnerRecoveryAssertion {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle?: string | null;
  };
}
