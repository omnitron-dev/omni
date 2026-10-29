import https from 'node:https';
import { createHash, X509Certificate } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import { ingressDomain, ingressOwner } from './host-ingress-config.js';
import type { HostIngressApplication, HostIngressSettings, HostIngressTakeover, HostIngressTakeoverSnapshot } from './host-ingress-types.js';

type Execute = (file: string, args: string[]) => Promise<string>;
function object<K extends string>(value: unknown, keys: K[]): Partial<Record<K, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k as K))) throw new Error('Invalid ingress takeover descriptor');
  return value as Partial<Record<K, unknown>>;
}
export function normalizeIngressTakeover(value: unknown, app?: HostIngressApplication): HostIngressTakeover {
  const r = object(value, ['containerId', 'containerName', 'expectedLabels', 'probe']);
  if (typeof r.containerId !== 'string' || !/^[a-f0-9]{64}$/.test(r.containerId) || typeof r.containerName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(r.containerName) || r.containerName === 'omnitron-host-ingress') throw new Error('Takeover requires an exact legacy container ID and name');
  if (!r.expectedLabels || typeof r.expectedLabels !== 'object' || Array.isArray(r.expectedLabels)) throw new Error('Takeover requires exact ownership labels');
  const labels: Record<string, string> = {};
  for (const [key, labelValue] of Object.entries(r.expectedLabels)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(key) || typeof labelValue !== 'string' || labelValue.length > 256 || /[\0\r\n]/.test(labelValue)) throw new Error('Invalid takeover ownership label');
    labels[key] = labelValue;
  }
  const owner = ingressOwner({ project: labels['omnitron.project'], stack: labels['omnitron.stack'], app: 'legacy-origin' });
  if (labels['omnitron.managed'] !== 'true' || (app && (owner.project !== app.owner.project || owner.stack !== app.owner.stack)) || 'omnitron.host-ingress' in labels) throw new Error('Legacy origin must belong to the declaring project and stack');
  const p = object(r.probe, ['domain', 'path', 'status', 'certificateSha256']); const domain = ingressDomain(p.domain);
  if (app && !app.routes.some((route) => route.domains.includes(domain))) throw new Error('Takeover probe hostname must belong to this application');
  if (typeof p.path !== 'string' || !/^\/[a-zA-Z0-9_./-]*$/.test(p.path) || p.path.includes('//') || p.path.split('/').some((s) => s === '.' || s === '..') || !Number.isInteger(p.status) || (p.status as number) < 200 || (p.status as number) > 399 || typeof p.certificateSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.certificateSha256)) throw new Error('Invalid pinned HTTPS takeover probe');
  return { containerId: r.containerId, containerName: r.containerName, expectedLabels: Object.fromEntries(Object.entries(labels).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), probe: { domain, path: p.path, status: p.status as number, certificateSha256: p.certificateSha256 } };
}
export function normalizeIngressTakeoverSnapshot(value: unknown): HostIngressTakeoverSnapshot {
  const r = object(value, ['descriptor', 'restartPolicy', 'image', 'wasRunning']);
  const p = object(r.restartPolicy, ['name', 'maximumRetryCount']);
  if (r.wasRunning !== true || typeof r.image !== 'string' || !r.image.length || typeof p.name !== 'string' || !['no', 'always', 'unless-stopped', 'on-failure'].includes(p.name) || !Number.isSafeInteger(p.maximumRetryCount) || (p.maximumRetryCount as number) < 0) throw new Error('Invalid legacy origin snapshot');
  return { descriptor: normalizeIngressTakeover(r.descriptor), restartPolicy: { name: p.name as HostIngressTakeoverSnapshot['restartPolicy']['name'], maximumRetryCount: p.maximumRetryCount as number }, image: r.image, wasRunning: true };
}
interface Container {
  Id: string; Name: string; Config: { Image: string; Labels: Record<string, string> };
  HostConfig: { NetworkMode: string; RestartPolicy: { Name: string; MaximumRetryCount: number } };
  State: { Running: boolean };
}
function policy(value: Container['HostConfig']['RestartPolicy']): HostIngressTakeoverSnapshot['restartPolicy'] {
  if (!value || !['no', 'always', 'unless-stopped', 'on-failure'].includes(value.Name) || !Number.isSafeInteger(value.MaximumRetryCount) || value.MaximumRetryCount < 0) throw new Error('Unsupported legacy restart policy');
  return { name: value.Name as HostIngressTakeoverSnapshot['restartPolicy']['name'], maximumRetryCount: value.MaximumRetryCount };
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Explicit first-publication handoff, never name-only adoption or container deletion. */
export class DockerIngressTakeover {
  constructor(private readonly exec: Execute) {}
  private async read(descriptor: HostIngressTakeover): Promise<Container> {
    const rows: Container[] = JSON.parse(await this.exec('docker', ['inspect', '--type', 'container', descriptor.containerId]));
    const container = rows[0];
    if (rows.length !== 1 || !container || container.Id !== descriptor.containerId || container.Name !== `/${descriptor.containerName}` || container.HostConfig?.NetworkMode !== 'host' || container.Config?.Labels?.['omnitron.host-ingress'] !== undefined || Object.entries(descriptor.expectedLabels).some(([key, value]) => container.Config?.Labels?.[key] !== value)) throw new Error('Legacy origin identity or ownership changed');
    return container;
  }
  async probe(settings: HostIngressSettings, descriptor: HostIngressTakeover): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => { clearTimeout(timer); if (error) reject(error); else resolve(); };
      const timer = setTimeout(() => { request.destroy(); finish(new Error('Legacy origin HTTPS probe timed out')); }, 2000);
      const request = https.get({ host: '127.0.0.1', port: settings.httpsPort, servername: descriptor.probe.domain, path: descriptor.probe.path, headers: { Host: descriptor.probe.domain }, agent: false, timeout: 2000,
        // Trust is an explicit leaf DER pin and SAN check below, not the system CA store.
        rejectUnauthorized: false }, (response) => {
        try {
          const raw = (response.socket as TLSSocket).getPeerCertificate().raw;
          if (!raw || createHash('sha256').update(raw).digest('hex') !== descriptor.probe.certificateSha256) throw new Error('Legacy origin TLS fingerprint mismatch');
          const cert = new X509Certificate(raw);
          if (!cert.checkHost(descriptor.probe.domain, { subject: 'never', partialWildcards: false, multiLabelWildcards: false, singleLabelSubdomains: false }) || Date.now() < Date.parse(cert.validFrom) || Date.now() >= Date.parse(cert.validTo)) throw new Error('Legacy origin TLS SAN or validity mismatch');
          if (response.statusCode !== descriptor.probe.status) throw new Error(`Legacy origin probe expected ${descriptor.probe.status}, received ${response.statusCode}`);
          response.destroy(); finish();
        } catch (error) { response.destroy(); finish(error); }
      });
      request.once('error', finish); request.once('timeout', () => request.destroy(new Error('Legacy origin HTTPS probe timed out')));
    });
  }
  async inspect(settings: HostIngressSettings, descriptor: HostIngressTakeover): Promise<HostIngressTakeoverSnapshot> {
    const container = await this.read(descriptor);
    if (container.State?.Running !== true) throw new Error('Legacy origin must be running before an initial takeover');
    const restartPolicy = policy(container.HostConfig.RestartPolicy);
    await this.probe(settings, descriptor);
    return { descriptor, restartPolicy, image: container.Config.Image, wasRunning: true };
  }
  private async bound(snapshot: HostIngressTakeoverSnapshot): Promise<Container> {
    const container = await this.read(snapshot.descriptor);
    if (container.Config.Image !== snapshot.image || (!same(policy(container.HostConfig.RestartPolicy), snapshot.restartPolicy) && !same(policy(container.HostConfig.RestartPolicy), { name: 'no', maximumRetryCount: 0 }))) throw new Error('Legacy origin configuration changed during takeover');
    return container;
  }
  async quiesce(snapshot: HostIngressTakeoverSnapshot): Promise<void> {
    const container = await this.bound(snapshot);
    if (container.HostConfig.RestartPolicy.Name !== 'no') await this.exec('docker', ['update', '--restart', 'no', snapshot.descriptor.containerId]);
    if (container.State.Running) await this.exec('docker', ['stop', '--time', '30', snapshot.descriptor.containerId]);
    await this.verifyRetired(snapshot);
  }
  async verifyRetired(snapshot: HostIngressTakeoverSnapshot): Promise<void> {
    const container = await this.bound(snapshot);
    if (container.State.Running || container.HostConfig.RestartPolicy.Name !== 'no') throw new Error('Legacy origin has not been safely retired');
  }
  async restore(settings: HostIngressSettings, snapshot: HostIngressTakeoverSnapshot): Promise<void> {
    const container = await this.bound(snapshot);
    if (!same(policy(container.HostConfig.RestartPolicy), snapshot.restartPolicy)) {
      const value = snapshot.restartPolicy.name === 'on-failure' && snapshot.restartPolicy.maximumRetryCount > 0 ? `on-failure:${snapshot.restartPolicy.maximumRetryCount}` : snapshot.restartPolicy.name;
      await this.exec('docker', ['update', '--restart', value, snapshot.descriptor.containerId]);
    }
    if (!container.State.Running) await this.exec('docker', ['start', snapshot.descriptor.containerId]);
    const deadline = Date.now() + 10_000;
    let last: unknown;
    do {
      try { const current = await this.bound(snapshot); if (!current.State.Running || !same(policy(current.HostConfig.RestartPolicy), snapshot.restartPolicy)) throw new Error('Legacy origin is not restored'); await this.probe(settings, snapshot.descriptor); return; }
      catch (error) { last = error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    } while (Date.now() < deadline);
    throw new Error(`Legacy origin restore was not observed: ${String(last)}`);
  }
}
