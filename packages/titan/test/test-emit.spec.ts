import { describe, it, expect, jest } from '@jest/globals';
import { createApp } from '../src/application.js';

describe('Test Emit', () => {
  it('should pass arguments correctly', () => {
    const app = createApp({
      disableGracefulShutdown: true,
      disableCoreModules: true,
    });

    const handler = jest.fn();
    app.on('custom', handler);

    const testData = { type: 'test', value: 123 };
    app.emit('custom', testData);

    console.log('Handler mock calls:', handler.mock.calls);
    console.log('First call args:', handler.mock.calls[0]);

    // The application adds metadata as the second argument
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0]).toEqual(testData);
    expect(handler.mock.calls[0][1]).toMatchObject({
      event: 'custom',
      source: 'application',
    });
  });
});
