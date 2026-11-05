import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeSync } from 'node:fs';
import { writeEmergencyStderr } from '../../src/shared/emergency-output.js';

vi.mock('node:fs', async original => ({ ...await original<object>(), writeSync: vi.fn() }));
const write = vi.mocked(writeSync);

beforeEach(() => write.mockReset());

describe('emergency diagnostic output', () => {
  it('completes partial UTF-8 writes without repeating the written prefix', () => {
    const bytes = Buffer.from('ошибка\n');
    write.mockReturnValueOnce(3).mockReturnValueOnce(bytes.length - 3);
    writeEmergencyStderr(bytes);
    expect(write.mock.calls).toEqual([[2, bytes, 0, bytes.length], [2, bytes, 3, bytes.length - 3]]);
  });

  it.each(['ENOSPC', 'EPIPE', 'EAGAIN'])('reports %s immediately to the owning boundary', code => {
    const error = Object.assign(new Error(code), { code });
    write.mockImplementation(() => { throw error; });
    let caught: unknown;
    try { writeEmergencyStderr(Buffer.from('failure')); } catch (failure) { caught = failure; }
    const calls = write.mock.calls.length;
    write.mockReset();
    expect(caught).toBe(error);
    expect(calls).toBe(1);
  });

  it('bounds interrupted retries and rejects writes that stop making progress', () => {
    write.mockImplementation(() => { throw Object.assign(new Error('interrupted'), { code: 'EINTR' }); });
    expect(() => writeEmergencyStderr(Buffer.from('failure'))).toThrow('interrupted');
    expect(write).toHaveBeenCalledTimes(4);
    write.mockReturnValue(0);
    expect(() => writeEmergencyStderr(Buffer.from('failure'))).toThrow('no valid progress');
  });
});
