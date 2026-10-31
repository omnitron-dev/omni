import fs from 'node:fs';
import path from 'node:path';

/** Package identity, not the directory/project name, identifies the control plane. */
export function isControlPlaneWorkspace(directory: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { name?: string };
    return manifest.name === '@omnitron-dev/omnitron';
  } catch {
    return false;
  }
}
