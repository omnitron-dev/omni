import path from 'node:path';
import { renderLaunchdPlist, renderSystemdUnit, type UnitInputs } from './service-units.js';
import type { ServiceScope } from '../shared/dto/runtime-update.js';

export interface ServiceDefinition {
  home: string;
  argv: string[];
  environment: Record<string, string>;
  workdir: string;
  stderr: string;
  role: 'daemon' | 'owner' | 'backend';
  account?: string;
}

/** Decode only the grammar the installer emits; the byte-for-byte render below rejects all other directives. */
function systemdValue(raw: string): string {
  const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  return value.replace(/\\(["\\])/g, '$1').replace(/%%/g, '%');
}

function xmlValue(raw: string): string {
  return raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function readServiceDefinition(body: string, platform: NodeJS.Platform, scope: ServiceScope, label: string, loginHome: string): ServiceDefinition {
  const darwin = platform === 'darwin';
  const environment: Record<string, string> = Object.create(null);
  let argv: string[], workdir: string, stderr = '', stdout = '', user: string;
  if (darwin) {
    const strings = (body.match(/<key>ProgramArguments<\/key>\s*<array>([^]*?)<\/array>/)?.[1] ?? '');
    argv = [...strings.matchAll(/<string>([^\n]*?)<\/string>/g)].map(match => xmlValue(match[1]!));
    const pairs = (block: string) => Object.fromEntries([...block.matchAll(/<key>([\w]+)<\/key>\n\s*<string>([^\n]*?)<\/string>/g)]
      .map(match => [match[1]!, xmlValue(match[2]!) as string]));
    Object.assign(environment, pairs(body.match(/<key>EnvironmentVariables<\/key>\s*<dict>([^]*?)<\/dict>/)?.[1] ?? ''));
    const fields = pairs(body);
    if (fields['Label'] !== label) throw Error('Unexpected launchd label');
    workdir = fields['WorkingDirectory'] ?? '';
    stderr = fields['StandardErrorPath'] ?? '';
    stdout = fields['StandardOutPath'] ?? '';
    user = fields['UserName'] ?? '';
  } else {
    const raw = body.match(/^ExecStart=(.*)$/m)?.[1] ?? '';
    argv = (raw.match(/"(?:\\.|[^"\\])*"|[^\s"]+/g) ?? []).map(word => systemdValue(word).replace(/\$\$/g, '$'));
    for (const match of body.matchAll(/^Environment=(.*)$/gm)) {
      const value = systemdValue(match[1]!);
      const equals = value.indexOf('=');
      environment[value.slice(0, equals)] = value.slice(equals + 1);
    }
    workdir = (body.match(/^WorkingDirectory=(.+)$/m)?.[1] ?? '').replace(/%%/g, '%');
    user = body.match(/^User=(.+)$/m)?.[1] ?? '';
  }

  const role = argv.length === 4 && argv[1] === '--import' && argv[2] === 'tsx/esm' &&
    argv[3] === path.join(workdir, 'dist/daemon/daemon-entry.js') ? 'daemon'
    : argv.length === 3 && argv[1] === path.join(workdir, 'dist/daemon/managed-entry.js') &&
      (argv[2] === 'owner' || argv[2] === 'backend') ? argv[2] : null;
  if (!role || !path.isAbsolute(workdir) || !path.isAbsolute(argv[0] ?? '') || environment['OMNITRON_CWD'] !== workdir ||
      !environment['PATH'] || (scope === 'system' && (!user || !path.isAbsolute(environment['HOME'] ?? '')))) throw Error('Invalid native daemon entry or environment');
  const home = environment['OMNITRON_HOME'] ?? path.join(environment['HOME'] ?? loginHome, '.omnitron');
  if (!path.isAbsolute(home) || environment['OMNITRON_SOCKET'] !== undefined && environment['OMNITRON_SOCKET'] !== path.join(home, 'daemon.sock') ||
      role !== 'daemon' && !environment['OMNITRON_HOME']) throw Error('Invalid native instance home or socket');
  const extra = Object.fromEntries(Object.entries(environment).filter(([key]) => !['HOME', 'PATH', 'OMNITRON_CWD'].includes(key)));
  if (Object.keys(extra).some(key => !['OMNITRON_HOME', 'OMNITRON_SOCKET', 'TMPDIR'].includes(key))) throw Error('Unrecognized native environment');
  const inputs: UnitInputs = { scope, execPath: argv[0]!, entryPath: argv[role === 'daemon' ? 3 : 1]!, workdir, path: environment['PATH'],
    stderrLog: stderr, stdoutLog: stdout, label, environment: extra,
    ...(scope === 'system' ? { identity: { user, home: environment['HOME']! } } : {}),
    ...(role === 'daemon' ? {} : { nodeArgs: [], args: [role] }),
    ...(role === 'owner' ? { restart: false, forceKill: false } : {}) };
  if (body !== (darwin ? renderLaunchdPlist(inputs) : renderSystemdUnit(inputs))) throw Error('Native definition differs from the installed Omnitron format');
  return { home, argv, environment, workdir, role, stderr, ...(user ? { account: user } : {}) };
}
