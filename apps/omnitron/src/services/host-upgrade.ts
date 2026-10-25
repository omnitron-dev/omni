/** Controlled host upgrades. App deployments pin an installed bundle and never call this lifecycle. */
import { shellEscape } from '../shared/shell-escape.js';

export const HOST_UPGRADE_CONTRACT = 'omnitron.host-upgrade.json';
export interface InstalledBundle { root: string; version: string; commit: string }
export interface AppUpgradeContract {
  name: string;
  /** Immutable release directory, not a current symlink. Hooks must not replace source or application data. */
  cwd: string;
  version: string;
  /** Operational readiness, separate from dependency identity; required when this app is online. */
  health?: string[];
  binding: { kind: 'independent' } | {
    kind: 'hook'; bundleRoot: string; bundleEnv: string; rebind: string[]; verify: string[];
  };
}
export type HostRuntime = { kind: 'fork'; cwd: string } | {
  kind: 'systemd'; cwd: string; scope: 'system' | 'user'; file: string; contents: string; enabled: boolean;
};
export interface HostInventory {
  runtime: HostRuntime;
  status: { version: string; build: { commit: string; dirty: boolean }; pid: number; apps: { name: string; status: string }[] };
  projects: { name: string; path: string; enabledStacks: string[] }[];
  stacks: { project: string; path: string; stacks: {
    name: string; type: string; apps: { handleKey: string; status: string }[];
  }[] }[];
  contracts: { project: string; schema: number; apps: AppUpgradeContract[] }[];
}
export interface HostUpgradePlan {
  previous: InstalledBundle;
  candidate: InstalledBundle;
  inventory: HostInventory;
  apps: AppUpgradeContract[];
  online: string[];
  offline: string[];
}
export interface HostUpgradeReceipt {
  schema: 1; id: string; plan: HostUpgradePlan;
  phase: string; outcome: 'running' | 'upgraded' | 'rolled-back' | 'recovery-required';
  events: { at: string; phase: string; error?: string }[];
}

function fail(reason: string): never { throw new Error(`Host upgrade preflight: ${reason}`); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0); }
/** The native control-plane runtime contract currently binds the default daemon endpoint. */
export function assertControlledDaemonPort(port?: number): void {
  if (port !== undefined && port !== 9700) throw new Error('Controlled host operations currently require daemon port 9700');
}
export function assertServingBundle(bundle: InstalledBundle, status: HostInventory['status']): void {
  if (!status || status.build?.commit !== bundle.commit || status.build?.dirty !== false ||
      typeof status.version !== 'string' || status.version.split('+')[0] !== bundle.version.split('+')[0] ||
      !Number.isSafeInteger(status.pid) || status.pid <= 0 || !Array.isArray(status.apps)) {
    fail(`serving daemon does not match installed bundle ${bundle.root}`);
  }
}

/** Refuse configurations whose existing boot policy would start something previously offline. */
export function planHostUpgrade(previous: InstalledBundle, candidate: InstalledBundle, inventory: HostInventory): HostUpgradePlan {
  for (const bundle of [previous, candidate]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(bundle.version) || bundle.version.includes('..') ||
        !bundle.root?.startsWith('/') || !bundle.root.endsWith(`/versions/${bundle.version}`) || !/^[a-f0-9]{40}$/.test(bundle.commit)) fail('invalid recorded bundle identity');
  }
  assertServingBundle(previous, inventory.status);
  if (!inventory.runtime || !['fork', 'systemd'].includes(inventory.runtime.kind) || !inventory.runtime.cwd?.startsWith('/')) fail('missing supported runtime snapshot');
  if (!Array.isArray(inventory.projects) || !Array.isArray(inventory.stacks) || !Array.isArray(inventory.contracts)) fail('incomplete project inventory');
  const all = new Map<string, boolean>();
  const contracts = new Map<string, AppUpgradeContract>();
  const seenProjects = new Set<string>();
  for (const project of inventory.projects) {
    if (!project.name || seenProjects.has(project.name) || !strings(project.enabledStacks) || !project.path?.startsWith('/')) fail('invalid or duplicate project');
    seenProjects.add(project.name);
    const group = inventory.stacks.filter(s => s.project === project.name);
    if (group.length !== 1 || group[0]!.path !== project.path) fail(`missing stack inventory for ${project.name}`);
    const declarations = inventory.contracts.filter(c => c.project === project.name);
    const localApps = group[0]!.stacks.filter(s => s.type === 'local').flatMap(s => s.apps);
    if (localApps.length && (declarations.length !== 1 || declarations[0]!.schema !== 1 || !Array.isArray(declarations[0]!.apps))) fail(`${project.name} needs ${HOST_UPGRADE_CONTRACT} schema 1`);
    const seenStacks = new Set<string>();
    for (const stack of group[0]!.stacks) {
      if (seenStacks.has(stack.name)) fail(`duplicate stack ${project.name}/${stack.name}`);
      seenStacks.add(stack.name);
      const enabled = project.enabledStacks.includes(stack.name);
      if (stack.type !== 'local') {
        if (enabled) fail(`enabled ${stack.type} stack ${project.name}/${stack.name} cannot be restored locally`);
        continue;
      }
      for (const app of stack.apps) {
        if (!app.handleKey.startsWith(`${project.name}/${stack.name}/`) || all.has(app.handleKey)) fail('invalid or duplicate qualified app identity');
        if (!['online', 'stopped', 'errored', 'crashed'].includes(app.status)) fail(`unstable app ${app.handleKey}: ${app.status}`);
        const online = app.status === 'online';
        if (online !== enabled) fail(`${app.handleKey}: boot policy would change its online/offline state; partial enabled stacks are unsupported`);
        all.set(app.handleKey, online);
      }
    }
    if (project.enabledStacks.some(s => !seenStacks.has(s))) fail(`unknown enabled stack in ${project.name}`);
    for (const app of declarations[0]?.apps ?? []) {
      if (!app || typeof app.name !== 'string' || !app.name.startsWith(`${project.name}/`) || contracts.has(app.name) ||
          !app.cwd?.startsWith('/') || !app.version || !app.binding) fail('invalid or duplicate app contract');
      if (app.binding.kind === 'hook') {
        const b = app.binding;
        if (b.bundleRoot !== previous.root || !/^[A-Z_][A-Z0-9_]*$/.test(b.bundleEnv) ||
            ['PATH', 'HOME', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'SHELL'].includes(b.bundleEnv) ||
            !strings(b.rebind) || !b.rebind.length || !strings(b.verify) || !b.verify.length) fail(`unsupported or stale rebind contract for ${app.name}`);
      } else if (app.binding.kind !== 'independent') fail(`unsupported binding for ${app.name}`);
      contracts.set(app.name, app);
    }
  }
  if (inventory.stacks.length !== seenProjects.size || inventory.contracts.some(c => !seenProjects.has(c.project))) fail('unmatched project inventory');
  const seenHandles = new Set<string>();
  for (const app of inventory.status.apps) {
    if (seenHandles.has(app.name) || !all.has(app.name) || !['online', 'stopped', 'errored', 'crashed'].includes(app.status) ||
        all.get(app.name) !== (app.status === 'online')) fail(`unregistered, duplicate or inconsistent handle ${app.name}`);
    seenHandles.add(app.name);
  }
  for (const [name, online] of all) {
    if (!contracts.has(name)) fail(`missing explicit binding contract for ${name}`);
    if (online && (!strings(contracts.get(name)!.health) || !contracts.get(name)!.health!.length)) fail(`missing operational health command for ${name}`);
    if (online && !seenHandles.has(name)) fail(`online stack app ${name} is absent from daemon`);
  }
  if ([...contracts.keys()].some(name => !all.has(name))) fail('contract names an app absent from local stacks');
  return { previous, candidate, inventory, apps: [...contracts.values()],
    online: [...all].filter(([, online]) => online).map(([name]) => name).sort(),
    offline: [...all].filter(([, online]) => !online).map(([name]) => name).sort() };
}

export function verifyRestoredInventory(plan: HostUpgradePlan, bundle: InstalledBundle, status: HostInventory['status']): void {
  assertServingBundle(bundle, status);
  const online = status.apps.filter(a => a.status === 'online').map(a => a.name).sort();
  if (JSON.stringify(online) !== JSON.stringify(plan.online) || new Set(status.apps.map(a => a.name)).size !== status.apps.length ||
      status.apps.some(a => ![...plan.online, ...plan.offline].includes(a.name) || ['starting', 'stopping'].includes(a.status))) {
    throw new Error('Restored daemon does not have exactly the previously online apps');
  }
}

export interface HostUpgradeActions {
  save(receipt: HostUpgradeReceipt): Promise<void>;
  stop(bundle: InstalledBundle): Promise<void>;
  activate(bundle: InstalledBundle): Promise<void>;
  rebind(app: AppUpgradeContract, bundle: InstalledBundle): Promise<void>;
  start(bundle: InstalledBundle): Promise<void>;
  verify(bundle: InstalledBundle): Promise<void>;
  /** Retention must protect previous and candidate, even when keep=1. */
  prune(protectedRoots: string[]): Promise<void>;
}

/** Save intent before mutation; rollback only the framework and dependency bindings, never app releases/data. */
export async function executeHostUpgrade(plan: HostUpgradePlan, id: string, actions: HostUpgradeActions): Promise<HostUpgradeReceipt> {
  const receipt: HostUpgradeReceipt = { schema: 1, id, plan, phase: 'prepared', outcome: 'running', events: [] };
  const record = async (phase: string, error?: unknown) => {
    receipt.phase = phase;
    receipt.events.push({ at: new Date().toISOString(), phase, ...(error ? { error: String(error) } : {}) });
    await actions.save(receipt);
  };
  await record('prepared'); // If this fails there must be no mutation.
  try {
    await record('stopping'); await actions.stop(plan.previous);
    await record('activating'); await actions.activate(plan.candidate);
    await record('rebinding');
    for (const app of plan.apps) await actions.rebind(app, plan.candidate);
    await record('starting'); await actions.start(plan.candidate);
    await record('verifying'); await actions.verify(plan.candidate);
    receipt.outcome = 'upgraded'; await record('verified');
  } catch (error) {
    // A failed terminal write may have left either the old or the new bytes.
    // Rollback intent must always be discoverable as unfinished after a crash.
    receipt.outcome = 'running';
    // Record loss must not prevent recovery. All failed writes remain in the returned receipt.
    try { await record('rollback', error); } catch (writeError) { receipt.events.push({ at: new Date().toISOString(), phase: 'receipt-write-failed', error: String(writeError) }); }
    return recoverHostUpgrade(receipt, actions);
  }
  try { await actions.prune([plan.previous.root, plan.candidate.root]); await record('retained'); }
  catch (error) { try { await record('retention-failed', error); } catch { /* verified upgrade remains successful */ } }
  return receipt;
}

/** Idempotent recovery of an interrupted operation, including a controller lost between phase writes. */
export async function recoverHostUpgrade(receipt: HostUpgradeReceipt, actions: HostUpgradeActions): Promise<HostUpgradeReceipt> {
  const record = async (phase: string, error?: unknown) => {
    receipt.phase = phase;
    receipt.events.push({ at: new Date().toISOString(), phase, ...(error ? { error: String(error) } : {}) });
    await actions.save(receipt);
  };
  try {
    receipt.outcome = 'running';
    await record('recovering');
    await actions.stop(receipt.plan.candidate);
    await actions.activate(receipt.plan.previous);
    for (const app of receipt.plan.apps) await actions.rebind(app, receipt.plan.previous);
    await actions.start(receipt.plan.previous);
    await actions.verify(receipt.plan.previous);
    receipt.outcome = 'rolled-back'; await record('rolled-back');
  } catch (error) {
    receipt.outcome = 'recovery-required';
    try { await record('recovery-required', error); } catch { /* original durable intent remains */ }
  }
  return receipt;
}

export function appHealthCommand(app: AppUpgradeContract, bundle: InstalledBundle): string {
  if (!app.health?.length) throw new Error(`No operational health command for ${app.name}`);
  return remoteNode(`${fsPrelude} import {execFileSync} from 'node:child_process';
    const cwd=${JSON.stringify(app.cwd)};
    if(fs.realpathSync(cwd)!==cwd) throw Error('Release cwd changed or is not immutable');
    const argv=${JSON.stringify(app.health)};
    execFileSync(argv[0],argv.slice(1),{cwd,env:{...process.env,...${JSON.stringify(app.binding.kind === 'hook' ? { [app.binding.bundleEnv]: bundle.root } : {})}},stdio:'inherit',timeout:300000});`);
}

export function pendingReceiptsCommand(prefix: string, id?: string): string {
  if (id !== undefined && !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid host upgrade receipt ID');
  return remoteNode(`${fsPrelude}
    const dir=${JSON.stringify(`${prefix}/upgrade-receipts`)};
    const ids=${id === undefined ? "fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')):[]" : JSON.stringify([`${id}.json`])};
    const records=ids.map(name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')));
    if(records.some(r=>r.schema!==1 || !r.plan || !Array.isArray(r.events))) throw Error('Invalid host upgrade receipt');
    console.log(JSON.stringify(records.filter(r=>['running','recovery-required'].includes(r.outcome))));`);
}

/** Every program argument is quoted as data; declared hooks run without shell interpolation. */
export function remoteNode(source: string): string { return `node --input-type=module -e ${shellEscape(source)}`; }
const fsPrelude = `import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';`;
export function bundleProbeCommand(prefix: string, version?: string): string {
  return remoteNode(`${fsPrelude}
    const prefix=fs.realpathSync(${JSON.stringify(prefix)});
    if(prefix!==${JSON.stringify(prefix)}) throw Error('Installation prefix must be canonical');
    const root=fs.realpathSync(path.join(prefix,${JSON.stringify(version ? `versions/${version}` : 'current')}));
    if(path.dirname(root)!==path.join(prefix,'versions')) throw Error('Bundle is not an immutable installed version');
    const meta=JSON.parse(fs.readFileSync(path.join(root,'BUNDLE.json'),'utf8'));
    const stamp=JSON.parse(fs.readFileSync(path.join(root,'dist/BUILD.json'),'utf8'));
    const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
    if(meta.dirty!==false || stamp.dirty!==false || !/^[a-f0-9]{40}$/.test(meta.commit) || stamp.commit!==meta.commit ||
       meta.version!==path.basename(root) || pkg.version!==meta.version) throw Error('Inconsistent bundle metadata');
    fs.accessSync(path.join(root,'dist/cli/omnitron.js'),fs.constants.X_OK);
    console.log(JSON.stringify({root,version:meta.version,commit:meta.commit}));`);
}
export function inventoryCommand(bundle: InstalledBundle, full: boolean): string {
  return remoteNode(`${fsPrelude}
    const {createDaemonClient}=await import(pathToFileURL(${JSON.stringify(`${bundle.root}/dist/daemon/daemon-client.js`)}).href);
    const client=createDaemonClient();
    try {
      const status=await client.status();
      ${full ? `const service=await client.service('OmnitronProject');
      const projects=await service.listProjects(); const stacks=[]; const contracts=[];
      for(const project of projects){
        stacks.push({project:project.name,path:project.path,stacks:await service.listStacks({project:project.name})});
        const file=path.join(project.path,${JSON.stringify(HOST_UPGRADE_CONTRACT)});
        if(fs.existsSync(file)) contracts.push({...JSON.parse(fs.readFileSync(file,'utf8')),project:project.name});
      }
      console.log(JSON.stringify({status,projects,stacks,contracts}));` : 'console.log(JSON.stringify(status));'}
    } finally { await client.disconnect(); }`);
}
export function hookCommand(app: AppUpgradeContract, bundle: InstalledBundle, operation: 'rebind' | 'verify'): string {
  if (app.binding.kind === 'independent') return 'true';
  return remoteNode(`${fsPrelude} import {execFileSync} from 'node:child_process';
    const cwd=${JSON.stringify(app.cwd)};
    if(fs.realpathSync(cwd)!==cwd) throw Error('Release cwd changed or is not immutable');
    const argv=${JSON.stringify(app.binding[operation])};
    execFileSync(argv[0],argv.slice(1),{cwd,env:{...process.env,[${JSON.stringify(app.binding.bundleEnv)}]:${JSON.stringify(bundle.root)}},stdio:'inherit',timeout:300000});`);
}
export function receiptCommand(prefix: string, receipt: HostUpgradeReceipt): string {
  return remoteNode(`${fsPrelude}
    const dir=${JSON.stringify(`${prefix}/upgrade-receipts`)}; fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,${JSON.stringify(`${receipt.id}.json`)}); const temporary=file+'.part';
    const fd=fs.openSync(temporary,'w',0o600);
    try { fs.writeFileSync(fd,${JSON.stringify(JSON.stringify(receipt, null, 2) + '\n')}); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary,file); const directory=fs.openSync(dir,'r'); try{fs.fsyncSync(directory)}finally{fs.closeSync(directory)};`);
}
export function contractPreflightCommand(apps: AppUpgradeContract[]): string {
  return remoteNode(`${fsPrelude}
    for(const app of ${JSON.stringify(apps)}){
      if(fs.realpathSync(app.cwd)!==app.cwd || !fs.statSync(app.cwd).isDirectory()) throw Error('Release cwd is not immutable: '+app.name);
      for(const argv of [...(app.binding.kind==='hook'?[app.binding.rebind,app.binding.verify]:[]),...(app.health?[app.health]:[])]) {
        const executable=argv[0];
        const candidates=executable.includes('/') ? [path.resolve(app.cwd,executable)] : (process.env.PATH||'').split(':').filter(Boolean).map(p=>path.join(p,executable));
        if(!candidates.some(p=>{try{fs.accessSync(p,fs.constants.X_OK);return fs.statSync(p).isFile()}catch{return false}})) throw Error('Missing hook executable: '+executable);
      }
    }`);
}

/** Only the declared dependency binding changes; release paths, versions, and app data stay intact. */
export function updateContractBindingsCommand(plan: HostUpgradePlan, bundle: InstalledBundle): string {
  return remoteNode(`${fsPrelude}
    for(const project of ${JSON.stringify(plan.inventory.projects)}) {
      const file=path.join(project.path,${JSON.stringify(HOST_UPGRADE_CONTRACT)});
      if(!fs.existsSync(file)) continue;
      const document=JSON.parse(fs.readFileSync(file,'utf8'));
      const expected=${JSON.stringify(plan.apps)}.filter(a=>a.name.startsWith(project.name+'/'));
      if(document.schema!==1 || !Array.isArray(document.apps) || document.apps.length!==expected.length) throw Error('App contract changed during upgrade');
      for(const app of document.apps) {
        const original=expected.find(a=>a.name===app.name);
        const normalized=JSON.parse(JSON.stringify(app));
        if(normalized.binding.kind==='hook') normalized.binding.bundleRoot=${JSON.stringify(plan.previous.root)};
        if(JSON.stringify(normalized)!==JSON.stringify(original)) throw Error('App release contract changed during upgrade: '+app.name);
        if(app.binding.kind==='hook') app.binding.bundleRoot=${JSON.stringify(bundle.root)};
      }
      const temporary=file+'.upgrade-part'; const fd=fs.openSync(temporary,'w',0o600);
      try {fs.writeFileSync(fd,JSON.stringify(document,null,2));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
      fs.renameSync(temporary,file);
    }`);
}

/** Linux process identity + supervisor state. Other platforms and custom/drop-in units fail closed. */
export function runtimeProbeCommand(bundle: InstalledBundle, pid: number): string {
  return remoteNode(`${fsPrelude} import os from 'node:os'; import {execFileSync} from 'node:child_process';
    if(process.platform!=='linux') throw Error('Controlled host upgrade currently requires Linux runtime inspection');
    const root=${JSON.stringify(bundle.root)}; const pid=${JSON.stringify(pid)};
    const argv=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0').filter(Boolean);
    const entry=argv.find(a=>a.endsWith('/dist/daemon/daemon-entry.js'));
    if(!entry || fs.realpathSync(entry)!==root+'/dist/daemon/daemon-entry.js') throw Error('Serving daemon entry does not bind installed bundle');
    const cwd=fs.realpathSync('/proc/'+pid+'/cwd');
    const candidates=[{scope:'system',file:'/etc/systemd/system/omnitron-daemon.service'},{scope:'user',file:path.join(os.homedir(),'.config/systemd/user/omnitron-daemon.service')}].filter(c=>fs.existsSync(c.file));
    if(candidates.length>1) throw Error('Multiple supervisor scopes are unsupported');
    if(!candidates.length) { console.log(JSON.stringify({kind:'fork',cwd})); }
    else {
      const unit=candidates[0]; const args=unit.scope==='user'?['--user']:[];
      const output=execFileSync('systemctl',[...args,'show','omnitron-daemon.service','--property=MainPID,ActiveState,UnitFileState,FragmentPath,DropInPaths'],{encoding:'utf8'});
      const properties=Object.fromEntries(output.trim().split('\\n').map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
      if(properties.MainPID!==String(pid) || properties.ActiveState!=='active' || properties.FragmentPath!==unit.file || properties.DropInPaths || !['enabled','disabled'].includes(properties.UnitFileState)) throw Error('Supervisor does not own the serving daemon, or has unsupported overrides');
      const contents=fs.readFileSync(unit.file,'utf8');
      const lines=contents.split('\\n'); const exec=lines.filter(l=>l.startsWith('ExecStart=')); const wd=lines.filter(l=>l.startsWith('WorkingDirectory='));
      const aliases=[root,path.dirname(path.dirname(root))+'/current'];
      if(exec.length!==1 || wd.length!==1 || !aliases.some(p=>exec[0].includes(p+'/dist/daemon/daemon-entry.js')) || !aliases.some(p=>wd[0]==='WorkingDirectory='+p)) throw Error('Unsupported supervisor framework binding');
      const operatorCwd=lines.filter(l=>/^Environment="?OMNITRON_CWD=/.test(l));
      if(operatorCwd.length!==1 || !aliases.some(p=>operatorCwd[0]==='Environment=OMNITRON_CWD='+p || operatorCwd[0]==='Environment="OMNITRON_CWD='+p+'"')) throw Error('Unsupported supervisor operator cwd');
      if(lines.some(l=>!l.startsWith('ExecStart=')&&!l.startsWith('WorkingDirectory=')&&!/^Environment="?OMNITRON_CWD=/.test(l)&&l.includes(root))) throw Error('Additional static framework paths in service need an explicit migration');
      console.log(JSON.stringify({kind:'systemd',cwd,...unit,contents,enabled:properties.UnitFileState==='enabled'}));
    }`);
}
export function runtimeStopCommand(runtime: HostRuntime, bundle: InstalledBundle): string {
  if (runtime.kind === 'fork') return `${shellEscape(`${bundle.root}/dist/cli/omnitron.js`)} down`;
  return `systemctl ${runtime.scope === 'user' ? '--user ' : ''}stop omnitron-daemon.service`;
}
export function runtimeStartCommand(runtime: HostRuntime, previous: InstalledBundle, bundle: InstalledBundle, allowedCurrentRoots: string[] = [previous.root, bundle.root]): string {
  if (runtime.kind === 'fork') return `cd ${shellEscape(runtime.cwd === previous.root ? bundle.root : runtime.cwd)} && ${shellEscape(`${bundle.root}/dist/cli/omnitron.js`)} up --no-infra`;
  return remoteNode(`${fsPrelude} import {execFileSync} from 'node:child_process';
    const original=${JSON.stringify(runtime.contents)};
    const render=root=>original.split('\\n').map(l=>(l.startsWith('ExecStart=')||l.startsWith('WorkingDirectory=')||/^Environment="?OMNITRON_CWD=/.test(l))?l.split(${JSON.stringify(previous.root)}).join(root):l).join('\\n');
    const content=render(${JSON.stringify(bundle.root)});
    const file=${JSON.stringify(runtime.file)};
    if(!${JSON.stringify(allowedCurrentRoots)}.map(render).includes(fs.readFileSync(file,'utf8'))) throw Error('Supervisor unit changed outside the captured host operation');
    const mode=fs.statSync(file).mode & 0o777;
    const temporary=file+'.upgrade-part'; const fd=fs.openSync(temporary,'w',mode);
    try{fs.writeFileSync(fd,content);fs.fsyncSync(fd)}finally{fs.closeSync(fd)} fs.renameSync(temporary,file);
    const scope=${JSON.stringify(runtime.scope === 'user' ? ['--user'] : [])};
    execFileSync('systemctl',[...scope,'daemon-reload'],{stdio:'inherit'});
    execFileSync('systemctl',[...scope,${JSON.stringify(runtime.enabled ? 'enable' : 'disable')},'omnitron-daemon.service'],{stdio:'inherit'});
    execFileSync('systemctl',[...scope,'start','omnitron-daemon.service'],{stdio:'inherit'});`);
}

/** A successful CLI exit is insufficient: prove its native PID owner is no longer alive before rebinding. */
export function stoppedDaemonCommand(bundle: InstalledBundle): string {
  return remoteNode(`${fsPrelude}
    const base=${JSON.stringify(bundle.root)};
    const {PidManager}=await import(pathToFileURL(base+'/dist/daemon/pid-manager.js').href);
    const {DEFAULT_DAEMON_CONFIG}=await import(pathToFileURL(base+'/dist/config/defaults.js').href);
    const {expandPath}=await import(pathToFileURL(base+'/dist/shared/paths.js').href);
    const pid=new PidManager(expandPath(DEFAULT_DAEMON_CONFIG.pidFile)).getPid();
    if(pid && PidManager.isProcessAlive(pid)) throw Error('Daemon still owns a live PID after stop; refusing to change bindings');`);
}
