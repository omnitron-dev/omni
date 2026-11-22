import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backendUpgradeCommand } from '../../src/commands/backend.js';

const api = vi.hoisted(() => ({ replace: vi.fn(), error: vi.fn(), connect: vi.fn() }));
vi.mock('../../src/daemon/backend-upgrade.js', () => ({ replaceBackend: api.replace }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: api.connect }));
vi.mock('../../src/commands/output.js', () => ({ emitJson: () => true, emitError: api.error, emitStep: vi.fn() }));
vi.mock('../../src/daemon/runtime-installation.js', () => ({
  RuntimeInstallation: { openReadOnly: async () => null }, assertOrdinaryRecoveryAllowed: async () => undefined,
}));

const admission = { targetRuntimeHash: 'a'.repeat(64), backend: {
  pid: 123, controller: { ownerId: 'owner', controllerId: 'controller', epoch: 1 },
}, configuration: { registryDigest: 'b'.repeat(64), sha256: 'c'.repeat(64) }, backups: [] };
const good = { ok: true, data: { checked: true, admission } };
const previousExit = process.exitCode;
let directory: string;
let file: string;
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-review-'));
  file = path.join(directory, 'review.json');
  api.connect.mockReturnValue({ status: async () => ({ execution: { handoffSupported: true } }),
    service: async () => ({ status: async () => ({}) }), disconnect: async () => undefined });
  api.replace.mockResolvedValue({ checked: true });
});
afterEach(async () => {
  process.exitCode = previousExit;
  await fs.rm(directory, { recursive: true, force: true });
});

it('hands the saved check to the native supervisor with its original cancellation scope', async () => {
  await fs.writeFile(file, JSON.stringify(good), { mode: 0o600 });
  await backendUpgradeCommand(directory, { fromCheck: file });
  expect(api.error).not.toHaveBeenCalled();
  expect(api.replace).toHaveBeenCalledWith(directory, expect.objectContaining({ checkOnly: false, admission }));
});

it.each([
  { ok: false, data: good.data },
  { ok: true, data: { ...good.data, checked: false } },
  { ok: true, data: { ...good.data, admission: { ...admission, targetRuntimeHash: undefined } } },
  { ok: true, data: { ...good.data, admission: { ...admission, backups: [{}] } } },
])('rejects an incomplete check before contacting the running controller', async invalid => {
  await fs.writeFile(file, JSON.stringify(invalid), { mode: 0o600 });
  await backendUpgradeCommand(directory, { fromCheck: file });
  expect(api.error).toHaveBeenCalledOnce();
  expect(api.connect).not.toHaveBeenCalled();
  expect(api.replace).not.toHaveBeenCalled();
});
