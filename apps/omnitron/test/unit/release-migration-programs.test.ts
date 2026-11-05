import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IEcosystemConfig } from '../../src/config/types.js';
import { ArtifactBuilder } from '../../src/project/artifact-builder.js';
import { declaredMigrationPrograms, packedMigrationPrograms } from '../../src/release/migration-programs.js';
import { changedReleasedMigrations, releaseMigrationSources } from '../../src/release/migrations.js';

const roots: string[] = [];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-migration-program-'))); roots.push(root);
  const write = (name: string, value: string) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file;
  };
  const git = (...args: string[]) => execFileSync('git', ['-c','user.email=test@example.com','-c','user.name=test',...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  const workspace = path.join(root, 'portal');
  write('portal/package.json', '{}');
  write('portal/apps/api/package.json', JSON.stringify({ name:'@example/api', version:'1.0.0', type:'module', files:['dist'] }));
  write('portal/apps/api/src/database/registry.ts', 'export const versions = [1];');
  write('portal/apps/api/dist/main.mjs', 'throw Error("Application must not execute during provenance inspection");');
  write('portal/apps/api/dist/database/registry.js', 'throw Error("Migration must not execute during provenance inspection");');
  write('portal/apps/api/migrations/001.sql', 'select 1;');
  git('add', '.'); git('commit', '-qm', 'source');
  return { root, workspace, write, git, commit:git('rev-parse','HEAD') };
}
const program = { mode:'config' as const, source:'src/database/registry.ts', release:'dist/database/registry.js' };
function config(): IEcosystemConfig {
  return { ...DEFAULT_ECOSYSTEM, apps:[{ name:'api', script:'apps/api/dist/main.mjs' }], infrastructure:{ services:{ pg:{ preset:'postgres', config:{ databases:{ data:{ migrate:{ app:'api', config:program.source, releaseConfig:program.release } } } } } } },
    stacks:{ test:{ type:'local', apps:'all' }, production:{ type:'local', apps:'all' } } };
}

describe('declared migration program provenance', () => {
  it('uses the same named database ownership and stack overrides as deployment', () => {
    const input = config();
    expect(declaredMigrationPrograms(input).get('api')).toEqual([program]);
    input.stacks!['production']!.infrastructure = { services:{ pg:{ preset:'postgres', config:{ databases:{ data:{ migrate:false } } } } } };
    expect(declaredMigrationPrograms(input, 'production').size).toBe(0);
    expect(declaredMigrationPrograms(input, 'test').get('api')).toEqual([program]);
    expect(() => declaredMigrationPrograms(input,'absent')).toThrow('Unknown release migration stack');
    input.stacks!['test']!.apps = [];
    expect(() => declaredMigrationPrograms(input,'test')).toThrow('no unique application');
  });

  it('refuses different sources claiming the same packed migration entry', () => {
    const input = config();
    input.stacks!['production']!.infrastructure = { services:{ pg:{ preset:'postgres', config:{ databases:{ data:{ migrate:{ app:'api', config:'other.ts', releaseConfig:program.release } } } } } } };
    expect(() => declaredMigrationPrograms(input)).toThrow('Conflicting declared migration source');
  });

  it('captures nonconventional source names and the exact staged compiled bytes without evaluating either', async () => {
    const f = fixture(), packageRoot = path.join(f.workspace,'apps/api');
    const packed = await packedMigrationPrograms(packageRoot,[program]);
    const result = await releaseMigrationSources(f.workspace,f.commit,['apps/api'],packed.map(p => ({ ...p,directory:'apps/api' })));
    expect(result.packages.get('apps/api')?.migrationPrograms).toEqual([{ ...program,
      sourceBlob:f.git('rev-parse',f.commit+':portal/apps/api/'+program.source), sourceSha256:sha('export const versions = [1];'),
      releaseSha256:sha('throw Error("Migration must not execute during provenance inspection");'),
    }]);
    expect(result.migrations).toEqual({ 'apps/api/migrations/001.sql':sha('select 1;') });
  });

  it('allows a registry to add a migration without treating its configuration as an immutable applied migration', async () => {
    const f = fixture();
    const collect = async () => releaseMigrationSources(f.workspace,f.git('rev-parse','HEAD'),['apps/api'],
      (await packedMigrationPrograms(path.join(f.workspace,'apps/api'),[program])).map(p => ({ ...p,directory:'apps/api' })));
    const before = await collect();
    f.write('portal/apps/api/'+program.source,'export const versions = [1, 2];');
    f.write('portal/apps/api/migrations/002.sql','select 2;');
    f.git('add','.');f.git('commit','-qm','add a migration');
    const after = await collect();
    expect(after.packages.get('apps/api')?.migrationPrograms?.[0]?.sourceSha256).not.toBe(before.packages.get('apps/api')?.migrationPrograms?.[0]?.sourceSha256);
    expect(changedReleasedMigrations(before.migrations,after.migrations)).toEqual([]);
  });

  it('packs the declared modules through ArtifactBuilder and fingerprints the delivered copy', async () => {
    const f = fixture(), builder = new ArtifactBuilder(f.workspace,path.join(f.root,'artifacts'));
    const artifact = await builder.buildApp({ name:'api', cwd:'apps/api', script:'dist/main.mjs' },
      { skipBuild:true, releaseCheckouts:[f.root], migrationPrograms:declaredMigrationPrograms(config(),'test') });
    expect(artifact.migrationPrograms).toEqual([{ ...program,releaseSha256:sha('throw Error("Migration must not execute during provenance inspection");') }]);
    expect(artifact.launch?.closureSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.sourceDirectory).toBe('apps/api');
  });

  it.each(['missing','symlink'] as const)('refuses a %s compiled entry before sealing a release', async kind => {
    const f = fixture(), root = path.join(f.workspace,'apps/api'), file = path.join(root,program.release);
    fs.unlinkSync(file);
    if (kind === 'symlink') fs.symlinkSync(path.join(root,'dist/main.mjs'),file);
    await expect(packedMigrationPrograms(root,[program])).rejects.toThrow();
  });

  it.each(['changed','untracked','symlink','nested-package'] as const)('refuses %s source provenance at the named commit', async kind => {
    const f = fixture(), source = path.join(f.workspace,'apps/api',program.source);
    const packed = { ...program,releaseSha256:'a'.repeat(64),directory:'apps/api' };
    if (kind === 'changed') fs.writeFileSync(source,'export const replaced = true;');
    if (kind === 'untracked') packed.source = 'src/database/untracked.ts';
    if (kind === 'symlink') { fs.unlinkSync(source); fs.symlinkSync(path.join(f.workspace,'package.json'),source); }
    if (kind === 'nested-package') {
      f.write('portal/apps/api/src/database/package.json','{}');f.git('add','.');f.git('commit','-qm','nested package');f.commit=f.git('rev-parse','HEAD');
    }
    await expect(releaseMigrationSources(f.workspace,f.commit,['apps/api'],[packed])).rejects.toThrow(/differs|not tracked|physical/);
  });
});
