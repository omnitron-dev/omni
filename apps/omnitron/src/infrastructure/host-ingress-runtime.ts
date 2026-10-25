import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import type { HostIngressRuntime, HostIngressSettings } from './host-ingress-types.js';

const execute = promisify(execFile);
export type IngressExec = (file: string, args: string[]) => Promise<string>;
export const HOST_INGRESS_CONTAINER = 'omnitron-host-ingress';
const binary = '/usr/local/openresty/bin/openresty';
const mount = '/etc/omnitron-ingress';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class DockerHostIngressRuntime implements HostIngressRuntime {
  constructor(private readonly root: string, private readonly exec: IngressExec = async (file, args) => (await execute(file, args, { timeout: 120_000, maxBuffer: 1024 * 1024 })).stdout) {}
  private labels(settings: HostIngressSettings): Record<string, string> {
    return { 'omnitron.host-ingress': 'true', 'omnitron.host-ingress.owner': hash(this.root), 'omnitron.host-ingress.settings': hash(JSON.stringify(settings)) };
  }
  async inspect(settings: HostIngressSettings): Promise<{ exists: boolean; running: boolean }> {
    let raw: string;
    try { raw = await this.exec('docker', ['inspect', '--type', 'container', HOST_INGRESS_CONTAINER]); }
    catch (error) {
      const message = String(error);
      if (/No such (object|container):/i.test(message)) return { exists: false, running: false };
      throw error;
    }
    const rows = JSON.parse(raw); const c = rows[0];
    if (rows.length !== 1 || !c || Object.entries(this.labels(settings)).some(([k, v]) => c.Config?.Labels?.[k] !== v)
      || c.Config?.Image !== settings.image || c.HostConfig?.NetworkMode !== 'host'
      || !c.Mounts?.some((m: any) => m.Type === 'bind' && m.Source === this.root && m.Destination === mount && m.RW === false)
      || c.Config?.Labels?.['omnitron.managed'] !== undefined || c.Config?.Labels?.['omnitron.project'] !== undefined || c.Config?.Labels?.['omnitron.stack'] !== undefined
      || JSON.stringify(c.Config?.Entrypoint) !== JSON.stringify([binary])
      || JSON.stringify(c.Config?.Cmd) !== JSON.stringify(['-c', `${mount}/current/nginx.conf`, '-g', 'daemon off;'])
      || c.HostConfig?.ReadonlyRootfs !== true) throw new Error('Refusing foreign or differently configured host ingress container');
    return { exists: true, running: c.State?.Running === true };
  }
  private common(): string[] {
    return ['--pull', 'never', '--network', 'host', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--memory', '256m', '--cpus', '1', '--pids-limit', '64', '--security-opt', 'no-new-privileges', '--mount', `type=bind,source=${this.root},target=${mount},readonly`, '--entrypoint', binary];
  }
  async validate(settings: HostIngressSettings, generation: string): Promise<void> {
    await this.inspect(settings);
    await this.exec('docker', ['run', '--rm', ...this.common(), settings.image, '-t', '-c', `${mount}/generations/${generation}/nginx.conf`]);
  }
  async activate(settings: HostIngressSettings): Promise<void> {
    const state = await this.inspect(settings);
    if (state.running) {
      await this.exec('docker', ['exec', HOST_INGRESS_CONTAINER, binary, '-c', `${mount}/current/nginx.conf`, '-s', 'reload']);
      return;
    }
    if (state.exists) { await this.exec('docker', ['start', HOST_INGRESS_CONTAINER]); return; }
    for (const port of [settings.httpPort, settings.httpsPort, settings.controlPort]) {
      if (await this.listening(port)) throw new Error(`Host ingress listener port ${port} is already occupied`);
    }
    const labels = Object.entries(this.labels(settings)).flatMap(([k, v]) => ['--label', `${k}=${v}`]);
    await this.exec('docker', ['run', '-d', '--name', HOST_INGRESS_CONTAINER, '--restart', 'unless-stopped', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3', ...labels, ...this.common(), settings.image, '-c', `${mount}/current/nginx.conf`, '-g', 'daemon off;']);
  }
  private listening(port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', (error: NodeJS.ErrnoException) => { socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(false); else reject(error); });
      socket.setTimeout(1000, () => { socket.destroy(); reject(new Error(`Listener probe timed out on ${port}`)); });
    });
  }
  observed(settings: HostIngressSettings): Promise<string | null> {
    return new Promise((resolve) => {
      const request = http.get({ host: '127.0.0.1', port: settings.controlPort, path: '/generation', agent: false, headers: { Connection: 'close' }, timeout: 1000 }, (response) => {
        let body = ''; response.setEncoding('utf8');
        response.on('data', (chunk: string) => { body += chunk; if (body.length > 128) { response.destroy(); resolve(null); } });
        response.on('error', () => resolve(null));
        response.on('end', () => resolve(response.statusCode === 200 && /^[1-9][0-9]*-[a-f0-9]{16}$/.test(body) ? body : null));
      });
      request.on('timeout', () => request.destroy()); request.on('error', () => resolve(null));
    });
  }
  async acknowledge(settings: HostIngressSettings, generation: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    do {
      if ((await this.observed(settings)) === generation) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(`Host ingress did not acknowledge generation ${generation}`);
  }
  async remove(settings: HostIngressSettings): Promise<void> {
    if ((await this.inspect(settings)).exists) await this.exec('docker', ['rm', '-f', HOST_INGRESS_CONTAINER]);
  }
}
