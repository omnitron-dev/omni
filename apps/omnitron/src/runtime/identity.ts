export type ArtifactIdentity = Readonly<{
  releaseId: string;
  manifestSha256: string;
  artifactSha256: string;
  producerApp: string;
  projectCommit: string;
  frameworkCommit: string;
}>;
export class RuntimeOriginVerificationError extends Error {
  readonly code = 'RUNTIME_ORIGIN_INVALID';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeOriginVerificationError';
  }
}
export function assertArtifactIdentity(value: unknown): asserts value is ArtifactIdentity {
  const v = value as ArtifactIdentity | null;
  const id = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(s) && !s.includes('..');
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    !id(v.releaseId) ||
    !id(v.producerApp) ||
    ![v.manifestSha256, v.artifactSha256].every((s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)) ||
    ![v.projectCommit, v.frameworkCommit].every((s) => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s)) ||
    Object.keys(v).sort().join(',') !==
      'artifactSha256,frameworkCommit,manifestSha256,producerApp,projectCommit,releaseId'
  )
    throw new RuntimeOriginVerificationError('Invalid immutable artifact identity');
}

export function parseArtifactIdentity(value: unknown): ArtifactIdentity {
  assertArtifactIdentity(value);
  return Object.freeze({
    releaseId: value.releaseId,
    manifestSha256: value.manifestSha256,
    artifactSha256: value.artifactSha256,
    producerApp: value.producerApp,
    projectCommit: value.projectCommit,
    frameworkCommit: value.frameworkCommit,
  });
}
