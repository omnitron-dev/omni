/** Admission for the exact interpreter copied by the offline runtime freezer. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const refusal = detail => Error(`Runtime freezing requires a standalone Node producer: ${detail}. Select a standalone Node distribution explicitly; external libraries and loader environment are not copied.`);

export function assertStandaloneNodeConfiguration(variables, platform = process.platform) {
  if (platform !== 'darwin' && platform !== 'linux') throw refusal(`unsupported producer platform ${platform}`);
  if (!variables || variables.node_shared !== false || variables.node_target_type !== 'executable') {
    throw refusal('node_shared must be false and node_target_type must be executable');
  }
  for (const [name, value] of Object.entries(variables)) {
    if (!name.startsWith('node_shared')) continue;
    // Node 26 exposes this list in addition to its node_shared_gtest flag.
    if (name === 'node_shared_gtest_libraries' && Array.isArray(value) && value.length === 0) continue;
    if (value !== false) throw refusal(`${name} is not disabled`);
  }
  if (variables.node_builtin_modules_path || variables.icu_default_data) {
    throw refusal('external built-in modules or ICU data are configured');
  }
  const intl = variables.v8_enable_i18n_support;
  if (intl !== false && intl !== 0 && !((intl === true || intl === 1) && variables.icu_gyp_path === 'tools/icu/icu-generic.gyp')) {
    throw refusal('ICU must be bundled or internationalization disabled');
  }
}

export function assertSystemSharedObjects(objects, executable, platform) {
  if (!Array.isArray(objects) || objects.length === 0) throw refusal('the clean startup did not report loaded native objects');
  const prefixes = platform === 'darwin' ? ['/usr/lib/', '/System/Library/'] :
    platform === 'linux' ? ['/lib/', '/lib64/', '/usr/lib/', '/usr/lib64/'] : [];
  for (const file of objects) {
    if (file === executable) continue;
    if (platform === 'linux' && (file === 'linux-vdso.so.1' || file === 'linux-gate.so.1')) continue;
    if (typeof file !== 'string' || !path.posix.isAbsolute(file) || file !== path.posix.normalize(file) ||
        !prefixes.some(prefix => file.startsWith(prefix))) {
      throw refusal(`clean startup loaded a non-system native object: ${String(file)}`);
    }
  }
}

const probe = `
  require('node:crypto').createHash('sha256').update('runtime-probe').digest('hex');
  require('node:zlib').gzipSync('runtime-probe');
  if (process.config.variables.v8_enable_i18n_support) new Intl.DateTimeFormat('en').format(0);
  console.log(JSON.stringify({ version: process.version, platform: process.platform, arch: process.arch,
    executable: require('node:fs').realpathSync(process.execPath), cwd: process.cwd(),
    environment: Object.keys(process.env), variables: process.config.variables,
    sharedObjects: process.report.getReport().sharedObjects }));
`;

export async function verifyStandaloneNodeCopy(executable, expected) {
  const copied = await fs.realpath(executable);
  if (await hash(copied) !== expected.sha256) throw refusal('copied Node bytes differ from the selected producer');
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-node-startup-'));
  try {
    let result;
    try {
      // This is the copied executable, never PATH resolution or another Node.
      // Empty env also excludes NODE_OPTIONS/NODE_PATH and all LD_/DYLD_ inputs.
      const { stdout } = await run(copied, ['--input-type=commonjs', '-e', probe], {
        cwd, env: {}, timeout: 15_000, maxBuffer: 1024 * 1024,
      });
      result = JSON.parse(stdout);
    } catch (error) {
      throw refusal(`copied Node could not start independently (${String(error.message).slice(0, 2000)})`);
    }
    // CoreFoundation can add its own text-encoding metadata after an empty-env
    // spawn. No user environment, including non-loader keys, may survive.
    const unexpectedEnvironment = !Array.isArray(result.environment) || result.environment.some(name =>
      expected.platform !== 'darwin' || name !== '__CF_USER_TEXT_ENCODING');
    if (result.version !== expected.version || result.platform !== expected.platform || result.arch !== expected.arch ||
        result.executable !== copied || result.cwd !== await fs.realpath(cwd) || unexpectedEnvironment) {
      throw refusal('copied Node startup identity or isolation differs from the selected producer');
    }
    assertStandaloneNodeConfiguration(result.variables, result.platform);
    assertSystemSharedObjects(result.sharedObjects, copied, result.platform);
    if (await hash(copied) !== expected.sha256) throw refusal('copied Node changed during its startup check');
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

export async function copyStandaloneNode(destination) {
  assertStandaloneNodeConfiguration(process.config.variables);
  const expected = { sha256: await hash(process.execPath), version: process.version, platform: process.platform, arch: process.arch };
  await fs.copyFile(process.execPath, destination, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
  await fs.chmod(destination, 0o500);
  await verifyStandaloneNodeCopy(destination, expected);
}
