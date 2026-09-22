/**
 * `omnitron release build <project>` — a release from two commits.
 *
 * A deployment compiles whatever the deploying machine's disk holds. A
 * release is built from a named commit of BOTH repositories — the project,
 * and omni, whose packages are vendored into every artifact — in clean
 * clones, with every gate run against those clones, and the artifacts packed
 * from them. Nothing of the developer's working tree takes part: not their
 * uncommitted edits, not their `dist`, not their omni.
 *
 * On the master, by command: the two repositories live on different forges
 * (omni on GitHub, the project on a self-hosted GitLab), so neither forge's
 * CI can produce this object, and the master is the one machine that holds
 * both, the credentials, and the artifact builder the deployments already
 * use.
 *
 * The clones are made from the LOCAL repositories at the named commits. A
 * commit that exists on one laptop only is recorded as such (`onRemote`), so
 * a policy can refuse it for production without the builder refusing to
 * build it for a look.
 *
 * Layout: see `release/layout.ts`. Until the registry migration the project
 * links omni by relative paths, and the build root reproduces them so the
 * links land on the omni clone. Every `@omnitron-dev/*` link the install
 * produced is then checked to resolve INSIDE that clone — a build that
 * linked the developer's omni would claim a commit it did not use.
 *
 * What is kept: `~/.omnitron/releases/<id>/` — `manifest.json`, the
 * artifacts, the gate logs and one log per step. The clones (node_modules and
 * all, a gigabyte or two) are removed after a successful build unless
 * `--keep-source`; after a failed one they stay, to be looked at.
 */

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { log } from '@xec-sh/kit';

import { OMNITRON_HOME } from '../config/defaults.js';
import { ProjectRegistry } from '../project/registry.js';
import { assembleManifest, gateOutcomesFromGates, releaseId } from '../release/builder.js';
import { planBuildRoot, readLinkLayout, resolveCheckouts } from '../release/layout.js';
import type { GateOutcome, ReleaseSource } from '../release/manifest.js';

const exec = promisify(execFile);

export interface ReleaseBuildOptions {
  /** The project commit to build; default: the project checkout's HEAD. */
  projectCommit?: string;
  /** The omni commit to build; default: the omni checkout's HEAD. */
  omniCommit?: string;
  /** Keep the clones after a successful build. */
  keepSource?: boolean;
  /** Record every gate as not-run instead of running them — for a look, never for a stack. */
  skipGates?: boolean;
  /**
   * Build the static bundle this stack's gateway serves, with this stack's
   * `staticEnv`, into the release. A frontend bakes its environment in, so the
   * bundle belongs to a stack; a stack that serves one refuses a release
   * without it.
   */
  forStack?: string;
}

const MINUTE = 60_000;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

interface StepResult {
  code: number | null;
  stdout: string;
  timedOut: boolean;
}

/**
 * Run one step with its whole output in its own log; stdout is kept for the
 * caller. The step runs in its own process group, and a timeout ends the
 * group — `pnpm` and the gates spawn children, and ending only the parent
 * leaves them holding ports and files.
 */
function runStep(
  cmd: string,
  args: string[],
  opts: { cwd: string; logFile: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<StepResult> {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(opts.logFile, { flags: 'a' });
    out.write(`$ ${cmd} ${args.join(' ')}\n  (in ${opts.cwd})\n`);
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      out.write(d);
    });
    child.stderr.on('data', (d: Buffer) => out.write(d));
    child.on('error', (err) => out.write(`\n${err.message}\n`));
    child.on('close', (code) => {
      clearTimeout(timer);
      out.end(`\n(exit ${code === null ? 'by signal' : code}${timedOut ? `, timed out after ${Math.round(opts.timeoutMs / MINUTE)} min` : ''})\n`);
      resolve({ code, stdout, timedOut });
    });
  });
}

function tail(file: string, lines = 12): string {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
}

/** A step that must succeed for there to be a release at all. */
async function must(what: string, run: Promise<StepResult>, logFile: string): Promise<StepResult> {
  const r = await run;
  if (r.code !== 0) {
    throw new Error(
      `${what} failed (${r.timedOut ? 'timed out' : `exit ${r.code === null ? 'by signal' : r.code}`}) — ${logFile}\n${tail(logFile)}`,
    );
  }
  return r;
}

async function sourceOf(checkout: string, commit: string): Promise<ReleaseSource> {
  const repo = await git(['remote', 'get-url', 'origin'], checkout).catch(() => '(no origin)');
  let onRemote: boolean | null;
  try {
    const remotes = await git(['branch', '-r', '--contains', commit], checkout);
    const any = await git(['branch', '-r'], checkout);
    onRemote = any.length === 0 ? null : remotes.length > 0;
  } catch {
    onRemote = null;
  }
  return { repo, commit, onRemote };
}

/**
 * Every `@omnitron-dev/*` the install linked, and those that resolve outside
 * the omni clone. Zero links is its own refusal: an install that linked
 * nothing has built nothing against omni at all.
 */
function linkedOutside(projectDir: string, omniDir: string): { checked: number; outside: string[] } {
  const places = [projectDir];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(projectDir, group);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) places.push(path.join(dir, name));
  }
  let checked = 0;
  const outside: string[] = [];
  for (const place of places) {
    const scope = path.join(place, 'node_modules', '@omnitron-dev');
    if (!fs.existsSync(scope)) continue;
    for (const name of fs.readdirSync(scope)) {
      const link = path.join(scope, name);
      checked += 1;
      let real: string;
      try {
        real = fs.realpathSync(link);
      } catch {
        outside.push(`${path.relative(projectDir, link)} → (dangling)`);
        continue;
      }
      if (!real.startsWith(omniDir + path.sep)) outside.push(`${path.relative(projectDir, link)} → ${real}`);
    }
  }
  return { checked, outside };
}

function distBuiltAt(dir: string): string {
  try {
    return fs.statSync(path.join(dir, 'dist')).mtime.toISOString();
  } catch {
    return 'absent';
  }
}

/** The omnitron doing the packing, by version and the checkout it runs from. */
async function ownIdentity(): Promise<string> {
  const { findWorkspaceRoot, describeTree } = await import('../services/bundle-builder.js');
  const root = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
  if (!root) return 'unknown';
  let version = '0.0.0';
  try {
    version = (JSON.parse(fs.readFileSync(path.join(root, 'apps', 'omnitron', 'package.json'), 'utf8')) as { version: string })
      .version;
  } catch {
    // Named by its commit alone, then.
  }
  const tree = await describeTree(root);
  return `${version} from omni@${tree.commit.slice(0, 8) || 'nocommit'}${tree.dirty ? '+dirty' : ''}`;
}

type StaticsRecord = { stack: string; dir: string; files: number; bytes: number };

function countFiles(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countFiles(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  }
  return { files, bytes };
}

/**
 * The stack's gateway bundle, built in the clone exactly as a deployment
 * would build it from a tree — `pnpm run build` beside `staticDir`, with the
 * stack's `staticEnv` — and copied into the release. The stacks are resolved
 * as `ProjectService.resolveStacks` resolves them: `omnitron.stacks.json`,
 * then the config's own over it.
 */
async function buildStaticsFor(
  stack: string,
  projectDir: string,
  config: { stacks?: Record<string, unknown>; infrastructure?: unknown },
  releaseRoot: string,
  logFile: string,
): Promise<StaticsRecord | null> {
  let userStacks: Record<string, unknown> = {};
  try {
    userStacks = JSON.parse(fs.readFileSync(path.join(projectDir, 'omnitron.stacks.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    // No stacks file at this commit: the config's stacks are all there are.
  }
  const stackConfig = { ...userStacks, ...(config.stacks ?? {}) }[stack] as { infrastructure?: unknown } | undefined;
  if (!stackConfig) throw new Error(`There is no stack '${stack}' at this commit`);
  const { mergeInfrastructure } = await import('../services/project.service.js');
  const infra = mergeInfrastructure(config as never, stackConfig as never) as
    | {
        gateway?: { staticDir?: string; staticEnv?: Record<string, string> };
        services?: Record<string, { config?: { staticDir?: string; staticEnv?: Record<string, string> } }>;
      }
    | undefined;
  const gateway = infra?.services?.['gateway']?.config ?? infra?.gateway;
  const staticDir = gateway?.staticDir;
  if (!staticDir) return null;
  const abs = path.resolve(projectDir, staticDir);
  await must(
    'static bundle build',
    runStep('pnpm', ['run', 'build'], {
      cwd: path.dirname(abs),
      logFile,
      timeoutMs: 30 * MINUTE,
      env: { ...process.env, ...(gateway?.staticEnv ?? {}) },
    }),
    logFile,
  );
  if (!fs.existsSync(abs)) throw new Error(`The static bundle build finished and ${abs} does not exist — ${logFile}`);
  const target = path.join(releaseRoot, 'statics');
  fs.cpSync(abs, target, { recursive: true });
  return { stack, dir: staticDir, ...countFiles(target) };
}

export async function releaseBuildCommand(projectName: string, options: ReleaseBuildOptions = {}): Promise<void> {
  const started = Date.now();
  const project = ProjectRegistry.open().get(projectName);
  if (!project) {
    log.error(`No project '${projectName}' in the registry — \`omnitron project list\` names them.`);
    process.exitCode = 1;
    return;
  }

  let releaseRoot: string | null = null;
  try {
    const projectSha = await git(['rev-parse', '--verify', `${options.projectCommit ?? 'HEAD'}^{commit}`], project.path);
    // The lockfile AT THE COMMIT: the working tree's may differ, and it is the
    // commit's that the clone will install from.
    const layout = readLinkLayout(await git(['show', `${projectSha}:pnpm-lock.yaml`], project.path));
    if ('refusal' in layout) throw new Error(`Cannot lay out ${projectName} at ${projectSha.slice(0, 8)}: ${layout.refusal}`);
    const { projectReal: projectPath, omniPath } = resolveCheckouts(project.path, layout);
    if (!fs.existsSync(path.join(omniPath, '.git'))) {
      throw new Error(`The lockfile's links point at ${omniPath}, and there is no omni checkout there.`);
    }
    const omniSha = await git(['rev-parse', '--verify', `${options.omniCommit ?? 'HEAD'}^{commit}`], omniPath);

    const id = releaseId(projectName, new Date(), projectSha, omniSha);
    releaseRoot = path.join(OMNITRON_HOME, 'releases', id);
    const logs = path.join(releaseRoot, 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const plan = planBuildRoot(path.join(releaseRoot, 'src'), projectPath, layout);
    if ('refusal' in plan) throw new Error(plan.refusal);

    log.info(`Release ${id}`);
    log.info(`  ${projectName} ${projectSha.slice(0, 8)} · omni ${omniSha.slice(0, 8)} · ${releaseRoot}`);
    const phase = (what: string) => log.info(`  ${new Date().toISOString().slice(11, 19)}  ${what}`);

    // 1. Clean clones of the two commits.
    phase('cloning both commits');
    const cloneLog = path.join(logs, 'clone.log');
    for (const [from, sha, to] of [
      [projectPath, projectSha, plan.projectDir],
      [omniPath, omniSha, plan.omniDir],
    ] as const) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      await must('clone', runStep('git', ['clone', '--quiet', '--shared', '--no-checkout', from, to], { cwd: releaseRoot, logFile: cloneLog, timeoutMs: 10 * MINUTE }), cloneLog);
      await must('checkout', runStep('git', ['checkout', '--quiet', '--detach', sha], { cwd: to, logFile: cloneLog, timeoutMs: 10 * MINUTE }), cloneLog);
    }

    // 2. omni: install, and build what the project links (with what those depend on).
    phase('installing omni');
    const omniInstallLog = path.join(logs, 'install-omni.log');
    await must('omni install', runStep('pnpm', ['install', '--frozen-lockfile'], { cwd: plan.omniDir, logFile: omniInstallLog, timeoutMs: 30 * MINUTE }), omniInstallLog);
    const linked = layout.linkedDirs.map((dir) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(plan.omniDir, dir, 'package.json'), 'utf8')) as { name: string };
      return { dir, name: manifest.name };
    });
    phase(`building the ${linked.length} omni packages the project links`);
    const omniBuildLog = path.join(logs, 'build-omni.log');
    await must(
      'omni build',
      runStep('pnpm', ['-r', ...linked.flatMap((l) => ['--filter', `${l.name}...`]), 'run', 'build'], { cwd: plan.omniDir, logFile: omniBuildLog, timeoutMs: 60 * MINUTE }),
      omniBuildLog,
    );

    // 3. The project: install, then prove the links landed on the clone.
    phase(`installing ${projectName}`);
    const projectInstallLog = path.join(logs, 'install-project.log');
    await must('project install', runStep('pnpm', ['install', '--frozen-lockfile'], { cwd: plan.projectDir, logFile: projectInstallLog, timeoutMs: 30 * MINUTE }), projectInstallLog);
    const links = linkedOutside(plan.projectDir, plan.omniDir);
    if (links.checked === 0) throw new Error(`The install linked no @omnitron-dev package at all — nothing was built against omni. ${projectInstallLog}`);
    if (links.outside.length > 0) {
      throw new Error(
        `${links.outside.length} of ${links.checked} @omnitron-dev links resolve outside the omni clone, so this build would not be the commit it names:\n  ` +
          links.outside.slice(0, 5).join('\n  '),
      );
    }
    phase(`${links.checked} @omnitron-dev links resolve inside the omni clone`);

    // The project's own workspace packages, before anything compiles against
    // them. Five of daos's declare `dist/index.js` as their entry, and a clean
    // clone has no `dist`: measured on the first release, paysys failed to
    // build — `@daos/monero-rpc` unresolved, every callback an implicit `any` —
    // while the developer's tree built it from a `dist` left by some earlier
    // build. The `build` gate would have produced them as a side effect and
    // hidden the missing step; the builder does not lean on a gate's side
    // effects, and `--skip-gates` has none.
    if (fs.existsSync(path.join(plan.projectDir, 'packages'))) {
      phase(`building ${projectName}'s workspace packages`);
      const packagesLog = path.join(logs, 'build-project-packages.log');
      await must(
        'project packages build',
        runStep('pnpm', ['-r', '--filter', './packages/**', 'run', '--if-present', 'build'], {
          cwd: plan.projectDir,
          logFile: packagesLog,
          timeoutMs: 30 * MINUTE,
        }),
        packagesLog,
      );
    }

    // 4. The gates.
    let gates: GateOutcome[];
    if (options.skipGates) {
      gates = [{ name: 'gates', status: 'not-run', detail: 'skipped by --skip-gates' }];
      phase('gates skipped (--skip-gates) — recorded as not-run');
    } else if (!fs.existsSync(path.join(plan.projectDir, 'scripts', 'gates.mjs'))) {
      gates = [{ name: 'gates', status: 'not-run', detail: `scripts/gates.mjs does not exist at ${projectSha.slice(0, 8)}` }];
      phase('no gates script at this commit — recorded as not-run');
    } else {
      phase('running the gates');
      const gatesLog = path.join(logs, 'gates.log');
      const r = await runStep('node', ['scripts/gates.mjs', '--json', `--logs=${path.join(releaseRoot, 'gate-logs')}`], {
        cwd: plan.projectDir,
        logFile: gatesLog,
        timeoutMs: 120 * MINUTE,
      });
      gates = gateOutcomesFromGates(r.stdout, r.code);
      const passed = gates.filter((g) => g.status === 'passed').length;
      phase(`gates: ${passed} of ${gates.length} passed`);
    }

    // 5. The artifacts, by the same builder a deployment uses.
    phase('packing artifacts');
    const artifactsLog = path.join(logs, 'artifacts.log');
    const { loadEcosystemConfig } = await import('../config/loader.js');
    const { ArtifactBuilder } = await import('../project/artifact-builder.js');
    const config = await loadEcosystemConfig(plan.projectDir);
    const apps = config.apps.filter((a) => a.enabled !== false);
    const builder = new ArtifactBuilder(plan.projectDir, path.join(releaseRoot, 'artifacts'), {
      info: (msg) => fs.appendFileSync(artifactsLog, `${msg}\n`),
    });
    const packed = await builder.buildAll(apps);

    // 6. The static bundle, for the stack named — built in the clone.
    let statics: StaticsRecord | null = null;
    if (options.forStack) {
      phase(`building the static bundle for ${options.forStack}`);
      statics = await buildStaticsFor(options.forStack, plan.projectDir, config, releaseRoot, path.join(logs, 'statics.log'));
      phase(statics ? `static bundle: ${statics.files} files, ${(statics.bytes / 1024 / 1024).toFixed(1)} MB` : `${options.forStack} serves no static bundle`);
    }

    // 7. The manifest.
    const manifest = assembleManifest({
      id,
      project: await sourceOf(projectPath, projectSha),
      omni: await sourceOf(omniPath, omniSha),
      artifacts: packed.built,
      artifactFailures: packed.failed,
      gates,
      omnitron: await ownIdentity(),
      packages: linked.map((l) => ({ name: l.name, distBuiltAt: distBuiltAt(path.join(plan.omniDir, l.dir)) })),
      builtAt: new Date(),
      builtBy: `${os.userInfo().username}@${os.hostname()}`,
      ...(statics ? { statics } : {}),
    });
    const manifestPath = path.join(releaseRoot, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    if (!options.keepSource) fs.rmSync(path.join(releaseRoot, 'src'), { recursive: true, force: true });

    const failedGates = gates.filter((g) => g.status !== 'passed');
    const bytes = packed.built.reduce((sum, a) => sum + a.size, 0);
    log.success(`Release ${id} — ${Math.round((Date.now() - started) / MINUTE)} min`);
    log.info(`  gates: ${gates.length - failedGates.length} of ${gates.length} passed${failedGates.length ? ` — ${failedGates.map((g) => `${g.name} ${g.status}`).join(', ')}` : ''}`);
    log.info(`  artifacts: ${packed.built.length} (${(bytes / 1024 / 1024).toFixed(1)} MB)${packed.failed.length ? ` — did not build: ${packed.failed.map((f) => f.app).join(', ')}` : ''}`);
    if (manifest.project.onRemote === false || manifest.omni.onRemote === false) {
      log.warn(`  built from a commit no remote branch contains (${[manifest.project.onRemote === false ? projectName : null, manifest.omni.onRemote === false ? 'omni' : null].filter(Boolean).join(', ')}) — nobody else can rebuild it`);
    }
    log.info(`  manifest: ${manifestPath}`);
  } catch (err) {
    log.error(`Release build failed: ${(err as Error).message}`);
    if (releaseRoot) log.info(`  kept for inspection: ${releaseRoot}`);
    process.exitCode = 1;
  }
}
