import { createApp } from '../src/application.js';

describe('Test Emit', () => {
  it('should pass arguments correctly', () => {
    const app = createApp({
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    const handler = jest.fn();
    app.on('custom', handler);

    const testData = { type: 'test', value: 123 };
    app.emit('custom', testData);

    console.log('Handler mock calls:', handler.mock.calls);
    console.log('First call args:', handler.mock.calls[0]);
    expect(handler).toHaveBeenCalledWith(testData);
  });
});
