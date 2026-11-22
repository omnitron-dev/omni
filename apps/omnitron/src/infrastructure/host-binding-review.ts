import { createHash } from 'node:crypto';
import { selectBareMetal, withMarker } from './bare-metal-plan.js';
import { bindService } from './service-binding.js';
import type { IServiceOverride, IServiceRequirement } from './types.js';

/** Only these application configuration formats have been reviewed for passive preparation. */
export const HOST_BINDING_PROFILES = {
  bitcoin: {
    unit: 'bitcoind', user: 'bitcoin', config: '/etc/bitcoin/bitcoin.conf', chainDataDir: '/var/lib/bitcoind',
    directives: ['rpcauth=${secret:rpc_auth}'],
  },
  'monero-daemon': {
    unit: 'monerod', user: 'monero', config: '/etc/monero/monerod.conf', chainDataDir: '/var/lib/monero/.bitmonero',
    directives: ['rpc-login=${secret:rpc_user}:${secret:rpc_password}'],
  },
  'monero-wallet-rpc': {
    unit: 'monero-wallet-rpc', user: 'monero-wallet', config: '/etc/monero/monero-wallet-rpc.conf', chainDataDir: null,
    directives: ['daemon-login=${secret:daemon_user}:${secret:daemon_password}', 'rpc-login=${secret:rpc_user}:${secret:rpc_password}'],
  },
} as const;

export type HostBindingProfile = keyof typeof HOST_BINDING_PROFILES;
export interface HostBindingSelection { project: string; stack: string; release: string; nodeId: string }
export interface HostBindingReview extends HostBindingSelection {
  protocol: 1;
  commit: string;
  manifestSha256: string;
  sshFingerprint: string;
  referencesSha256: string;
  bindings: Array<{ name: string; unit: string; user: string; config: string; chainDataDir: string | null; unitSha256: string; templateSha256: string }>;
  digest: string;
}
export type HostBindingSubject = HostBindingSelection & { commit: string; manifestSha256: string; sshFingerprint: string };
export const HOST_BINDING_NAMES = Object.keys(HOST_BINDING_PROFILES) as HostBindingProfile[];

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const slots = (content: string) => [...content.matchAll(/\$\{secret:([\w-]+)\}/g)].map(match => match[1]!);

function reviewBinding(name: HostBindingProfile, requirement: IServiceRequirement, override?: IServiceOverride) {
  const profile = HOST_BINDING_PROFILES[name];
  const effective = bindService(requirement, override);
  const secretNames = profile.directives.flatMap(slots);
  const refs: Array<[string, string]> = [];
  const symbolic: Record<string, string> = {};
  for (const field of secretNames) {
    const ref = effective.secrets[field];
    if (!ref || typeof ref !== 'object' || Object.keys(ref).length !== 1 || typeof ref.secret !== 'string' || !/^[\w./:-]{1,256}$/.test(ref.secret))
      throw Error(`${name} requires a declared vault reference for ${field}`);
    refs.push([field, ref.secret]);
    symbolic[field] = '${secret:' + field + '}';
  }
  // Never resolve a reference. Supplying only symbolic fields on both declarations also
  // prevents a literal from another network being incorporated into the review.
  const spec = selectBareMetal(name, { ...requirement, secrets: {} }, { ...override, secrets: symbolic });
  if (effective.networkMode !== 'mainnet' || !spec || spec.unresolved?.length || !spec.configContent || !spec.unitContent ||
      spec.user !== profile.user || spec.systemdUnit?.replace(/\.service$/, '') !== profile.unit ||
      spec.configFile !== profile.config || (profile.chainDataDir && spec.dataDir !== profile.chainDataDir) ||
      (spec.unitFile && spec.unitFile !== `/etc/systemd/system/${profile.unit}.service`))
    throw Error(`${name} does not match the supported mainnet unit, user and configuration`);
  const config = spec.configContent;
  const unit = spec.unitContent;
  const template = config + '\n' + unit;
  if (/[\p{Cc}\p{Cf}]/u.test(template.replace(/[\t\n]/g, '')) || Buffer.byteLength(template) > 128 * 1024 ||
      template.split('\n').some(line => !line.trimStart().startsWith('#') && /[^\t\x20-\x7e]/.test(line)))
    throw Error('Unsupported host binding template');
  const sensitive = config.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#') &&
    (/\$\{/.test(line) || /^(?:rpcauth|rpcuser|rpcpassword|rpc-login|daemon-login|rpc-ssl-private-key)\s*=/i.test(line)));
  if (JSON.stringify(sensitive.sort()) !== JSON.stringify([...profile.directives].sort()))
    throw Error(`${name} configuration does not use the admitted public credential fields`);
  const serviceParts = unit.split(/^\[Service\]\s*$/m);
  const service = serviceParts[1]?.split(/^\[/m)[0] ?? '';
  const users = [...service.matchAll(/^\s*User\s*=\s*(.*?)\s*$/gm)].map(row => row[1]);
  const groups = [...service.matchAll(/^\s*Group\s*=\s*(.*?)\s*$/gm)].map(row => row[1]);
  if (serviceParts.length !== 2 || users.length !== 1 || users[0] !== profile.user ||
      (groups.length && (groups.length !== 1 || groups[0] !== profile.user)) ||
      /\$\{|^\s*(?:(?:PermissionsStartOnly|Environment|EnvironmentFile)\s*=|Exec\w+\s*=\s*[-@:+!|]*[+!]|(?:Load|Set)Credential(?:Encrypted)?\s*=)/mi.test(unit) ||
      /^\s*Exec\w+\s*=.*(?:--?(?:rpcpassword|rpcauth|rpc-login|daemon-login)\b)/mi.test(unit))
    throw Error(`${name} unit does not match the reviewed unprivileged service identity`);
  return { template: withMarker(config), binding: { name, unit: profile.unit + '.service', user: profile.user, config: profile.config, chainDataDir: profile.chainDataDir,
    unitSha256: sha(withMarker(unit)), templateSha256: sha(withMarker(config)) }, refs };
}

export function hostBindingDigest(target: Omit<HostBindingReview, 'digest'>) {
  return sha(JSON.stringify([1, target.project, target.stack, target.release, target.commit, target.manifestSha256,
    target.nodeId, target.sshFingerprint, target.referencesSha256, target.bindings.map(b =>
      [b.name, b.unit, b.user, b.config, b.chainDataDir, b.unitSha256, b.templateSha256])]));
}

/** Internal release material. Only the public review is an RPC result. */
export function hostBindingMaterial(
  target: HostBindingSubject,
  declared: Record<string, IServiceRequirement>, overrides: Record<string, IServiceOverride> = {},
) {
  if (![target.project, target.stack, target.nodeId].every(label => typeof label === 'string' && /^[\w][\w.-]{0,127}$/.test(label)) ||
      !/^[a-f0-9]{40}$/.test(target.commit) || !/^[a-f0-9]{64}$/.test(target.manifestSha256) ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(target.sshFingerprint)) throw Error('Incomplete registered release or recipient identity');
  const rows = HOST_BINDING_NAMES.map(name => {
    if (!declared[name] || Object.keys(overrides).some(key => key.endsWith('/' + name)))
      throw Error(`One unambiguous deployed service binding is required for ${name}`);
    return reviewBinding(name, declared[name], overrides[name]);
  });
  const bindings = rows.map(row => row.binding);
  // Include the source reference mapping in the review, without returning its vault key names.
  const referencesSha256 = sha(JSON.stringify(rows.map(row => row.refs)));
  const subject = { protocol: 1 as const, ...target, referencesSha256, bindings };
  const review: HostBindingReview = { ...subject, digest: hostBindingDigest(subject) };
  return { review, templates: Object.fromEntries(rows.map(row => [row.binding.name, row.template])),
    references: Object.fromEntries(rows.map(row => [row.binding.name,
      Object.fromEntries(row.refs.map(([slot, key]) => [slot, { secret: key }]))])) };
}

export function reviewHostBindings(target: HostBindingSubject, declared: Record<string, IServiceRequirement>,
  overrides: Record<string, IServiceOverride> = {}): HostBindingReview {
  return hostBindingMaterial(target, declared, overrides).review;
}
