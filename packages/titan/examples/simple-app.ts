/**
 * Simple Application Example
 *
 * Demonstrates the simplicity and power of Titan framework
 */

import { Application, Module, Injectable, OnStart, OnStop } from '../src/index.js';

// Simple service
@Injectable()
class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

// Simple module
@Module({
  providers: [GreetingService],
  exports: [GreetingService],
})
class AppModule implements OnStart, OnStop {
  constructor(private greeting: GreetingService) {}

  async onStart(): Promise<void> {
    console.log('App started!');
    console.log(this.greeting.greet('Titan Framework'));
  }

  async onStop(): Promise<void> {
    console.log('App stopped!');
  }
}

// Create and run application
async function main() {
  const app = await Application.create(AppModule, {
    name: 'simple-app',
    version: '1.0.0',
    logger: true,
    gracefulShutdown: true,
    registerCoreModules: false, // Use only what we need
  });

  await app.start();

  // Stop after 3 seconds
  setTimeout(async () => {
    await app.stop();
  }, 3000);
}

main().catch(console.error);
