/** An observation of a stopped physical copy. It confers no writer or activation authority. */
export interface InspectPhysicalRestore {
  project: string;
  stack: string;
  verifyRunId: string;
}

export interface PhysicalRestoreNode {
  nodeId: string;
  host: string;
  sshPort: number;
  daemonPort: number;
  registeredAt: string;
  fingerprint: string;
}

export interface PhysicalRestoreVolume {
  tag: string;
  volume: string;
  source: { device: string; inode: string };
  receiver: { device: string; inode: string };
  files: number;
  bytes: number;
  sha256: string;
  metadataSha256: string;
  sourceGeneration: string;
  receiverGeneration: string;
}

export interface PhysicalRestoreEvidence extends InspectPhysicalRestore {
  protocol: 1;
  kind: 'physical-service-data';
  seed: string;
  sourceStop: string;
  source: PhysicalRestoreNode;
  receiver: PhysicalRestoreNode;
  reviewDigest: string;
  definitionRevision: string;
  runCompletedAt: string;
  observedFrom: string;
  verifiedAt: string;
  proofDigest: string;
  volumes: PhysicalRestoreVolume[];
  postgres: Record<'postgres' | 'nominatim', { systemIdentifier: string; controlSha256: string }>;
  minio: { formatSha256: string };
}
