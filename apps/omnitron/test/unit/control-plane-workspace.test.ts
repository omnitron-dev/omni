import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { isControlPlaneWorkspace } from '../../src/project/workspace-kind.js';
import { ProjectRegistry } from '../../src/project/registry.js';

it('distinguishes the control plane package from an application merely named omnitron', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-kind-'));
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: '@omnitron-dev/omnitron' }));
    expect(isControlPlaneWorkspace(directory)).toBe(true);
    expect(ProjectRegistry.prototype.autoDetect.call({} as ProjectRegistry, directory)).toBeNull();
    expect(() => ProjectRegistry.prototype.add.call({} as ProjectRegistry, 'control', directory)).toThrow(
      'system workspace'
    );
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'omnitron' }));
    expect(isControlPlaneWorkspace(directory)).toBe(false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
