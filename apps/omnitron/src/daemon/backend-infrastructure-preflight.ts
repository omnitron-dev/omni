import { createHash } from 'node:crypto';
import type { BackendHandoffState } from './backend-handoff-types.js';
import type { InfrastructureHandoffState } from '../infrastructure/infrastructure.service.js';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

interface InfrastructurePreflightInput {
  protocol: 1;
  infrastructure: InfrastructureHandoffState[];
}

/** Only the infrastructure projection crosses this read-only child boundary. */
export function backendInfrastructureInput(state: Pick<BackendHandoffState, 'infrastructure' | 'projects'>): string {
  if (!state || !Array.isArray(state.projects?.infrastructure) ||
      (state.infrastructure !== null && (typeof state.infrastructure !== 'object' || Array.isArray(state.infrastructure))))
    throw new Error('Backend infrastructure snapshot is incomplete');
  const input: InfrastructurePreflightInput = { protocol: 1, infrastructure: [
    ...(state.infrastructure ? [state.infrastructure] : []), ...state.projects.infrastructure.map(entry => entry.infrastructure),
  ] };
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) throw new Error('Backend infrastructure preflight exceeds 16 MiB');
  return serialized;
}

export function backendInfrastructureDigest(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Candidate code inspects native resources; it never constructs or starts a daemon. */
export async function validateBackendInfrastructureInput(input: Buffer): Promise<{ protocol: 1; digest: string }> {
  if (input.byteLength > MAX_INPUT_BYTES) throw new Error('Backend infrastructure preflight exceeds 16 MiB');
  let parsed: InfrastructurePreflightInput;
  try { parsed = JSON.parse(input.toString('utf8')) as InfrastructurePreflightInput; }
  catch { throw new Error('Invalid backend infrastructure preflight JSON'); }
  if (!parsed || parsed.protocol !== 1 || !Array.isArray(parsed.infrastructure) ||
      Object.keys(parsed).length !== 2) throw new Error('Invalid backend infrastructure preflight protocol');
  const { InfrastructureService } = await import('../infrastructure/infrastructure.service.js');
  for (const snapshot of parsed.infrastructure) await InfrastructureService.validateHandoff(snapshot);
  return { protocol: 1, digest: backendInfrastructureDigest(input) };
}

export async function readBackendInfrastructureInput(input: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    bytes += chunk.byteLength;
    if (bytes > MAX_INPUT_BYTES) throw new Error('Backend infrastructure preflight exceeds 16 MiB');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, bytes);
}
