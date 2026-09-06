/**
 * `omnitron doctor` reading every registered project's config.
 *
 * The daemon used to answer a broken config and an absent one the same way —
 * an empty app list — so it started, reported healthy, and supervised
 * nothing. That path now refuses to start, which is a better failure and a
 * later one: the first news is a restart that does not come back. This check
 * moves it earlier, and reads the files rather than asking the daemon, since
 * a daemon holding a config it loaded hours ago cannot tell you the file has
 * been edited since.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Findings, checkProjectConfigs } from '../../src/commands/doctor.js';

const VALID = `module.exports = {
  apps: [{ name: 'api', script: './api.js' }],
};`;

let root: string;
const projects: Array<{ name: string; path: string }> = [];

vi.mock('../../src/project/registry.js', () => ({
  ProjectRegistry: { open: () => ({ list: () => projects }) },
}));

function project(name: string, config: string | null): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (config !== null) fs.writeFileSync(path.join(dir, 'omnitron.config.js'), config);
  projects.push({ name, path: dir });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-doctor-cfg-'));
  projects.length = 0;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('checkProjectConfigs', () => {
  it('says nothing about a project whose config loads', async () => {
    project('good', VALID);
    const findings = new Findings();

    await checkProjectConfigs(findings);

    expect(findings.all()).toEqual([]);
    expect(findings.skipped()).toEqual([]);
  });

  it.each([
    ['a file that does not parse', 'module.exports = { apps: ['],
    ['an app with no name', "module.exports = { apps: [{ script: './a.js' }] };"],
    ['an app with neither bootstrap nor script', "module.exports = { apps: [{ name: 'a' }] };"],
  ])('reports %s', async (_label, source) => {
    project('broken', source);
    const findings = new Findings();

    await checkProjectConfigs(findings);

    const [finding] = findings.all();
    expect(finding?.id).toBe('project.config-unloadable');
    expect(finding?.severity).toBe('error');
    expect(finding?.title).toContain('broken');
  });

  it('names the project, so an operator knows which one to open', async () => {
    project('alpha', VALID);
    project('beta', 'module.exports = { apps: [');
    project('gamma', VALID);
    const findings = new Findings();

    await checkProjectConfigs(findings);

    expect(findings.all()).toHaveLength(1);
    expect(findings.all()[0]!.title).toContain('beta');
  });

  it('treats a directory with no config as unexamined, not as healthy', async () => {
    // `getConfigPath` names only `omnitron.config.ts`, and a project may use
    // another accepted name or none at all — the daemon falls back to its
    // working directory. So absence here is a gap in coverage, not a finding.
    project('empty', null);
    const findings = new Findings();

    await checkProjectConfigs(findings);

    expect(findings.all()).toEqual([]);
    expect(findings.skipped().map((s) => s.id)).toEqual(['project.config-unloadable']);
  });

  it('records a skip when no projects are registered', async () => {
    const findings = new Findings();

    await checkProjectConfigs(findings);

    expect(findings.skipped()[0]!.reason).toContain('no projects');
  });
});
