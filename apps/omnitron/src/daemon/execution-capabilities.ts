/** Semantic owner contracts, independent of the private RPC envelope version. */
export type ExecutionCapabilities = Readonly<Record<string, number>>;

// This contract includes durable stack intent, admission fences and confirmed
// process exit. Merely having an RPC with the same name is not sufficient.
export const OWNER_CAPABILITIES: ExecutionCapabilities = Object.freeze({ stackControl: 1, installedStackStart: 1, processPoolResize: 1, applicationTopology: 1 });
export const REQUIRED_OWNER_CAPABILITIES: ExecutionCapabilities = Object.freeze({ stackControl: 1 });

export function readExecutionCapabilities(value: unknown): ExecutionCapabilities {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid execution capability declaration');
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(([key, version]) =>
    !/^[a-zA-Z][a-zA-Z0-9.-]{0,63}$/.test(key) || !Number.isSafeInteger(version) || version < 1)) {
    throw new Error('Invalid execution capability declaration');
  }
  return Object.fromEntries(entries) as ExecutionCapabilities;
}

export function assertExecutionCapabilities(available: unknown, required: ExecutionCapabilities): void {
  const actual = readExecutionCapabilities(available);
  const missing = Object.entries(required).filter(([key, version]) => actual[key] !== version);
  if (missing.length) throw new Error(
    `Execution owner lacks required capabilities: ${missing.map(([key, version]) => `${key}@${version}`).join(', ')}. ` +
    'Backend activation is refused before transferring control. Prepare an owner transition and rollback; replacing the owner requires an application restart.',
  );
}
