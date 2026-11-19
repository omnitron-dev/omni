import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { OMNITRON_HOME } from '../config/defaults.js';
import type { ProjectCreationReview, ProjectStarterNeeds } from '../shared/dto/project.js';
import { writeStarter } from './starter.js';
import { planStarter } from './starter-plan.js';

/** The instance owner controls the workspace. No client supplies a directory or file contents. */
function workspaceReview(name: string, needs: ProjectStarterNeeds) {
  const plan = planStarter(name, needs);
  const home = fs.realpathSync(OMNITRON_HOME);
  const root = path.join(home, 'workspaces');
  const target = path.join(root, name);
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
  const homeStat = fs.lstatSync(home);
  const uid = process.getuid?.();
  if (uid === undefined) throw Error('Project creation requires verifiable filesystem ownership');
  for (let parent = path.dirname(home); ; parent = path.dirname(parent)) {
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || (stat.uid !== uid && stat.uid !== 0) || ((stat.mode & 0o022) && !(stat.mode & 0o1000)))
      throw Error('Project creation requires an instance below trusted ancestor directories');
    if (parent === path.dirname(parent)) break;
  }
  for (const stat of [homeStat, rootStat]) {
    if (stat && (!stat.isDirectory() || (stat.mode & 0o022) || stat.uid !== uid))
      throw Error('The instance and workspace must be directories owned by the daemon and writable only by their owner');
  }
  if (rootStat && fs.lstatSync(target, { throwIfNoEntry: false })) throw Error('The project directory already exists: ' + target);
  const preview = { name, path: target, ...plan };
  const digest = createHash('sha256').update(JSON.stringify({
    ...preview, home: [homeStat.dev, homeStat.ino], root: rootStat ? [rootStat.dev, rootStat.ino] : null,
  })).digest('hex');
  return { root, rootStat, review: { ...preview, digest } };
}

export function reviewProjectCreation(name: string, needs: ProjectStarterNeeds): ProjectCreationReview {
  return workspaceReview(name, needs).review;
}

export function createProjectDirectory(name: string, needs: ProjectStarterNeeds, digest: string) {
  const { root, rootStat, review } = workspaceReview(name, needs);
  if (review.digest !== digest) throw Error('Project creation review changed. Review the current starter before creating it');
  if (!rootStat) fs.mkdirSync(root, { mode: 0o700 });
  // An existing directory, file or dangling link is never adopted or replaced.
  fs.mkdirSync(review.path, { mode: 0o700 });
  const directory = fs.lstatSync(review.path);
  let rollbackFiles: (() => void) | undefined;
  const rollback = () => {
    const stat = fs.lstatSync(review.path, { throwIfNoEntry: false });
    if (stat?.dev !== directory.dev || stat.ino !== directory.ino) return;
    rollbackFiles?.();
    try { fs.rmdirSync(review.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error; }
  };
  try { rollbackFiles = writeStarter(review.path, review.files); }
  catch (error) { rollback(); throw error; }
  return { path: review.path, rollback };
}
