import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createHash, createPrivateKey, randomUUID, X509Certificate } from 'node:crypto';
import { checkIngressConflicts, ingressOwner, ingressOwnerKey, normalizeIngressApplication, normalizeIngressSettings, renderHostIngress } from './host-ingress-config.js';
import { DockerHostIngressRuntime } from './host-ingress-runtime.js';
import { withIngressLock, type IngressLock } from './host-ingress-lock.js';
import type { HostIngressApply, HostIngressCheck, HostIngressManifest, HostIngressOwner, HostIngressReceipt, HostIngressRemove, HostIngressRuntime, HostIngressSettings, HostIngressStatus, StoredIngressApplication } from './host-ingress-types.js';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const generationPattern = /^[1-9][0-9]*-[a-f0-9]{16}$/;
interface Journal { version: 1; previous: string | null; candidate: string; phase: 'prepared' | 'acknowledged'; settingsHash: string }
async function exists(file: string): Promise<boolean> { try { await fs.lstat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function syncDirectory(directory: string): Promise<void> { const fd = await fs.open(directory, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
async function durableFile(file: string, contents: string | Buffer): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`; const fd = await fs.open(temp, 'wx', 0o600);
  try { await fd.writeFile(contents); await fd.sync(); } finally { await fd.close(); }
  try { await fs.rename(temp, file); await syncDirectory(path.dirname(file)); } finally { await fs.rm(temp, { force: true }); }
}

/** Host-owned state; neither daemon shutdown nor app teardown removes this service. */
export class HostIngressService {
  readonly root: string;
  private readonly runtime: HostIngressRuntime;
  constructor(root = path.join(os.homedir(), '.omnitron', 'host-ingress'), runtime?: HostIngressRuntime, private readonly lock: IngressLock = withIngressLock) {
    this.root = path.resolve(root);
    if (/[\0\r\n,]/.test(this.root)) throw new Error('Invalid host ingress state root');
    this.runtime = runtime ?? new DockerHostIngressRuntime(this.root);
  }
  private file(name: string): string { return path.join(this.root, name); }
  private async locked<T>(body: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    return this.lock(this.file('publication.lock'), body);
  }
  private async settings(): Promise<HostIngressSettings | null> {
    try { return normalizeIngressSettings(JSON.parse(await fs.readFile(this.file('settings.json'), 'utf8'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  private async requiredSettings(): Promise<HostIngressSettings> { const settings = await this.settings(); if (!settings) throw new Error('Host ingress is not configured'); return settings; }
  async configure(value: HostIngressSettings): Promise<{ configured: true; settings: HostIngressSettings }> {
    const settings = normalizeIngressSettings(value);
    return this.locked(async () => {
      const previous = await this.settings();
      if (previous && JSON.stringify(previous) !== JSON.stringify(settings)) throw new Error('Host ingress settings are immutable; migrate or upgrade the host explicitly');
      if (!previous) await durableFile(this.file('settings.json'), JSON.stringify(settings, null, 2) + '\n');
      return { configured: true, settings };
    });
  }
  private async currentGeneration(): Promise<string | null> {
    let link: string;
    try { link = await fs.readlink(this.file('current')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error(`Invalid host ingress current pointer: ${String(e)}`); }
    if (!/^generations\/[1-9][0-9]*-[a-f0-9]{16}$/.test(link)) throw new Error('Invalid host ingress current pointer');
    return path.posix.basename(link);
  }
  private generation(settings: HostIngressSettings, sequence: number, applications: StoredIngressApplication[]): string {
    return `${sequence}-${digest(JSON.stringify({ settings, sequence, applications })).slice(0, 16)}`;
  }
  private async manifest(settings: HostIngressSettings, generation: string): Promise<HostIngressManifest> {
    if (!generationPattern.test(generation)) throw new Error('Invalid ingress generation');
    const raw = JSON.parse(await fs.readFile(this.file(`generations/${generation}/manifest.json`), 'utf8'));
    if (raw.version !== 1 || raw.generation !== generation || !Number.isSafeInteger(raw.sequence) || raw.sequence < 1 || !Array.isArray(raw.applications)
      || Object.keys(raw).sort().join(',') !== 'applications,generation,sequence,version') throw new Error('Invalid ingress manifest');
    const applications: StoredIngressApplication[] = raw.applications.map((app: any) => {
      if (!Array.isArray(app.routes)) throw new Error('Invalid ingress routes');
      const normalized = normalizeIngressApplication({ ...app, routes: app.routes.map(({ certificateObject: _object, ...route }: any) => route) });
      const routes = normalized.routes.map((route) => {
        const original = app.routes.find((r: any) => JSON.stringify(r.domains) === JSON.stringify(route.domains));
        if (!original || !/^[a-f0-9]{64}$/.test(original.certificateObject)) throw new Error('Invalid certificate snapshot');
        return { ...route, certificateObject: original.certificateObject as string };
      });
      return { ...normalized, routes };
    });
    applications.sort((a, b) => ingressOwnerKey(a.owner).localeCompare(ingressOwnerKey(b.owner)));
    checkIngressConflicts(settings, applications);
    if (this.generation(settings, raw.sequence, applications) !== generation || JSON.stringify(applications) !== JSON.stringify(raw.applications)) throw new Error('Ingress manifest content hash mismatch');
    const manifest: HostIngressManifest = { version: 1, generation, sequence: raw.sequence, applications };
    if ((await fs.readFile(this.file(`generations/${generation}/nginx.conf`), 'utf8')) !== renderHostIngress(settings, manifest)) throw new Error('Ingress configuration content mismatch');
    await this.verifyCertificates(manifest);
    return manifest;
  }
  private async verifyCertificates(manifest: HostIngressManifest): Promise<void> {
    const seen = new Set<string>();
    for (const app of manifest.applications) for (const route of app.routes) {
      const object = route.certificateObject; if (seen.has(object)) continue; seen.add(object);
      const certificate = await this.source(this.file('certificates'), `${object}/certificate.pem`);
      const key = await this.source(this.file('certificates'), `${object}/private-key.pem`);
      if (createHash('sha256').update(certificate).update('\0').update(key).digest('hex') !== object) throw new Error('TLS snapshot content hash mismatch');
    }
  }
  async status(): Promise<HostIngressStatus> {
    const settings = await this.settings(); const generation = await this.currentGeneration();
    if (!settings && generation) throw new Error('Ingress settings missing for existing generation');
    const manifest = settings && generation ? await this.manifest(settings, generation) : null;
    return { configured: !!settings, settings, generation, applications: manifest?.applications ?? [], observedGeneration: settings ? await this.runtime.observed(settings) : null, recoveryPending: await exists(this.file('pending.json')) };
  }
  private async pointer(generation: string | null): Promise<void> {
    if (generation === null) { await fs.rm(this.file('current'), { force: true }); await syncDirectory(this.root); return; }
    if (!generationPattern.test(generation)) throw new Error('Invalid ingress pointer target');
    const temp = this.file(`current.${randomUUID()}.tmp`);
    await fs.symlink(`generations/${generation}`, temp);
    try { await fs.rename(temp, this.file('current')); await syncDirectory(this.root); } finally { await fs.rm(temp, { force: true }); }
  }
  private async clearJournal(): Promise<void> { await fs.rm(this.file('pending.json')); await syncDirectory(this.root); }
  private async restore(settings: HostIngressSettings, generation: string | null): Promise<void> {
    if (generation) { await this.manifest(settings, generation); await this.runtime.validate(settings, generation); }
    await this.pointer(generation);
    if (generation) { await this.runtime.activate(settings); await this.runtime.acknowledge(settings, generation); }
    else await this.runtime.remove(settings);
  }
  private async recoverLocked(settings: HostIngressSettings): Promise<void> {
    if (!(await exists(this.file('pending.json')))) return;
    const journal: Journal = JSON.parse(await fs.readFile(this.file('pending.json'), 'utf8'));
    if (journal.version !== 1 || !['prepared', 'acknowledged'].includes(journal.phase) || !generationPattern.test(journal.candidate)
      || (journal.previous !== null && !generationPattern.test(journal.previous)) || journal.settingsHash !== digest(JSON.stringify(settings))
      || Object.keys(journal).sort().join(',') !== 'candidate,phase,previous,settingsHash,version') throw new Error('Invalid host ingress recovery journal');
    const current = await this.currentGeneration();
    if (current !== journal.previous && current !== journal.candidate) throw new Error('Host ingress recovery found an unrelated generation');
    if (journal.phase === 'acknowledged') {
      if (current !== journal.candidate) throw new Error('Acknowledged ingress generation pointer changed');
      await this.manifest(settings, journal.candidate); await this.runtime.inspect(settings);
      await this.runtime.activate(settings); await this.runtime.acknowledge(settings, journal.candidate);
    } else await this.restore(settings, journal.previous);
    await this.clearJournal();
  }
  async recover(): Promise<HostIngressStatus> {
    return this.locked(async () => { const settings = await this.requiredSettings(); await this.recoverLocked(settings); return this.status(); });
  }
  private async source(root: string, relative: string): Promise<Buffer> {
    const realRoot = await fs.realpath(root); const realFile = await fs.realpath(path.join(realRoot, relative));
    if (!realFile.startsWith(realRoot + path.sep)) throw new Error('TLS source escapes certificate root');
    const fd = await fs.open(realFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await fd.stat(); if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('TLS source must be a regular file under 1 MiB'); return await fd.readFile(); }
    finally { await fd.close(); }
  }
  private async snapshot(settings: HostIngressSettings, value: ReturnType<typeof normalizeIngressApplication>, persist = true): Promise<StoredIngressApplication> {
    const routes = [];
    for (const route of value.routes) {
      const certificate = await this.source(settings.certificateRoot, route.tls.certificate), key = await this.source(settings.certificateRoot, route.tls.privateKey);
      const x509 = new X509Certificate(certificate);
      if (Date.now() < Date.parse(x509.validFrom) || Date.now() >= Date.parse(x509.validTo)) throw new Error('Ingress TLS certificate is not currently valid');
      for (const domain of route.domains) if (!x509.checkHost(domain, { subject: 'never', partialWildcards: false, multiLabelWildcards: false, singleLabelSubdomains: false })) throw new Error(`TLS certificate SAN does not cover ${domain}`);
      if (!x509.checkPrivateKey(createPrivateKey(key))) throw new Error('Ingress TLS certificate and private key do not match');
      const object = createHash('sha256').update(certificate).update('\0').update(key).digest('hex');
      if (!persist) { routes.push({ ...route, certificateObject: object }); continue; }
      const directory = this.file(`certificates/${object}`);
      await fs.mkdir(this.file('certificates'), { recursive: true, mode: 0o700 });
      if (!(await exists(directory))) {
        const temp = this.file(`certificates/.${randomUUID()}.tmp`); await fs.mkdir(temp, { mode: 0o700 });
        await durableFile(path.join(temp, 'certificate.pem'), certificate); await durableFile(path.join(temp, 'private-key.pem'), key);
        await fs.rename(temp, directory); await syncDirectory(this.file('certificates'));
      } else if (!(await fs.readFile(path.join(directory, 'certificate.pem'))).equals(certificate) || !(await fs.readFile(path.join(directory, 'private-key.pem'))).equals(key)) throw new Error('TLS snapshot content mismatch');
      routes.push({ ...route, certificateObject: object });
    }
    return { ...value, routes };
  }
  private async publish(settings: HostIngressSettings, previous: HostIngressManifest | null, owner: HostIngressOwner, applications: StoredIngressApplication[]): Promise<HostIngressReceipt> {
    applications.sort((a, b) => ingressOwnerKey(a.owner).localeCompare(ingressOwnerKey(b.owner))); checkIngressConflicts(settings, applications);
    if (previous && JSON.stringify(applications) === JSON.stringify(previous.applications)) {
      const running = await this.runtime.inspect(settings);
      if (!running.running || await this.runtime.observed(settings) !== previous.generation) await this.runtime.activate(settings);
      await this.runtime.acknowledge(settings, previous.generation);
      return { generation: previous.generation, previousGeneration: previous.generation, observedGeneration: previous.generation, changed: false, owner };
    }
    const sequence = (previous?.sequence ?? 0) + 1; if (!Number.isSafeInteger(sequence)) throw new Error('Ingress sequence exhausted');
    const generation = this.generation(settings, sequence, applications);
    const manifest: HostIngressManifest = { version: 1, generation, sequence, applications };
    const directory = this.file(`generations/${generation}`); await fs.mkdir(this.file('generations'), { recursive: true, mode: 0o700 });
    if (await exists(directory)) await this.manifest(settings, generation);
    else {
      const temp = this.file(`generations/.${randomUUID()}.tmp`); await fs.mkdir(temp, { mode: 0o700 });
      await durableFile(path.join(temp, 'manifest.json'), JSON.stringify(manifest) + '\n'); await durableFile(path.join(temp, 'nginx.conf'), renderHostIngress(settings, manifest));
      await fs.rename(temp, directory); await syncDirectory(this.file('generations'));
    }
    await this.verifyCertificates(manifest);
    await this.runtime.validate(settings, generation);
    const journal: Journal = { version: 1, previous: previous?.generation ?? null, candidate: generation, phase: 'prepared', settingsHash: digest(JSON.stringify(settings)) };
    await durableFile(this.file('pending.json'), JSON.stringify(journal) + '\n');
    try {
      await this.pointer(generation); await this.runtime.activate(settings); await this.runtime.acknowledge(settings, generation);
      await durableFile(this.file('pending.json'), JSON.stringify({ ...journal, phase: 'acknowledged' }) + '\n');
    } catch (failure) {
      try { await this.restore(settings, journal.previous); await this.clearJournal(); }
      catch (rollback) { throw new Error(`Host ingress publication failed (${String(failure)}); rollback needs recovery (${String(rollback)})`); }
      throw new Error(`Host ingress publication failed; previous generation restored: ${String(failure)}`);
    }
    await this.clearJournal();
    return { generation, previousGeneration: previous?.generation ?? null, observedGeneration: generation, changed: true, owner };
  }
  /** Read-only admission check. Call under the deployment lease; final apply still requires CAS. */
  async check(input: HostIngressApply): Promise<HostIngressCheck> {
    const normalized = normalizeIngressApplication(input); const settings = await this.requiredSettings();
    if (await exists(this.file('pending.json'))) throw new Error('Host ingress recovery is required before preflight');
    const generation = await this.currentGeneration();
    if (input.expectedGeneration !== generation) throw new Error(`Host ingress generation conflict: expected ${String(input.expectedGeneration)}, current ${String(generation)}`);
    const previous = generation ? await this.manifest(settings, generation) : null;
    const others = (previous?.applications ?? []).filter((app) => ingressOwnerKey(app.owner) !== ingressOwnerKey(normalized.owner));
    checkIngressConflicts(settings, [...others, normalized]);
    await this.snapshot(settings, normalized, false);
    if (await this.currentGeneration() !== generation || await exists(this.file('pending.json'))) throw new Error('Host ingress generation conflict during preflight');
    return { valid: true, generation, owner: normalized.owner, reservedPorts: normalized.reservedPorts, domains: normalized.routes.flatMap((route) => route.domains), nativeConfigValidated: false };
  }
  async apply(input: HostIngressApply): Promise<HostIngressReceipt> {
    const normalized = normalizeIngressApplication(input);
    return this.locked(async () => {
      const settings = await this.requiredSettings(); await this.recoverLocked(settings);
      const generation = await this.currentGeneration(); if (input.expectedGeneration !== generation) throw new Error(`Host ingress generation conflict: expected ${String(input.expectedGeneration)}, current ${String(generation)}`);
      const previous = generation ? await this.manifest(settings, generation) : null;
      const others = (previous?.applications ?? []).filter((app) => ingressOwnerKey(app.owner) !== ingressOwnerKey(normalized.owner));
      checkIngressConflicts(settings, [...others, normalized]);
      const app = await this.snapshot(settings, normalized);
      return this.publish(settings, previous, app.owner, [...others, app]);
    });
  }
  async remove(input: HostIngressRemove): Promise<HostIngressReceipt> {
    if (!input || Object.keys(input).some((k) => !['owner', 'expectedGeneration'].includes(k))) throw new Error('Invalid ingress removal');
    const owner = ingressOwner(input.owner);
    return this.locked(async () => {
      const settings = await this.requiredSettings(); await this.recoverLocked(settings); const generation = await this.currentGeneration();
      if (input.expectedGeneration !== generation) throw new Error(`Host ingress generation conflict: expected ${String(input.expectedGeneration)}, current ${String(generation)}`);
      if (!generation) throw new Error('No host ingress generation exists');
      const previous = await this.manifest(settings, generation);
      return this.publish(settings, previous, owner, previous.applications.filter((app) => ingressOwnerKey(app.owner) !== ingressOwnerKey(owner)));
    });
  }
}
