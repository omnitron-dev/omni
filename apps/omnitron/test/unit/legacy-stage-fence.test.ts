import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { readLegacyStageRecords, withExistingStageGuards } from '../../src/commands/legacy-stage-fence.js';
import { inspectRegisteredStageFence, stageFenceRecipient } from '../../src/services/legacy-stage-fence.js';

const commandId = randomUUID(), bootId = randomUUID();
const token = randomUUID(), node = 'registered-example', pin = 'test-pin';
const recipient = stageFenceRecipient({ registrationId: node, expectedHostFingerprint: pin, host: 'example', label: 'test' });
const inspectorArtifact = 'f'.repeat(64);
const lease = { token, holder: 'example pid 11', stack: 'stage managed kernel', startedAt: new Date().toISOString() };
const intent = { schema: 1, id: commandId, token, timeoutMs: 600000 };
const leaseBytes = Buffer.from(JSON.stringify(lease)), executionBytes = Buffer.from(JSON.stringify(intent) + '\n');
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const native = { state:'unresolved-legacy-stage', bootId, machineIdSha256: 'e'.repeat(64),
  commandId, timeoutMs:600000, leaseSha256: digest(leaseBytes), executionSha256: digest(executionBytes) };

describe('legacy passive stage', () => {
  it('reads the exact native v1 and lease encodings without returning the bearer or guessing the command outcome', () => {
    const publicData = readLegacyStageRecords(leaseBytes,executionBytes);
    expect(publicData).toEqual({ commandId, timeoutMs:600000, leaseSha256:native.leaseSha256, executionSha256:native.executionSha256 });
    expect(JSON.stringify(publicData)).not.toContain(token);
  });
  it.each([
    [Buffer.from(JSON.stringify({ ...lease, stack:'managed kernel handoff' })), executionBytes],
    [leaseBytes, Buffer.from(JSON.stringify({ ...intent, token: randomUUID() }) + '\n')],
    [leaseBytes, Buffer.from(JSON.stringify({ ...intent, id: token }) + '\n')],
    [leaseBytes, Buffer.from(JSON.stringify({ ...intent, schema: 2 }) + '\n')],
    [leaseBytes, Buffer.from(JSON.stringify({ ...intent, timeoutMs: 0 }) + '\n')],
    [leaseBytes, Buffer.from(executionBytes.toString().replace('"schema":1', '"schema":2,"schema":1'))],
    [leaseBytes, Buffer.from(executionBytes.toString().trim())],
    [Buffer.from(leaseBytes.toString() + '\0'), executionBytes],
  ])('keeps malformed, foreign and unbound records outside this protocol', (before, command) => {
    expect(() => readLegacyStageRecords(before, command)).toThrow();
  });
  it('makes one fixed inspection call, allowlists result fields and suppresses recipient failure details', async () => {
    const read = vi.fn().mockResolvedValue({ code:0, stdout: JSON.stringify({ok:true,data:{ ...native, other:'private-test' }}) });
    await expect(inspectRegisteredStageFence(recipient, '../untrusted', read)).rejects.toThrow('Invalid inspector artifact');
    expect(read).not.toHaveBeenCalled();
    expect(await inspectRegisteredStageFence(recipient, inspectorArtifact, read)).toEqual({ ...native, ...recipient, inspectorArtifact });
    expect(read).toHaveBeenCalledTimes(1);
    const command = read.mock.calls[0]![0];
    expect(command).toContain('/root/.omnitron-maintenance/runtime/releases/' + inspectorArtifact + '/node');
    expect(command).toMatch(/\/packages\/0\/dist\/cli\/omnitron\.js --json service inspect-stage-fence$/);
    expect(command).not.toContain('/usr/local/bin');
    expect(command).not.toContain(token);
    for (const reply of [{code:127,stdout:'private-test'}, {code:0,stdout:'private-test'}, {code:0,stdout:JSON.stringify({ok:true,data:{...native,bootId:'pid-1'}})}]) {
      read.mockResolvedValueOnce(reply);
      await expect(inspectRegisteredStageFence(recipient, inspectorArtifact, read)).rejects.toThrow(/recipient administrative CLI|reply from the installed/);
    }
  });
  it.skipIf(process.platform !== 'linux')('actually excludes other workers from both kernel guards throughout the parent read, and releases on failure', () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'stage-fence-'));
    const names = ['deploy.guard','deploy.execution.guard'];
    try {
      for (const name of names) fs.writeFileSync(join(dir,name),'',{mode:0o600});
      const uid = process.getuid!();
      const check = (name: string) => spawnSync('/usr/bin/flock',['--nonblock','--conflict-exit-code','73',join(dir,name),'/bin/true']).status;
      expect(() => withExistingStageGuards(dir, uid, () => {
        for (const name of names) expect(check(name)).toBe(73);
        throw Error('test interruption');
      })).toThrow('test interruption');
      for (const name of names) expect(check(name)).toBe(0);
      const held = fs.openSync(join(dir, names[1]!), 'r');
      try {
        execFileSync('/usr/bin/flock', ['--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', held] });
        expect(() => withExistingStageGuards(dir, uid, () => { throw Error('unexpected read'); })).toThrow('guard is busy');
        expect(check(names[0]!)).toBe(0);
        expect(check(names[1]!)).toBe(73);
      } finally { fs.closeSync(held); }
      const completion = join(dir, 'deploy.execution.completed');
      fs.symlinkSync('absent-target', completion);
      expect(() => withExistingStageGuards(dir, uid, () => { throw Error('unexpected read'); })).toThrow('completion record is present');
      fs.unlinkSync(completion);
      expect(() => withExistingStageGuards(dir, uid, () => fs.writeFileSync(completion, 'witness'))).toThrow('completion record is present');
      fs.unlinkSync(completion);
      fs.linkSync(join(dir, names[0]!), join(dir, 'alias'));
      expect(() => withExistingStageGuards(dir, uid, () => { throw Error('unexpected read'); })).toThrow('Unsafe machine deployment guard');
      fs.unlinkSync(join(dir, 'alias'));
      fs.renameSync(join(dir,names[0]!),join(dir,'saved'));
      expect(() => withExistingStageGuards(dir,uid, () => { throw Error('unexpected read'); })).toThrow(/ENOENT/);
      expect(fs.existsSync(join(dir, names[0]!))).toBe(false);
      fs.symlinkSync('saved',join(dir,names[0]!));
      expect(() => withExistingStageGuards(dir,uid, () => { throw Error('unexpected read'); })).toThrow(/ELOOP/);
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
});
