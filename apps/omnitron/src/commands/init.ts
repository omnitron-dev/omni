/**
 * omnitron init — Scaffold omnitron.config.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { log, confirm } from '@xec-sh/kit';

import { writeStarter } from '../project/starter.js';
import { planStarter, starterConfig } from '../project/starter-plan.js';
import { reviewExistingProject, writeExistingProject } from '../project/existing-project.js';
import { defaultProjectStarterNeeds, type ProjectStarterNeeds } from '../shared/dto/project.js';
import { emitJson, isJsonMode } from './output.js';

export async function initCommand(options: { force?: boolean; existing?: boolean; check?: boolean; name?: string; automation?: boolean;
  database?: ProjectStarterNeeds['persistence']; service?: ProjectStarterNeeds['service'] } = {}): Promise<void> {
  if (options.existing) {
    if (options.force || options.name !== undefined || options.automation || options.database !== undefined || options.service !== undefined)
      throw Error('Use --existing with optional --check. Starter and overwrite options apply to new projects.');
    const review = reviewExistingProject(process.cwd());
    if (!options.check) writeExistingProject(review);
    if (emitJson({ status: options.check ? 'preview' : 'created', ...review })) return;
    for (const item of review.declarations) log.info(`${item.framework} · ${item.manifest} · ${item.section} · ${item.dependency}`);
    if (!review.declarations.length) log.info('No Xec or Kysera package was declared in the selected manifests.');
    log.info(review.config.path + '\n' + review.config.content);
    if (!options.check) log.success('Configuration created. Register this directory with omnitron project add NAME PATH.');
    return;
  }
  if (options.check) throw Error('--check requires --existing');
  const basename = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const name = options.name ?? (/^[a-z]/.test(basename) ? basename : 'project-' + basename).slice(0, 63);
  const needs = { automation: options.automation ?? defaultProjectStarterNeeds.automation,
    persistence: options.database ?? defaultProjectStarterNeeds.persistence, service: options.service ?? defaultProjectStarterNeeds.service };
  const plan = planStarter(name, needs);
  const configPath = path.resolve(process.cwd(), starterConfig);
  const exists = fs.lstatSync(configPath, { throwIfNoEntry: false });
  if (exists?.isSymbolicLink()) {
    throw new Error('omnitron.config.ts is a symbolic link. Select its project directory explicitly.');
  }
  if (exists && !options.force) {
    if (!process.stdin.isTTY || isJsonMode()) {
      throw new Error('omnitron.config.ts already exists. Use --force to overwrite it.');
    }
    const overwrite = await confirm({
      message: 'omnitron.config.ts already exists. Overwrite?',
      initialValue: false,
      input: process.stdin,
      output: process.stderr,
    });
    if (overwrite !== true) {
      if (typeof overwrite === 'symbol') process.exitCode = 130;
      log.info('Configuration preserved');
      return;
    }
  }

  // A dependency-free Node starter can also be added to an established package.
  // Keep its package metadata and documentation under the project owner's control.
  const files = plan.files.filter(file => Object.keys(plan.manifest.dependencies).length || !['package.json', 'README.md'].includes(file.path) ||
    !fs.lstatSync(path.join(process.cwd(), file.path), { throwIfNoEntry: false }));
  writeStarter(process.cwd(), files, !!exists);
  if (emitJson({ status: 'created', directory: process.cwd(), manifest: plan.manifest, files: files.map(file => file.path) })) return;
  log.success('Initialized ' + name + '. ' + plan.effects.slice(1).join(' '));
  if (files.length !== plan.files.length) log.info('Existing project metadata was preserved. Run the worker with node omnitron-worker.js.');
}
