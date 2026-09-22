/**
 * Building a release, without a terminal.
 *
 * The work is the same whoever asked for it — the CLI, or the console through
 * the daemon — and it takes fifteen minutes, so it reports where it is rather
 * than going quiet. `commands/release.ts` turns these phases into lines;
 * `services/release.rpc-service.ts` keeps the last one per build and serves it
 * to the console, which is how an operator watching a browser tab sees the
 * same thing an operator watching a terminal does.
 *
 * What a release IS, and why it is built from clean clones of two commits, is
 * in `release/manifest.ts` and `release/layout.ts`.
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { OMNITRON_HOME } from '../config/defaults.js';
import { ProjectRegistry } from '../project/registry.js';
import { assembleManifest, gateOutcomesFromGates, releaseId } from './builder.js';
import { planBuildRoot, readLinkLayout, resolveCheckouts } from './layout.js';
import type { GateOutcome, ReleaseManifest, ReleaseSource } from './manifest.js';

const exec = promisify(execFile);
const MINUTE = 60_000;

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
  /**
   * Extra environment for every step.
   *
   * The gates need what the developer's shell had — daos's want
   * `TEST_DATABASE__PORT` — and a daemon started by launchd has none of it.
   * Only `[A-Z][A-Z0-9_]*` names are taken, and never one that changes what
   * an interpreter LOADS (`PATH`, `NODE_OPTIONS`, `LD_PRELOAD`…): a build
   * request is permission to build this project, not to run something else
   * as the daemon's user.
   */
  env?: Record<string, string>;
  /** Stop the build: the running step's process group is ended. */
  signal?: AbortSignal;
}

/** Environment names a build request may set, and those it may never. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENV_FORBIDDEN = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'SHELL',
  'IFS',
  'BASH_ENV',
  'ENV',
]);

/**
 * The caller's environment, checked.
 *
 * Refuses rather than dropping: a gate that needed `TEST_DATABASE__PORT` and
 * silently did not get it fails fifteen minutes later with a database error,
 * and the operator has no way to see that the variable never arrived.
 */
export function checkedEnv(env: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!ENV_NAME.test(key)) throw new Error(`'${key}' is not an environment variable name a build takes`);
    if (ENV_FORBIDDEN.has(key)) throw new Error(`A build request may not set ${key} — it changes what the steps themselves load`);
    if (typeof value !== 'string') throw new Error(`${key} must be a string, not ${typeof value}`);
    if (value.includes('\0')) throw new Error(`${key} holds a NUL byte`);
    out[key] = value;
  }
  return out;
}

/** Where a build has got to. One sentence, one number, and the time. */
export interface BuildPhase {
  readonly phase: string;
  readonly percent: number;
  readonly at: string;
  /** Known once the commits are resolved. */
  readonly releaseId?: string;
  /** Filled the moment the gates answer, so the console can show them running. */
  readonly gates?: readonly GateOutcome[];
}

export interface BuildOutcome {
  readonly id: string;
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest: ReleaseManifest;
  readonly durationMs: number;
}

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
  opts: { cwd: string; logFile: string; timeoutMs: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal },
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
    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    };
    opts.signal?.addEventListener('abort', stop, { once: true });
    child.on('error', (err) => out.write(`\n${err.message}\n`));
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', stop);
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
export async function ownIdentity(): Promise<string> {
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
  ctx: { env: NodeJS.ProcessEnv; signal?: AbortSignal | undefined },
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
      env: { ...ctx.env, ...(gateway?.staticEnv ?? {}) },
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    }),
    logFile,
  );
  if (!fs.existsSync(abs)) throw new Error(`The static bundle build finished and ${abs} does not exist — ${logFile}`);
  const target = path.join(releaseRoot, 'statics');
  fs.cpSync(abs, target, { recursive: true });
  return { stack, dir: staticDir, ...countFiles(target) };
}

/**
 * The PATH a build runs with.
 *
 * A daemon started by launchd inherits the SYSTEM path — six directories,
 * none of them pnpm's. pnpm installs itself into `PNPM_HOME`
 * (`~/Library/pnpm` on macOS, `~/.local/share/pnpm` under XDG), which is on
 * the developer's shell PATH and on nobody else's; corepack's shims sit
 * beside the running node. The daemon runs as the SAME USER, so the tool is
 * on the machine and only the PATH is narrower — measured on this master,
 * where the console's Build button was disabled with «pnpm is not on the
 * daemon's PATH» while `pnpm` worked in every terminal on it.
 *
 * Appended, never prepended: a `pnpm` the operator put on the PATH
 * deliberately still wins over one this function guessed at.
 */
export function buildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = os.homedir();
  const candidates = [
    env['PNPM_HOME'],
    path.join(home, 'Library', 'pnpm'),
    path.join(home, '.local', 'share', 'pnpm'),
    // corepack's shims live beside the node that is running this.
    path.dirname(process.execPath),
  ].filter((dir): dir is string => Boolean(dir));

  const already = new Set((env['PATH'] ?? '').split(path.delimiter).filter(Boolean));
  const added: string[] = [];
  for (const dir of candidates) {
    if (already.has(dir)) continue;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    already.add(dir);
    added.push(dir);
  }
  if (added.length === 0) return env;
  return { ...env, PATH: [...(env['PATH'] ?? '').split(path.delimiter).filter(Boolean), ...added].join(path.delimiter) };
}

/**
 * The programs a build spawns, found on the PATH it will use.
 *
 * A daemon started by launchd inherits a PATH of four directories, and
 * `pnpm` is in none of them. Without this the build would clone for a minute
 * and then die with `spawn pnpm ENOENT` at step two — true, and no help at
 * all about WHERE it looked. Checked before anything is cloned, named
 * together rather than one per attempt.
 */
export function missingTools(env: NodeJS.ProcessEnv, tools: readonly string[] = ['git', 'pnpm', 'node']): string[] {
  const dirs = (env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
  return tools.filter((tool) => {
    if (tool.includes(path.sep)) return !fs.existsSync(tool);
    return !dirs.some((dir) => {
      try {
        fs.accessSync(path.join(dir, tool), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  });
}

/**
 * Build a release, reporting each phase.
 *
 * Throws with the failing step's words and the log that holds the rest; the
 * build root is left on disk when it does, because a failed build is evidence.
 */
export async function runReleaseBuild(
  projectName: string,
  options: ReleaseBuildOptions,
  onPhase: (phase: BuildPhase) => void = () => {},
): Promise<BuildOutcome> {
  const started = Date.now();
  const extra = checkedEnv(options.env);
  const env = buildEnv({ ...process.env, ...extra });
  const signal = options.signal;
  const ctx = { env, ...(signal ? { signal } : {}) };
  const step = (cmd: string, args: string[], opts: { cwd: string; logFile: string; timeoutMs: number }) =>
    runStep(cmd, args, { ...opts, env, ...(signal ? { signal } : {}) });
  /** Between steps: a build that was stopped must not go on to the next one. */
  const stillWanted = () => {
    if (signal?.aborted) throw new Error('The build was stopped');
  };
  const project = ProjectRegistry.open().get(projectName);
  if (!project) {
    throw new Error(`No project '${projectName}' in the registry — \`omnitron project list\` names them.`);
  }
  const missing = missingTools(env);
  if (missing.length > 0) {
    throw new Error(
      `This omnitron cannot run a build: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not on its PATH ` +
        `(${(env['PATH'] ?? '(empty)').split(path.delimiter).slice(0, 8).join(', ')}). A daemon started by launchd has the ` +
        `system PATH, not a shell's — give the daemon the PATH it needs, or build from a terminal.`,
    );
  }

  let id: string | null = null;
  const say = (phase: string, percent: number, more: { gates?: readonly GateOutcome[] } = {}) =>
    onPhase({ phase, percent, at: new Date().toISOString(), ...(id ? { releaseId: id } : {}), ...more });

  say('reading both commits', 2);
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

  id = releaseId(projectName, new Date(), projectSha, omniSha);
  // Said BEFORE the directory exists, so that from the moment there is
  // anything on disk under this name, the service watching these phases can
  // name it — and `prune` can refuse to delete a build in progress.
  say('preparing the build root', 3);
  const releaseRoot = path.join(OMNITRON_HOME, 'releases', id);
  const logs = path.join(releaseRoot, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const plan = planBuildRoot(path.join(releaseRoot, 'src'), projectPath, layout);
  if ('refusal' in plan) throw new Error(plan.refusal);

  // Read at the START: the identity of the omnitron that packs this, not of
  // whatever this checkout has become by the time the build ends. The first
  // release recorded a commit made while it was running.
  const omnitron = await ownIdentity();

  // 1. Clean clones of the two commits.
  say('cloning both commits', 5);
  const cloneLog = path.join(logs, 'clone.log');
  for (const [from, sha, to] of [
    [projectPath, projectSha, plan.projectDir],
    [omniPath, omniSha, plan.omniDir],
  ] as const) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    await must('clone', step('git', ['clone', '--quiet', '--shared', '--no-checkout', from, to], { cwd: releaseRoot, logFile: cloneLog, timeoutMs: 10 * MINUTE }), cloneLog);
    await must('checkout', step('git', ['checkout', '--quiet', '--detach', sha], { cwd: to, logFile: cloneLog, timeoutMs: 10 * MINUTE }), cloneLog);
  }

  // 2. omni: install, and build what the project links (with what those depend on).
  stillWanted();
  say('installing omni', 12);
  const omniInstallLog = path.join(logs, 'install-omni.log');
  await must('omni install', step('pnpm', ['install', '--frozen-lockfile'], { cwd: plan.omniDir, logFile: omniInstallLog, timeoutMs: 30 * MINUTE }), omniInstallLog);
  const linked = layout.linkedDirs.map((dir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(plan.omniDir, dir, 'package.json'), 'utf8')) as { name: string };
    return { dir, name: manifest.name };
  });
  say(`building the ${linked.length} omni packages the project links`, 20);
  const omniBuildLog = path.join(logs, 'build-omni.log');
  await must(
    'omni build',
    step('pnpm', ['-r', ...linked.flatMap((l) => ['--filter', `${l.name}...`]), 'run', 'build'], { cwd: plan.omniDir, logFile: omniBuildLog, timeoutMs: 60 * MINUTE }),
    omniBuildLog,
  );

  // 3. The project: install, then prove the links landed on the clone.
  stillWanted();
  say(`installing ${projectName}`, 35);
  const projectInstallLog = path.join(logs, 'install-project.log');
  await must('project install', step('pnpm', ['install', '--frozen-lockfile'], { cwd: plan.projectDir, logFile: projectInstallLog, timeoutMs: 30 * MINUTE }), projectInstallLog);
  const links = linkedOutside(plan.projectDir, plan.omniDir);
  if (links.checked === 0) throw new Error(`The install linked no @omnitron-dev package at all — nothing was built against omni. ${projectInstallLog}`);
  if (links.outside.length > 0) {
    throw new Error(
      `${links.outside.length} of ${links.checked} @omnitron-dev links resolve outside the omni clone, so this build would not be the commit it names:\n  ` +
        links.outside.slice(0, 5).join('\n  '),
    );
  }
  say(`${links.checked} @omnitron-dev links resolve inside the omni clone`, 42);

  // The project's own workspace packages, before anything compiles against
  // them. Five of daos's declare `dist/index.js` as their entry, and a clean
  // clone has no `dist`: measured on the first release, paysys failed to
  // build — `@daos/monero-rpc` unresolved, every callback an implicit `any` —
  // while the developer's tree built it from a `dist` left by some earlier
  // build. The `build` gate would have produced them as a side effect and
  // hidden the missing step; the builder does not lean on a gate's side
  // effects, and `--skip-gates` has none.
  if (fs.existsSync(path.join(plan.projectDir, 'packages'))) {
    say(`building ${projectName}'s workspace packages`, 46);
    const packagesLog = path.join(logs, 'build-project-packages.log');
    await must(
      'project packages build',
      step('pnpm', ['-r', '--filter', './packages/**', 'run', '--if-present', 'build'], {
        cwd: plan.projectDir,
        logFile: packagesLog,
        timeoutMs: 30 * MINUTE,
      }),
      packagesLog,
    );
  }

  // 4. The gates.
  //
  // The machine is read on both sides of them. A gate suite's verdict on a
  // loaded machine is a fact about the machine: measured on this master,
  // three builds of ONE commit gave 21/21, 16/21 and 16/21, with a different
  // five red each time and `connect ETIMEDOUT` to containers that were up.
  // Recording the load turns the next hour in a diff into one glance.
  const loadAtGateStart = os.loadavg() as [number, number, number];
  let gates: GateOutcome[];
  if (options.skipGates) {
    gates = [{ name: 'gates', status: 'not-run', detail: 'skipped by --skip-gates' }];
    say('gates skipped — recorded as not-run', 80, { gates });
  } else if (!fs.existsSync(path.join(plan.projectDir, 'scripts', 'gates.mjs'))) {
    gates = [{ name: 'gates', status: 'not-run', detail: `scripts/gates.mjs does not exist at ${projectSha.slice(0, 8)}` }];
    say('no gates script at this commit — recorded as not-run', 80, { gates });
  } else {
    stillWanted();
    say('running the gates', 50);
    const gatesLog = path.join(logs, 'gates.log');
    const r = await step('node', ['scripts/gates.mjs', '--json', `--logs=${path.join(releaseRoot, 'gate-logs')}`], {
      cwd: plan.projectDir,
      logFile: gatesLog,
      timeoutMs: 120 * MINUTE,
    });
    gates = gateOutcomesFromGates(r.stdout, r.code);
    const passed = gates.filter((g) => g.status === 'passed').length;
    say(`gates: ${passed} of ${gates.length} passed`, 80, { gates });
  }

  const machine = {
    cpus: os.cpus().length,
    loadAtGateStart,
    loadAtGateEnd: os.loadavg() as [number, number, number],
  };
  if (machine.loadAtGateEnd[1] > machine.cpus) {
    say(
      `the machine was loaded while the gates ran: ${machine.loadAtGateStart.map((n) => n.toFixed(1)).join(' / ')} → ` +
        `${machine.loadAtGateEnd.map((n) => n.toFixed(1)).join(' / ')} on ${machine.cpus} cores`,
      82,
      { gates },
    );
  }

  // 5. The artifacts, by the same builder a deployment uses.
  stillWanted();
  say('packing artifacts', 84, { gates });
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
    say(`building the static bundle for ${options.forStack}`, 92, { gates });
    statics = await buildStaticsFor(options.forStack, plan.projectDir, config, releaseRoot, path.join(logs, 'statics.log'), ctx);
    say(
      statics
        ? `static bundle: ${statics.files} files, ${(statics.bytes / 1024 / 1024).toFixed(1)} MB`
        : `${options.forStack} serves no static bundle`,
      96,
      { gates },
    );
  }

  // 6b. The project's own scripts, at this commit.
  //
  // An attestation runs the release's probes against a stack that is
  // CARRYING the release, on the node. Taking them from the master's working
  // tree would measure one commit's system with another commit's probes; a
  // release that carries them is self-sufficient, and the copy is a
  // megabyte against sixty.
  const scriptsDir = path.join(plan.projectDir, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    fs.cpSync(scriptsDir, path.join(releaseRoot, 'scripts'), { recursive: true });
  }

  // 7. The manifest.
  const manifest = assembleManifest({
    id,
    project: await sourceOf(projectPath, projectSha),
    omni: await sourceOf(omniPath, omniSha),
    artifacts: packed.built,
    artifactFailures: packed.failed,
    gates,
    omnitron,
    packages: linked.map((l) => ({ name: l.name, distBuiltAt: distBuiltAt(path.join(plan.omniDir, l.dir)) })),
    machine,
    builtAt: new Date(),
    builtBy: `${os.userInfo().username}@${os.hostname()}`,
    ...(statics ? { statics } : {}),
  });
  const manifestPath = path.join(releaseRoot, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (!options.keepSource) fs.rmSync(path.join(releaseRoot, 'src'), { recursive: true, force: true });

  const passed = gates.filter((g) => g.status === 'passed').length;
  say(`release ${id} — ${passed} of ${gates.length} gates passed, ${packed.built.length} artifact(s)`, 100, { gates });
  return { id, root: releaseRoot, manifestPath, manifest, durationMs: Date.now() - started };
}
