import { describe, expect, it, vi } from 'vitest';
import { Application } from '@omnitron-dev/titan';
import { LumenModule, LumenService, AccessFilterService, LiveEditService } from './index.js';

describe('Lumen module lifecycle', () => {
  it('resolves configuration once through Titan and shares injected collaborators', async () => {
    const factory = vi.fn(async () => ({ docsDir: 'configured-documents' }));
    const module = LumenModule.forRootAsync({ useFactory: factory });
    expect(factory).not.toHaveBeenCalled();
    const app = await Application.create({ name: 'LumenModuleLifecycle', disableCoreModules: true, modules: [module] });
    try {
      const service = app.resolve(LumenService);
      expect(service.getOptions().docsDir).toBe('configured-documents');
      expect(app.resolve(LumenService)).toBe(service);
      expect(service.getAccessFilterService()).toBe(app.resolve(AccessFilterService));
      expect(service.getLiveEditService()).toBe(app.resolve(LiveEditService));
      expect(factory).toHaveBeenCalledTimes(1);
    } finally { await app.stop(); }
  });
});
