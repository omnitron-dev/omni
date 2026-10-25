import path from 'node:path';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import type { HostIngressApplication, HostIngressLocation, HostIngressManifest, HostIngressOwner, HostIngressSettings } from './host-ingress-types.js';

function record<K extends string>(value: unknown, allowed: K[], label: string): Partial<Record<K, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key as K)) throw new Error(`Unknown ${label} field: ${key}`);
  return value as Partial<Record<K, unknown>>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length) throw new Error(`${label} must be a nonempty string`);
  return value;
}
export function ingressPort(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) throw new Error('Invalid TCP port');
  return value as number;
}
export function ingressOwner(value: unknown): HostIngressOwner {
  const r = record(value, ['project', 'stack', 'app'], 'owner');
  const part = (v: unknown) => { const s = text(v, 'owner component'); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(s)) throw new Error('Invalid owner component'); return s; };
  return { project: part(r.project), stack: part(r.stack), app: part(r.app) };
}
export function ingressOwnerKey(owner: HostIngressOwner): string { return JSON.stringify([owner.project, owner.stack, owner.app]); }
export function ingressDomain(value: unknown): string {
  const raw = text(value, 'domain');
  if (/[\\/:?#@%\s\x00-\x1f\x7f]/.test(raw) || raw !== raw.trim()) throw new Error('Domain must not contain surrounding whitespace');
  const name = domainToASCII(raw.replace(/\.$/, '')).toLowerCase();
  if (!name || name.length > 253 || isIP(name) || !name.includes('.') || name.split('.').some((p) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) throw new Error(`Invalid exact hostname: ${raw}`);
  return name;
}
export function certificateName(value: unknown): string {
  const name = text(value, 'TLS filename');
  if (!/^[a-zA-Z0-9._/-]+$/.test(name) || path.posix.isAbsolute(name) || name.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error('TLS filename must be relative to the host certificate root');
  return name;
}
export function normalizeIngressSettings(value: unknown): HostIngressSettings {
  const r = record(value, ['image', 'httpPort', 'httpsPort', 'controlPort', 'certificateRoot', 'proxyPolicy'], 'host ingress settings');
  const image = text(r.image, 'image');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Host ingress image must be pinned by sha256 digest');
  const httpPort = ingressPort(r.httpPort), httpsPort = ingressPort(r.httpsPort), controlPort = ingressPort(r.controlPort);
  if (new Set([httpPort, httpsPort, controlPort]).size !== 3) throw new Error('Ingress listener ports must differ');
  const certificateRoot = text(r.certificateRoot, 'certificateRoot');
  if (!path.isAbsolute(certificateRoot) || /[\0\r\n,]/.test(certificateRoot)) throw new Error('certificateRoot must be an absolute host path');
  const policy = record(r.proxyPolicy, ['mode', 'trustedCidrs', 'allowLoopbackProbes'], 'proxy policy');
  if (policy.allowLoopbackProbes !== undefined && typeof policy.allowLoopbackProbes !== 'boolean') throw new Error('allowLoopbackProbes must be boolean');
  if (!Array.isArray(policy.trustedCidrs)) throw new Error('trustedCidrs must be an array');
  const trustedCidrs = [...new Set(policy.trustedCidrs.map((value) => {
    const cidr = text(value, 'CIDR'); const parts = cidr.split('/'); const family = isIP(parts[0]!);
    if (parts.length !== 2 || !family || !/^\d+$/.test(parts[1]!) || Number(parts[1]) < 1 || Number(parts[1]) > (family === 4 ? 32 : 128)) throw new Error(`Invalid trusted CIDR: ${cidr}`);
    return `${parts[0]!.toLowerCase()}/${Number(parts[1])}`;
  }))].sort();
  if (policy.mode === 'cloudflare-only' && trustedCidrs.length > 0) return { image, httpPort, httpsPort, controlPort, certificateRoot: path.resolve(certificateRoot), proxyPolicy: { mode: 'cloudflare-only', trustedCidrs, ...(policy.allowLoopbackProbes ? { allowLoopbackProbes: true } : {}) } };
  if (policy.mode === 'direct' && trustedCidrs.length === 0 && !policy.allowLoopbackProbes) return { image, httpPort, httpsPort, controlPort, certificateRoot: path.resolve(certificateRoot), proxyPolicy: { mode: 'direct', trustedCidrs: [] } };
  throw new Error('Cloudflare-only requires explicit trusted CIDRs; direct mode trusts no proxy headers');
}
export function normalizeIngressApplication(value: unknown): HostIngressApplication {
  const r = record(value, ['owner', 'reservedPorts', 'routes', 'expectedGeneration', 'preparedOwnerRevision', 'takeover'], 'application ingress');
  const owner = ingressOwner(r.owner);
  if (!Array.isArray(r.reservedPorts) || r.reservedPorts.length > 1000 || !Array.isArray(r.routes) || !r.routes.length || r.routes.length > 100) throw new Error('Declare reservedPorts and 1–100 routes');
  const ports = new Set(r.reservedPorts.map(ingressPort)); const allDomains = new Set<string>();
  const routes = r.routes.map((entry) => {
    const route = record(entry, ['domains', 'tls', 'locations', 'maxBodyBytes'], 'route');
    if (!Array.isArray(route.domains) || !route.domains.length || route.domains.length > 100) throw new Error('Declare 1–100 exact domains per route');
    const maxBodyBytes = route.maxBodyBytes === undefined ? 16 * 1024 * 1024 : route.maxBodyBytes;
    if (!Number.isSafeInteger(maxBodyBytes) || (maxBodyBytes as number) < 1 || (maxBodyBytes as number) > 128 * 1024 * 1024) throw new Error('maxBodyBytes must be 1–134217728 bytes');
    const domains = route.domains.map(ingressDomain).sort();
    for (const name of domains) { if (allDomains.has(name)) throw new Error(`Duplicate domain: ${name}`); allDomains.add(name); }
    const tls = record(route.tls, ['certificate', 'privateKey'], 'TLS');
    if (!Array.isArray(route.locations) || !route.locations.length || route.locations.length > 100) throw new Error('Declare 1–100 locations');
    const seen = new Set<string>();
    const locations: HostIngressLocation[] = route.locations.map((entry) => {
      const loc = record(entry, ['path', 'upstream', 'stripPrefix', 'deny'], 'location'); const prefix = text(loc.path, 'location path');
      if (!/^\/[a-zA-Z0-9_./-]*$/.test(prefix) || prefix.includes('//') || prefix.split('/').some((s) => s === '.' || s === '..')) throw new Error('Location must be a literal absolute path');
      const effective = prefix === '/' ? '/' : prefix.replace(/\/$/, '');
      if (seen.has(effective)) throw new Error(`Duplicate location: ${prefix}`); seen.add(effective);
      if ('deny' in loc) {
        if (![403, 404, 410].includes(loc.deny as number) || 'upstream' in loc || 'stripPrefix' in loc) throw new Error('Invalid deny location');
        return { path: prefix, deny: loc.deny as 403 | 404 | 410 };
      }
      if (!prefix.endsWith('/') || typeof loc.stripPrefix !== 'boolean') throw new Error('Proxy prefixes end with / and declare stripPrefix');
      const upstream = record(loc.upstream, ['host', 'port'], 'upstream');
      if (upstream.host !== '127.0.0.1' && upstream.host !== '::1') throw new Error('Ingress upstream must be literal loopback');
      const port = ingressPort(upstream.port); ports.add(port);
      return { path: prefix, upstream: { host: upstream.host, port }, stripPrefix: loc.stripPrefix };
    });
    for (const loc of locations) if ('deny' in loc) {
      const base = loc.path === '/' ? '/' : loc.path.replace(/\/$/, '') + '/';
      if (locations.some((other) => other !== loc && other.path.startsWith(base))) throw new Error('A deny location cannot have overriding child locations');
    }
    if (!seen.has('/')) throw new Error('Every route must declare its root location');
    return { domains, maxBodyBytes: maxBodyBytes as number, tls: { certificate: certificateName(tls.certificate), privateKey: certificateName(tls.privateKey) }, locations: locations.sort((a, b) => a.path.localeCompare(b.path)) };
  });
  return { owner, reservedPorts: [...ports].sort((a, b) => a - b), routes: routes.sort((a, b) => a.domains[0]!.localeCompare(b.domains[0]!)) };
}
export function checkIngressConflicts(settings: HostIngressSettings, applications: HostIngressApplication[]): void {
  const domains = new Map<string, string>(), ports = new Map<number, string>(), owners = new Set<string>();
  for (const port of [settings.httpPort, settings.httpsPort, settings.controlPort]) ports.set(port, 'host ingress');
  for (const app of applications) {
    const owner = ingressOwnerKey(app.owner); if (owners.has(owner)) throw new Error(`Duplicate owner: ${owner}`); owners.add(owner);
    for (const port of app.reservedPorts) { const existing = ports.get(port); if (existing) throw new Error(`TCP port ${port} is reserved by ${existing}`); ports.set(port, owner); }
    for (const route of app.routes) for (const domain of route.domains) { const existing = domains.get(domain); if (existing) throw new Error(`Domain ${domain} belongs to ${existing}`); domains.set(domain, owner); }
  }
}
/** All interpolated values come from the closed normalized schema, never app-supplied nginx. */
export function renderHostIngress(settings: HostIngressSettings, manifest: HostIngressManifest): string {
  if (!/^[1-9][0-9]*-[a-f0-9]{16}$/.test(manifest.generation)) throw new Error('Invalid generation');
  checkIngressConflicts(settings, manifest.applications);
  const lines = ['worker_processes 1;', 'error_log /dev/stderr warn;', 'pid /tmp/omnitron-ingress.pid;', 'events { worker_connections 1024; }', 'http {', `  log_format ingress_route '$request_method $uri $status';`, '  access_log /dev/stdout ingress_route;', '  server_tokens off;', '  client_body_temp_path /tmp/ingress-client;', '  proxy_temp_path /tmp/ingress-proxy;', '  fastcgi_temp_path /tmp/ingress-fastcgi;', '  uwsgi_temp_path /tmp/ingress-uwsgi;', '  scgi_temp_path /tmp/ingress-scgi;', '  map $http_upgrade $ingress_connection { default upgrade; "" close; }'];
  if (settings.proxyPolicy.mode === 'cloudflare-only') {
    for (const cidr of settings.proxyPolicy.trustedCidrs) lines.push(`  set_real_ip_from ${cidr};`);
    lines.push('  real_ip_header CF-Connecting-IP;', '  real_ip_recursive on;', '  geo $realip_remote_addr $ingress_trusted_proxy {', '    default 0;');
    for (const cidr of settings.proxyPolicy.trustedCidrs) lines.push(`    ${cidr} 1;`);
    if (settings.proxyPolicy.allowLoopbackProbes) lines.push('    127.0.0.1/32 1;', '    ::1/128 1;');
    lines.push('  }');
  }
  lines.push(`  server { listen 127.0.0.1:${settings.controlPort}; location = /generation { default_type text/plain; return 200 "${manifest.generation}"; } location / { return 404; } }`, `  server { listen ${settings.httpPort} default_server; server_name _; return 444; }`, `  server { listen ${settings.httpsPort} ssl default_server; server_name _; ssl_reject_handshake on; return 444; }`);
  for (const app of manifest.applications) for (const route of app.routes) {
    if (!/^[a-f0-9]{64}$/.test(route.certificateObject)) throw new Error('Invalid certificate object');
    const names = route.domains.join(' '); const trusted = settings.proxyPolicy.mode === 'cloudflare-only' ? '    if ($ingress_trusted_proxy = 0) { return 403; }' : '';
    lines.push('  server {', `    listen ${settings.httpPort};`, `    server_name ${names};`, trusted, `    return 308 https://$host${settings.httpsPort === 443 ? '' : ':' + settings.httpsPort}$request_uri;`, '  }', '  server {', `    listen ${settings.httpsPort} ssl;`, `    server_name ${names};`, `    client_max_body_size ${route.maxBodyBytes ?? 16 * 1024 * 1024};`, `    ssl_certificate /etc/omnitron-ingress/certificates/${route.certificateObject}/certificate.pem;`, `    ssl_certificate_key /etc/omnitron-ingress/certificates/${route.certificateObject}/private-key.pem;`, '    ssl_protocols TLSv1.2 TLSv1.3;', trusted);
    for (const location of route.locations) {
      if ('deny' in location) {
        const base = location.path.replace(/\/$/, '');
        if (base) lines.push(`    location = ${base} { return ${location.deny}; }`);
        lines.push(`    location ^~ ${base}/ { return ${location.deny}; }`); continue;
      }
      const host = location.upstream.host === '::1' ? '[::1]' : location.upstream.host;
      lines.push(`    location ^~ ${location.path} {`, `      proxy_pass http://${host}:${location.upstream.port}${location.stripPrefix ? '/' : ''};`, '      proxy_http_version 1.1;', '      proxy_buffering off;', '      proxy_set_header Host $host;', '      proxy_set_header X-Real-IP $remote_addr;', '      proxy_set_header X-Forwarded-For $remote_addr;', '      proxy_set_header X-Forwarded-Proto $scheme;', '      proxy_set_header Forwarded "";', '      proxy_set_header CF-Connecting-IP "";', '      proxy_set_header Upgrade $http_upgrade;', '      proxy_set_header Connection $ingress_connection;', '      proxy_connect_timeout 5s;', '      proxy_read_timeout 60s;', '    }');
    }
    lines.push('  }');
  }
  lines.push('}', ''); return lines.filter((s) => s !== '').join('\n') + '\n';
}
