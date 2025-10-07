/**
 * Basic Netron Client Usage Example
 * Demonstrates simple WebSocket connection and service calls
 */

import { NetronClient } from '@omnitron-dev/aether/netron';

// Define service interface for type safety
interface CalculatorService {
  add(a: number, b: number): Promise<number>;
  subtract(a: number, b: number): Promise<number>;
  multiply(a: number, b: number): Promise<number>;
  divide(a: number, b: number): Promise<number>;
}

async function main() {
  console.log('=== Netron Basic Usage Example ===\n');

  // 1. Create client
  console.log('Creating Netron client...');
  const client = new NetronClient({
    url: 'ws://localhost:3000',
    timeout: 30000,
  });

  try {
    // 2. Connect to server
    console.log('Connecting to Netron server...');
    await client.connect();
    console.log('✓ Connected successfully\n');

    // 3. Query service interface
    console.log('Querying Calculator service...');
    const calculator = await client.queryInterface<CalculatorService>('Calculator@1.0.0');
    console.log('✓ Service interface acquired\n');

    // 4. Call service methods
    console.log('Calling service methods:');

    const sum = await calculator.add(10, 5);
    console.log(`  add(10, 5) = ${sum}`);

    const difference = await calculator.subtract(10, 5);
    console.log(`  subtract(10, 5) = ${difference}`);

    const product = await calculator.multiply(10, 5);
    console.log(`  multiply(10, 5) = ${product}`);

    const quotient = await calculator.divide(10, 5);
    console.log(`  divide(10, 5) = ${quotient}`);

    console.log('\n✓ All operations completed successfully');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // 5. Clean up
    console.log('\nDisconnecting...');
    await client.disconnect();
    console.log('✓ Disconnected');
  }
}

// Run example
main().catch(console.error);
