import 'reflect-metadata';
import { createApp } from '@omnitron-dev/titan';

/**
 * Omnitron Backend Application
 *
 * The Meta-System for Fractal Coherent Computing
 *
 * Built on Titan's distributed architecture for scalable,
 * resilient service mesh that executes Flows at any scale.
 */
async function bootstrap() {
  const app = createApp({
    name: 'Omnitron Backend',
    version: '0.1.0',
  });

  // Register graceful shutdown handlers
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, starting graceful shutdown...`);
      await app.stop();
      process.exit(0);
    });
  }

  // Start application
  await app.start();

  const port = process.env['PORT'] || 8080;

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                         OMNITRON                               ║
║              The Meta-System for Fractal Computing            ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Backend Status: READY                                        ║
║  Runtime: Node.js ${process.version}                         ║
║  Environment: ${process.env['NODE_ENV'] || 'development'}    ║
║  Port: ${port}                                                ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
}

bootstrap().catch((error) => {
  console.error('Failed to start Omnitron backend:', error);
  process.exit(1);
});
