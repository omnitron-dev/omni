import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';

describe('logger destination delivery', () => {
  it('invokes an explicitly synchronous journal before the logging call returns', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _encoding, callback) { if (chunk.length) lines.push(String(chunk)); callback(); } });
    const logger = new LoggerService({ destinations: [{ stream, delivery: 'sync' }] });
    logger.logger.error({ event: 'startup' }, 'complete\n    at boot');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'startup', msg: 'complete\n    at boot' });
    await logger.flush();
    expect(lines).toHaveLength(1);
    stream.end();
  });

  it('flush waits for delayed destination callbacks and transport writes', async () => {
    const delivered: number[] = [], transported: number[] = [];
    const stream = new Writable({ highWaterMark: 1, write(chunk, _encoding, callback) {
      setTimeout(() => { if (chunk.length) delivered.push(JSON.parse(String(chunk)).sequence); callback(); }, 5);
    } });
    const logger = new LoggerService({ destinations: [stream], transports: [{ name: 'fixture', async write(record) {
      await new Promise(resolve => setTimeout(resolve, 5)); transported.push(record.sequence);
    } }] });
    for (let sequence = 0; sequence < 8; sequence++) logger.logger.info({ sequence }, 'message');
    expect(delivered).toEqual([]);
    await logger.flush();
    expect(delivered).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(transported).toEqual(delivered);
    stream.end();
  });
});
