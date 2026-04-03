/**
 * Example: Using the Discovery Module in a Titan Application
 *
 * This example demonstrates how to use the service discovery module
 * to register services and discover other services in a distributed network.
 */

import { Application, createApp } from '../src/application.js';
import {
  createDiscoveryModule,
  DISCOVERY_SERVICE_TOKEN,
  type IDiscoveryService,
} from '../src/modules/discovery/index.js';

/**
 * Example 1: Basic Discovery Service Setup
 */
async function basicDiscoveryExample() {
  console.log('\n=== Basic Discovery Example ==="');

  // Create application with discovery module
  const app = await Application.create({
    name: 'discovery-app',
    modules: [
      createDiscoveryModule({
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        heartbeatInterval: 5000,
        heartbeatTTL: 15000,
        pubSubEnabled: true,
      }),
    ],
  });

  await app.start();

  // Get the discovery service
  const discovery = app.resolve<IDiscoveryService>(DISCOVERY_SERVICE_TOKEN);

  // Register this node with some services
  await discovery.registerNode('api-gateway-1', 'localhost:3000', [
    { name: 'api-gateway', version: '1.0.0' },
    { name: 'auth', version: '2.1.0' },
  ]);

  console.log('Node registered successfully');

  // Find other nodes providing a specific service
  const authNodes = await discovery.findNodesByService('auth');
  console.log('Found auth nodes:', authNodes);

  // Get all active nodes
  const activeNodes = await discovery.getActiveNodes();
  console.log('Active nodes in network:', activeNodes);

  // Wait a bit before shutting down
  await new Promise((resolve) => setTimeout(resolve, 10000));

  await app.stop();
}

/**
 * Example 2: Service Discovery with Event Listening
 */
async function eventBasedDiscoveryExample() {
  console.log('\n=== Event-Based Discovery Example ===');

  const app = await Application.create({
    name: 'discovery-event-app',
    modules: [
      createDiscoveryModule({
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        pubSubEnabled: true,
        clientMode: false, // This node will register itself
      }),
    ],
  });

  await app.start();

  const discovery = app.resolve<IDiscoveryService>(DISCOVERY_SERVICE_TOKEN);

  // Listen for discovery events
  discovery.onEvent((event) => {
    console.log('Discovery event received:', event);

    switch (event.type) {
      case 'NODE_REGISTERED':
        console.log(`New node joined: ${event.nodeId} at ${event.address}`);
        break;
      case 'NODE_UPDATED':
        console.log(`Node updated: ${event.nodeId}`);
        break;
      case 'NODE_DEREGISTERED':
        console.log(`Node left: ${event.nodeId}`);
        break;
    }
  });

  // Register this node
  await discovery.registerNode('worker-1', 'localhost:4000', [
    { name: 'task-processor', version: '1.0.0' },
    { name: 'reporting', version: '1.2.0' },
  ]);

  // Simulate service update
  setTimeout(async () => {
    await discovery.updateNodeServices('worker-1', [
      { name: 'task-processor', version: '1.1.0' }, // Updated version
      { name: 'reporting', version: '1.2.0' },
      { name: 'analytics', version: '0.9.0' }, // New service
    ]);
    console.log('Services updated');
  }, 5000);

  // Run for 20 seconds
  await new Promise((resolve) => setTimeout(resolve, 20000));

  await app.stop();
}

/**
 * Example 3: Client Mode Discovery (Read-Only)
 */
async function clientModeExample() {
  console.log('\n=== Client Mode Discovery Example ===');

  const app = await Application.create({
    name: 'discovery-client',
    modules: [
      createDiscoveryModule({
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        clientMode: true, // No heartbeat, just discovery
        pubSubEnabled: true,
      }),
    ],
  });

  await app.start();

  const discovery = app.resolve<IDiscoveryService>(DISCOVERY_SERVICE_TOKEN);

  // Monitor network periodically
  const monitor = setInterval(async () => {
    const nodes = await discovery.getActiveNodes();
    console.log(`\nActive nodes at ${new Date().toISOString()}:`);

    for (const node of nodes) {
      console.log(`- ${node.nodeId} (${node.address}):`);
      for (const service of node.services) {
        console.log(`  * ${service.name}${service.version ? '@' + service.version : ''}`);
      }
    }

    // Find specific services
    const taskProcessors = await discovery.findNodesByService('task-processor');
    if (taskProcessors.length > 0) {
      console.log(`\nFound ${taskProcessors.length} task processor(s)`);
    }
  }, 3000);

  // Run for 30 seconds
  await new Promise((resolve) => setTimeout(resolve, 30000));

  clearInterval(monitor);
  await app.stop();
}

/**
 * Example 4: Multi-Node Simulation
 */
async function multiNodeSimulation() {
  console.log('\n=== Multi-Node Simulation ===');

  const apps: Application[] = [];
  const services = [
    { id: 'api-1', address: 'localhost:3001', services: [{ name: 'api', version: '1.0' }] },
    { id: 'auth-1', address: 'localhost:3002', services: [{ name: 'auth', version: '2.0' }] },
    { id: 'db-1', address: 'localhost:3003', services: [{ name: 'database', version: '5.7' }] },
    { id: 'cache-1', address: 'localhost:3004', services: [{ name: 'cache', version: '6.2' }] },
  ];

  // Start all nodes
  for (const svc of services) {
    const app = await Application.create({
      name: svc.id,
      modules: [
        createDiscoveryModule({
          redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
          heartbeatInterval: 2000,
          heartbeatTTL: 6000,
          pubSubEnabled: true,
        }),
      ],
    });

    await app.start();
    apps.push(app);

    const discovery = app.resolve<IDiscoveryService>(DISCOVERY_SERVICE_TOKEN);
    await discovery.registerNode(svc.id, svc.address, svc.services);

    console.log(`Started node: ${svc.id}`);
  }

  // Wait for all nodes to register
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Query from first node
  const discovery = apps[0].resolve<IDiscoveryService>(DISCOVERY_SERVICE_TOKEN);
  const allNodes = await discovery.getActiveNodes();

  console.log('\nNetwork topology:');
  console.log(`Total nodes: ${allNodes.length}`);
  for (const node of allNodes) {
    console.log(`- ${node.nodeId}: ${node.services.map((s) => s.name).join(', ')}`);
  }

  // Simulate node failure
  console.log('\nSimulating node failure: stopping auth-1...');
  await apps[1].stop();
  apps.splice(1, 1);

  // Wait for heartbeat to expire
  await new Promise((resolve) => setTimeout(resolve, 7000));

  // Check network again
  const remainingNodes = await discovery.getActiveNodes();
  console.log(`\nRemaining nodes: ${remainingNodes.length}`);
  for (const node of remainingNodes) {
    console.log(`- ${node.nodeId}`);
  }

  // Clean up
  for (const app of apps) {
    await app.stop();
  }
}

/**
 * Main function to run examples
 */
async function main() {
  const example = process.argv[2] || 'basic';

  try {
    switch (example) {
      case 'basic':
        await basicDiscoveryExample();
        break;
      case 'events':
        await eventBasedDiscoveryExample();
        break;
      case 'client':
        await clientModeExample();
        break;
      case 'multi':
        await multiNodeSimulation();
        break;
      default:
        console.log('Usage: node discovery-example.js [basic|events|client|multi]');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
