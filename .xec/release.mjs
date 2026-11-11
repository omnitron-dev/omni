#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isCancel, password, text } from '@xec-sh/kit';
import {
  acquireReleaseLock, assertCleanReleaseTree, assertReleaseHead, commitReleaseVersion,
  createGithubRelease, discoverReleasePackages, ensureReleaseTag, loadPreparedRelease,
  planRelease, prepareReleaseArtifacts, publishPreparedRelease, registryAddress,
  pushReleaseRefs, registryArtifactMatches, releaseCommand, ReleaseCommandError, releaseNotes, verifyRemoteReleaseTag,
} from '@xec-sh/ops/release';
import semver from 'semver';
import policy from './release-policy.mjs';
import { qualifyRelease, verifyReleaseQualification } from './qualification.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const repository = policy.repository;
const usage = `xec release [VERSION] [OPERATION]

  --list      Show all public workspaces in dependency order
  --dry-run   Print the release plan (default)
  --prepare   Commit public versions, build and verify archives, create local tag
  --qualify   Verify independent builds, CI and native transition/rollback on every configured Node
  --status    Recheck the selected qualification and prepared archives without changing them
  --finish    Verify qualification, check npm access, push the tag and publish the sealed archives
  --push      Push the prepared commit and its single annotated tag atomically
  --publish   Publish sealed archives from the exact remotely tagged commit
  --resume    Resume --publish using the same archives
  --github    Create the GitHub release after confirming every package in npm

  --previous COMMIT  Exact previous backend for transition and rollback qualification
  --push-source      Push the exact source branch for CI before qualification (no tags)
  --registry URL     Select an HTTPS registry or a loopback test registry

Use --prepare --previous COMMIT --push-source for the complete preparation pipeline.
Publication never runs the build or tests again.

Archives and receipts live under .release-artifacts/.`;

function publicationError(error) {
  if (!(error?.cause instanceof ReleaseCommandError)) return error;
  let detail;
  try { detail = JSON.parse(error.cause.stdout).error; } catch { return error; }
  if (typeof detail?.code !== 'string' || !/^E[A-Z0-9_]+$/.test(detail.code)) return error;
  return new Error(`${error.message}\nnpm ${detail.code}`, { cause: error });
}

export async function runRelease(args, root = defaultRoot) {
  const { values, positionals } = parseArgs({
    args,
    options: { registry: { type: 'string' }, previous: { type: 'string' }, ...Object.fromEntries(['help', 'list', 'list-packages', 'dry-run', 'prepare', 'skip-publish',
      'finish', 'push', 'publish', 'resume', 'github', 'qualify', 'status', 'push-source'].map(key => [key, { type: 'boolean' }])) },
    allowPositionals: true,
  });
  if (values.help) { console.log(usage); return; }
  const selected = [
    [values.list || values['list-packages'], 'list'], [values['dry-run'], 'plan'],
    [values.prepare || values['skip-publish'], 'prepare'], [values.push, 'push'],
    [values.qualify, 'qualify'], [values.status, 'status'], [values.finish, 'finish'], [values.publish || values.resume, 'publish'], [values.github, 'github'],
  ].filter(([enabled]) => enabled).map(([, command]) => command);
  if (selected.length > 1 || positionals.length > 1) throw new Error(usage);
  const operation = selected[0] ?? 'plan';
  if (values['push-source'] && !['prepare', 'qualify'].includes(operation)) throw Error('--push-source requires --prepare or --qualify');
  if (values.previous && !['prepare', 'qualify'].includes(operation)) throw Error('--previous requires --prepare or --qualify');
  if (values['push-source'] && !values.previous) throw Error('--push-source requires --previous');
  if (operation === 'list') {
    const packages = await discoverReleasePackages(root);
    for (const pkg of packages) console.log(`${pkg.name}@${pkg.version}  ${pkg.path}`);
    console.log(`${packages.length} public packages`);
    return;
  }

  let version = positionals[0];
  if (!version) {
    const cli = JSON.parse(await readFile(path.join(root, 'apps/omnitron/package.json'), 'utf8'));
    if (operation === 'plan') version = semver.inc(cli.version, 'patch');
    else if (process.stdin.isTTY) {
      const answer = await text({ message: 'Release version', placeholder: semver.inc(cli.version, 'patch') });
      if (isCancel(answer)) return;
      version = answer;
    }
  }
  if (!version || semver.valid(version) !== version) throw new Error('Supply an exact semantic version.\n' + usage);
  const plan = await planRelease(root, version);
  console.log(`${plan.tag} · ${plan.npmTag} · ${plan.packages.length} packages · ${plan.commit}`);
  if (plan.blockers.length) throw new Error(plan.blockers.join('\n'));
  if (operation === 'plan') return;

  const unlock = await acquireReleaseLock(root);
  try {
    await assertCleanReleaseTree(root);
    const qualify = async () => {
      if (values['push-source']) {
        if (await releaseCommand(root, 'git', ['branch', '--show-current']) !== policy.branch) throw Error('Push the reviewed release branch: ' + policy.branch);
        const commit = await releaseCommand(root, 'git', ['rev-parse', 'HEAD']);
        await releaseCommand(root, 'git', ['-c', 'push.followTags=false', 'push', 'origin', commit + ':refs/heads/' + policy.branch]);
      }
      return qualifyRelease(root, version, { previous: values.previous });
    };
    if (operation === 'qualify') {
      console.log(JSON.stringify(await qualify(), null, 2));
      return;
    }
    if (operation === 'prepare') {
      if (await releaseCommand(root, 'git', ['branch', '--show-current']) !== policy.branch) {
        throw new Error('Prepare from a clean ' + policy.branch + ' branch');
      }
      await commitReleaseVersion(root, version);
      const commit = await releaseCommand(root, 'git', ['rev-parse', 'HEAD']);
      const prepared = await prepareReleaseArtifacts(root, version, {
        build: { executable: process.execPath, args: [fileURLToPath(new URL('../bin/xec', import.meta.resolve('@xec-sh/cli'))), 'run', 'scripts/build-release.mjs', root, commit] },
        // This step includes both independent npm consumer installs and clean CI replays.
        // A cold dependency cache can exceed Xec's default ten-minute command deadline.
        run: (cwd, executable, args, options) => releaseCommand(cwd, executable, args,
          args.includes('scripts/build-release.mjs')
            ? { ...options, timeoutMs: 45 * 60_000 } : options),
        // Xec calls this after the clean build and immediately before sealing each archive.
        async preparePackage({ workspace, pkg }) {
          const file = path.join(workspace, pkg.path, 'package.json');
          const metadata = JSON.parse(await readFile(file, 'utf8'));
          await writeFile(file, JSON.stringify({ ...metadata, gitHead: commit }, null, 2) + '\n');
        },
        progress: console.log,
      });
      const notes = await releaseNotes(root, version, repository);
      await writeFile(path.join(root, '.release-artifacts', version, prepared.commit, 'NOTES.md'), notes);
      await ensureReleaseTag(root, version);
      if (values.previous) await qualify();
      console.log(`Prepared ${prepared.artifacts.length} archives. ${values.previous ? "Qualification verified; publish with xec release " + version + " --finish." : "Complete qualification with xec release " + version + " --qualify --previous <commit>."}`);
      return;
    }

    const prepared = await loadPreparedRelease(root, version);
    if (!await assertReleaseHead(root, version)) throw new Error('Missing local release tag; finish --prepare first');
    const qualification = await verifyReleaseQualification(root, version);
    if (operation === 'status') { console.log(JSON.stringify({ prepared, qualification }, null, 2)); return; }
    if (operation === 'push') { await pushReleaseRefs(root, version); return; }

    const registry = registryAddress(typeof values.registry === 'string' ? values.registry : undefined);
    if (operation !== 'finish') await verifyRemoteReleaseTag(root, version, true);
    const finishGithub = async () => {
      console.log(await createGithubRelease(root, version, repository, await releaseNotes(root, version, repository)));
    };
    if (operation === 'github') {
      for (const artifact of prepared.artifacts) {
        if (!await registryArtifactMatches(root, artifact, { registry })) throw new Error(`npm has not confirmed ${artifact.name}`);
      }
      await finishGithub();
      return;
    }
    await publishPreparedRelease(root, version, {
      registry, progress: console.log,
      beforeUpload: operation === 'finish' ? async () => {
        await pushReleaseRefs(root, version);
        await verifyRemoteReleaseTag(root, version, true);
      } : undefined,
      otp: async () => {
        if (!process.stdin.isTTY) throw new Error('An npm one-time password requires an interactive terminal');
        const answer = await password({ message: 'npm one-time password' });
        if (isCancel(answer)) throw new Error('Publication interrupted. Preserve the archives and use --resume');
        return answer;
      },
    }).catch(error => { throw publicationError(error); });
    if (operation === 'finish') await finishGithub();
    else console.log(`Verified ${prepared.artifacts.length} npm packages. Use --github to publish the release notes.`);
  } finally { await unlock(); }
}

