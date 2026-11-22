import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configFilesHash } from '../../apps/omnitron/src/infrastructure/config-payload.ts';

const sha = data => createHash('sha256').update(data).digest('hex');
const fail = message => { throw Error(message); };
const safeVolume = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,179}$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function witness(file) {
  const normalized = path.resolve(file);
  if (fs.realpathSync(normalized) !== normalized) fail('A physical source path traverses a link');
  const obj = fs.lstatSync(normalized, { bigint: true });
  if (!obj.isFile() && !obj.isDirectory()) fail('A physical source is not a regular file or directory');
  if (obj.ino <= 0n || obj.birthtimeNs <= 0n) fail('Stable filesystem birth and inode identities are unavailable');
  return { path: normalized, device: String(obj.dev), inode: String(obj.ino), birthNs: String(obj.birthtimeNs),
    directory: obj.isDirectory(), uid: Number(obj.uid), gid: Number(obj.gid), mode: Number(obj.mode & 0o7777n) };
}

function checkPublicFiles(row) {
  if (!row.spec.configDigest) return [];
  if (!Array.isArray(row.publicFiles) || !row.publicFiles.length || row.publicFiles.length > 256)
    fail('The configured service needs the public file list from its accepted release');
  const allowed = row.spec.volumes.filter(v => v.source.startsWith('/') && v.readonly === true)
    .map(v => path.resolve(v.source));
  const root = row.publicRoot;
  if (typeof root !== 'string' || path.resolve(root) !== root || fs.realpathSync(root) !== root) fail('Invalid public configuration root');
  const known = new Set(row.publicFiles.map(file => file.path));
  const content = [];
  const visited = new Set();
  const visit = file => {
    if (visited.has(file)) return;
    visited.add(file);
    const st = fs.lstatSync(file);
    if (st.isDirectory()) {
      if (![...known].some(approved => approved.startsWith(file + '/'))) fail('Unreviewed public configuration directory');
      for (const name of fs.readdirSync(file)) visit(path.join(file, name));
    } else if (!st.isFile() || !known.has(file)) fail('Unreviewed object in a public configuration mount');
  };
  for (const mounted of allowed.filter(m => m === root || m.startsWith(root + '/'))) visit(mounted);
  const seen = new Set();
  const verified = row.publicFiles.map(file => {
    if (!file || typeof file.path !== 'string' || path.resolve(file.path) !== file.path || seen.has(file.path) ||
        !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 ||
        !file.path.startsWith(root + '/') || !visited.has(file.path) ||
        !allowed.some(mount => file.path === mount || file.path.startsWith(mount + '/')))
      fail('A public release file is outside the reviewed read-only mounts');
    seen.add(file.path);
    if (fs.realpathSync(file.path) !== file.path) fail('A public release file traverses a link');
    const fd = fs.openSync(file.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const before = fs.fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.size > 16_777_216n || Number(before.mode & 0o777n) !== file.mode)
        fail('The public release file type, size or mode differs');
      const bytes = fs.readFileSync(fd);
      const measured = sha(bytes);
      content.push({ path: path.relative(root, file.path), mode: file.mode.toString(8), content: bytes.toString('latin1') });
      const after = fs.fstatSync(fd, { bigint: true });
      if (before.ctimeNs !== after.ctimeNs || measured !== file.sha256) fail('A public release file changed');
      return { path: file.path, sha256: measured, mode: file.mode };
    } finally { fs.closeSync(fd); }
  });
  if (configFilesHash(content) !== row.spec.configDigest) fail('The public files do not reproduce the original creation digest');
  return verified;
}

/** Inspect only declared physical roots and explicitly listed public config files. Named volumes are never traversed. */
export function physicalWitness(declaration, docker, volumeRoot) {
  if (!path.isAbsolute(volumeRoot) || fs.realpathSync(volumeRoot) !== volumeRoot) fail('Select the native local volume directory');
  const volumes = {}, binds = {}, networks = {}, files = {};
  for (const row of declaration.services) {
    const { spec, imageId } = row;
    if (docker(['image', 'ls', '--quiet', '--no-trunc', '--', spec.image]).trim() !== imageId)
      fail('A retained image has moved');
    if (spec.network && !Object.hasOwn(networks, spec.network)) {
      if (!safeVolume.test(spec.network)) fail('Invalid retained network name');
      const id = docker(['network', 'ls', '--quiet', '--no-trunc', '--filter', 'name=^' + spec.network.replaceAll('.', '\\.') + '$']).trim();
      if (!/^[0-9a-f]{64}$/.test(id)) fail('A reviewed Docker network is missing');
      networks[spec.network] = id;
    }
    for (const mount of spec.volumes) {
      if (!path.isAbsolute(mount.target) || mount.target !== path.normalize(mount.target)) fail('Invalid mount target');
      if (path.isAbsolute(mount.source)) {
        const source = path.resolve(mount.source);
        if (!Object.hasOwn(binds, source)) binds[source] = witness(source);
      } else {
        if (!safeVolume.test(mount.source)) fail('Invalid native volume name');
        if (Object.hasOwn(volumes, mount.source)) continue;
        const name = mount.source;
        if (docker(['volume', 'ls', '--quiet', '--filter', 'driver=local', '--filter', 'name=^' + name.replaceAll('.', '\\.') + '$']).trim() !== name)
          fail('A reviewed local Docker volume is absent');
        volumes[name] = witness(path.join(volumeRoot, name, '_data'));
        if (!volumes[name].directory) fail('A named volume path is not a directory');
      }
    }
    files[spec.name] = checkPublicFiles(row);
  }
  return { networks, volumes, binds, files };
}

export function verifyPhysical(expected, ...args) {
  if (!same(expected, physicalWitness(...args))) fail('The retained network, images, physical objects or public release files changed');
}

/** Creation schema one omits enforced memory and shared-memory settings. Save the corresponding native controls separately. */
const controlsFormat = '[{{json .Id}},{{json .Image}},{{json .Config.Image}},{{json .HostConfig.NetworkMode}},{{json .HostConfig.RestartPolicy.Name}},{{json .HostConfig.ShmSize}},{{json .HostConfig.Memory}},{{json .HostConfig.MemoryReservation}},{{json .HostConfig.NanoCpus}},{{json .HostConfig.CpuPeriod}},{{json .HostConfig.CpuQuota}},{{json .HostConfig.Privileged}},{{json .HostConfig.CapAdd}},{{json .HostConfig.CapDrop}},{{json .HostConfig.ReadonlyRootfs}},{{json .HostConfig.SecurityOpt}},{{json .HostConfig.PortBindings}},{{json .HostConfig.ExtraHosts}}]';

export function nativeControls(docker, row, object, expectedNetwork, restart) {
  const probe = JSON.parse(docker(['container', 'inspect', '--format', controlsFormat, '--', object]));
  if (!Array.isArray(probe) || probe.length !== 18 || probe[0] !== object || probe[1] !== row.imageId ||
      probe[2] !== row.spec.image || probe[3] !== (expectedNetwork || 'default') || probe[4] !== restart ||
      probe[11] !== false || (probe[12]?.length ?? 0) !== 0 || (probe[13]?.length ?? 0) !== 0 || probe[14] !== false ||
      (probe[15] ?? []).some(x => !['no-new-privileges', 'no-new-privileges=true'].includes(x)))
    fail('A container has a different image, network, restart or security profile');
  const proposed = row.spec.ports.map(p => [p.container + '/tcp', p.bindHost ?? '127.0.0.1', String(p.host)].join(' ')).sort();
  const ports = Object.entries(probe[16] ?? {}).flatMap(([key, values]) => (values ?? []).map(v => [key, v.HostIp, v.HostPort].join(' '))).sort();
  if (JSON.stringify(ports) !== JSON.stringify(proposed) || JSON.stringify((probe[17] ?? []).toSorted()) !== JSON.stringify((row.spec.extraHosts ?? []).toSorted()))
    fail('Native published ports or host mappings differ from the released declaration');
  const [shm, memory, reservation, nano, period, quota] = probe.slice(5, 11);
  if (![shm, memory, reservation, nano, period, quota].every(Number.isSafeInteger) ||
      shm < 0 || memory < 0 || reservation < 0 || nano < 0 || period < 0 || quota < -1 ||
      (nano > 0 && (period > 0 || quota > 0))) fail('Unsupported native resource profile');
  return { shm, memory, reservation, nano, period, quota, noNewPrivileges: Boolean(probe[15]?.length) };
}

export function nativeMounts(docker, row, object, physical) {
  const mounts = JSON.parse(docker(['container', 'inspect', '--format', '{{json .Mounts}}', '--', object]));
  if (!Array.isArray(mounts) || mounts.length !== row.spec.volumes.length || !row.spec.volumes.every(v =>
    mounts.some(m => m.Destination === v.target && m.RW === !v.readonly &&
      (path.isAbsolute(v.source) ? m.Type === 'bind' && m.Source === path.resolve(v.source) :
        m.Type === 'volume' && m.Name === v.source && m.Source === physical.volumes[v.source].path))))
    fail('The native container mounts differ from the retained physical roots');
}
