import 'reflect-metadata';

// Load MockProcessSpawner globally for PM tests (if titan-pm is available).
// PM module was split into @omnitron-dev/titan-pm — import is optional.
try {
  const { AdvancedMockProcessSpawner } = await import('@omnitron-dev/testing/titan');
  const { ProcessSpawnerFactory } = await import('@omnitron-dev/titan-pm');

  (globalThis as any).__MockProcessSpawnerClass = AdvancedMockProcessSpawner;
  ProcessSpawnerFactory.setMockSpawner(AdvancedMockProcessSpawner);
} catch {
  // titan-pm not available as dependency — PM tests will be skipped
}
