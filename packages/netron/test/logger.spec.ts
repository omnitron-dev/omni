import { LoggerOptions } from 'pino';
import { Writable } from 'node:stream';
import { delay } from '@omnitron-dev/common';

import { Netron } from '../src/index.js';

describe('Netron Logger Configuration Tests', () => {
  let logs: string[];
  let writable: Writable;

  beforeEach(() => {
    logs = [];
    writable = new Writable({
      write(chunk, encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });
  });
  const createLoggerOptions = (opts: Partial<LoggerOptions>): LoggerOptions => ({
    level: 'info',
    ...opts,
  });

  it('Default logger level should be info', async () => {
    const netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 0,
      loggerOptions: createLoggerOptions({}),
      loggerDestination: writable,
    });

    netron.logger.debug('This debug log should not appear');
    netron.logger.info('This info log should appear');

    await delay(100);
    expect(logs.some((log) => log.includes('debug'))).toBeFalsy();
    expect(logs.some((log) => log.includes('This info log should appear'))).toBeTruthy();

    await netron.stop();
  });

  it('Logger respects custom log level (debug)', async () => {
    const netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 0,
      loggerOptions: createLoggerOptions({ level: 'debug' }),
      loggerDestination: writable,
    });

    netron.logger.debug('Debug message should appear');
    netron.logger.trace('Trace message should not appear');

    await delay(100);

    expect(logs.some((log) => log.includes('Debug message should appear'))).toBeTruthy();
    expect(logs.some((log) => log.includes('Trace message should not appear'))).toBeFalsy();

    await netron.stop();
  });

  it('Logger outputs formatted messages with context', async () => {
    const netron = await Netron.create({
      id: 'test-peer-id',
      listenHost: 'localhost',
      listenPort: 0,
      loggerOptions: createLoggerOptions({}),
      loggerDestination: writable,
      loggerContext: {
        peerId: 'test-peer-id',
      },
    });

    netron.logger.info({ customField: 'customValue' }, 'Log with context');

    await delay(100);

    const logEntry = logs.find((log) => log.includes('Log with context'));

    expect(logEntry).toBeDefined();
    expect(logEntry).toContain('customValue');
    expect(logEntry).toContain(netron.id);

    await netron.stop();
  });

  it('Logger handles invalid logger options gracefully', async () => {
    await expect(
      Netron.create({
        loggerOptions: createLoggerOptions({ level: 'invalid-level' as any }),
        loggerDestination: writable,
      })
    ).rejects.toThrow();
  });

  it('Logger child context works correctly', async () => {
    const netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 0,
      loggerOptions: createLoggerOptions({ level: 'info' }),
      loggerDestination: writable,
    });

    const childLogger = netron.logger.child({ requestId: 'req-123' });
    childLogger.info('Child logger message');

    await delay(100);

    const logEntry = logs.find((log) => log.includes('Child logger message'));
    expect(logEntry).toBeDefined();
    expect(logEntry).toContain('req-123');

    await netron.stop();
  });
});
