/**
 * Basic Composition Examples
 *
 * Demonstrates how to use the ontological composition system
 * to safely compose components like LEGO bricks.
 *
 * @module ontology/examples/basic-composition
 */

import { Semantic, type UserId, type Timestamp } from '../core/brand-types.js';
import { Protocols } from '../core/protocols.js';
import { Capabilities, capability, capabilitySet, requirements } from '../core/capabilities.js';
import { component, composer, type Component, type ExecutionContext } from '../core/composition.js';

/**
 * Example 1: Data Processing Pipeline
 * DataSource → Transform → DataSink
 */

// Define semantic types for our domain
type UserData = {
  id: UserId;
  name: string;
  email: string;
  createdAt: Timestamp;
};

type ProcessedUserData = UserData & {
  processed: true;
  processedAt: Timestamp;
};

/**
 * DataSource Component - Reads user data
 */
const userDataSource = component<void, UserData[]>()
  .setId('component:datasource:users')
  .setName('User Data Source')
  .setVersion('1.0.0')
  .setInputType({ name: 'void' })
  .setOutputType({
    name: 'UserData[]',
    brand: 'UserData',
    shape: {
      id: { name: 'UserId', brand: 'UserId' },
      name: { name: 'string' },
      email: { name: 'string' },
      createdAt: { name: 'Timestamp', brand: 'Timestamp' },
    },
  })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.READ))
  .addCapability(capability(Capabilities.DATABASE))
  .setExecute(async (_, context: ExecutionContext) => {
    context.logger?.info('Reading user data from database');

    // Simulate database read
    return [
      {
        id: Semantic.userId('user-1'),
        name: 'Alice',
        email: 'alice@example.com',
        createdAt: Semantic.timestamp(Date.now()),
      },
      {
        id: Semantic.userId('user-2'),
        name: 'Bob',
        email: 'bob@example.com',
        createdAt: Semantic.timestamp(Date.now()),
      },
    ];
  })
  .setMetadata({
    description: 'Reads user data from the database',
    tags: ['data-source', 'users', 'database'],
    author: 'System',
  })
  .build();

/**
 * Transform Component - Processes user data
 */
const userDataTransformer = component<UserData[], ProcessedUserData[]>()
  .setId('component:transform:users')
  .setName('User Data Transformer')
  .setVersion('1.0.0')
  .setInputType({
    name: 'UserData[]',
    brand: 'UserData',
  })
  .setOutputType({
    name: 'ProcessedUserData[]',
    brand: 'ProcessedUserData',
  })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .addCapability(capability(Capabilities.STATELESS))
  .addRequirement(Capabilities.READ) // Requires a data source
  .setExecute(async (users: UserData[], context: ExecutionContext) => {
    context.logger?.info(`Processing ${users.length} users`);

    return users.map((user) => ({
      ...user,
      processed: true as const,
      processedAt: Semantic.timestamp(Date.now()),
    }));
  })
  .setMetadata({
    description: 'Transforms user data by adding processing metadata',
    tags: ['transform', 'users'],
  })
  .build();

/**
 * DataSink Component - Writes processed data
 */
const userDataSink = component<ProcessedUserData[], void>()
  .setId('component:datasink:users')
  .setName('User Data Sink')
  .setVersion('1.0.0')
  .setInputType({
    name: 'ProcessedUserData[]',
    brand: 'ProcessedUserData',
  })
  .setOutputType({ name: 'void' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.WRITE))
  .addCapability(capability(Capabilities.DATABASE))
  .addRequirement(Capabilities.TRANSFORM) // Requires transformed data
  .setExecute(async (users: ProcessedUserData[], context: ExecutionContext) => {
    context.logger?.info(`Writing ${users.length} processed users to database`);

    // Simulate database write
    for (const user of users) {
      context.logger?.debug('Writing user', { userId: user.id });
    }
  })
  .setMetadata({
    description: 'Writes processed user data to the database',
    tags: ['data-sink', 'users', 'database'],
  })
  .build();

/**
 * Example 2: Service Communication
 * Service A → RPC → Service B
 */

type ServiceRequest = {
  method: string;
  params: any;
};

type ServiceResponse = {
  result: any;
  error?: string;
};

/**
 * RPC Client Component
 */
const rpcClient = component<ServiceRequest, ServiceResponse>()
  .setId('component:rpc:client')
  .setName('RPC Client')
  .setVersion('1.0.0')
  .setInputType({
    name: 'ServiceRequest',
    shape: {
      method: { name: 'string' },
      params: { name: 'any' },
    },
  })
  .setOutputType({
    name: 'ServiceResponse',
    shape: {
      result: { name: 'any' },
      error: { name: 'string' },
    },
  })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.NETRON)
  .addCapability(capability(Capabilities.HTTP_CLIENT))
  .addCapability(capability(Capabilities.ASYNC))
  .setExecute(async (request: ServiceRequest, context: ExecutionContext) => {
    context.logger?.info(`Making RPC call: ${request.method}`);

    // Simulate RPC call
    return {
      result: { success: true, data: request.params },
    };
  })
  .setMetadata({
    description: 'Makes RPC calls to remote services',
    tags: ['rpc', 'client', 'network'],
  })
  .build();

/**
 * Example 3: Invalid Composition (Type Mismatch)
 */

type NumberData = number[];
type StringData = string[];

const numberSource = component<void, NumberData>()
  .setId('component:source:numbers')
  .setName('Number Source')
  .setVersion('1.0.0')
  .setInputType({ name: 'void' })
  .setOutputType({ name: 'number[]' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.READ))
  .setExecute(async () => [1, 2, 3, 4, 5])
  .setMetadata({ description: 'Generates numbers' })
  .build();

const stringProcessor = component<StringData, StringData>()
  .setId('component:process:strings')
  .setName('String Processor')
  .setVersion('1.0.0')
  .setInputType({ name: 'string[]' })
  .setOutputType({ name: 'string[]' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .setExecute(async (strings: StringData) => strings.map((s) => s.toUpperCase()))
  .setMetadata({ description: 'Processes strings' })
  .build();

/**
 * Example 4: Protocol Adaptation
 */

type JSONData = { value: any };
type MessagePackData = Uint8Array;

const jsonProducer = component<void, JSONData>()
  .setId('component:json:producer')
  .setName('JSON Producer')
  .setVersion('1.0.0')
  .setInputType({ name: 'void' })
  .setOutputType({ name: 'JSONData' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.READ))
  .setExecute(async () => ({ value: 'test data' }))
  .setMetadata({ description: 'Produces JSON data' })
  .build();

const msgpackConsumer = component<MessagePackData, void>()
  .setId('component:msgpack:consumer')
  .setName('MessagePack Consumer')
  .setVersion('1.0.0')
  .setInputType({ name: 'MessagePackData' })
  .setOutputType({ name: 'void' })
  .setInputProtocol(Protocols.MSGPACK)
  .setOutputProtocol(Protocols.MSGPACK)
  .addCapability(capability(Capabilities.WRITE))
  .setExecute(async (data: MessagePackData) => {
    console.log('Received MessagePack data:', data.length, 'bytes');
  })
  .setMetadata({ description: 'Consumes MessagePack data' })
  .build();

/**
 * Demo Function - Shows composition in action
 */
export async function demonstrateComposition() {
  console.log('=== Ontological Component Composition Demo ===\n');

  // Example 1: Valid composition (DataSource → Transform → DataSink)
  console.log('Example 1: Valid Composition');
  console.log('-----------------------------');

  try {
    // Compose step by step
    const sourceToTransform = composer.compose(userDataSource, userDataTransformer);
    console.log('✓ Composed:', sourceToTransform.visualize());

    const fullPipeline = composer.compose(sourceToTransform, userDataSink);
    console.log('✓ Composed:', fullPipeline.visualize());

    // Execute the pipeline
    const context: ExecutionContext = {
      correlationId: 'demo-1',
      timestamp: Date.now(),
      environment: {},
      logger: {
        debug: (msg, meta) => console.log('  [DEBUG]', msg, meta || ''),
        info: (msg, meta) => console.log('  [INFO]', msg, meta || ''),
        warn: (msg, meta) => console.log('  [WARN]', msg, meta || ''),
        error: (msg, meta) => console.log('  [ERROR]', msg, meta || ''),
      },
    };

    console.log('\nExecuting pipeline...');
    await fullPipeline.execute(undefined, context);
    console.log('✓ Pipeline executed successfully\n');
  } catch (error) {
    console.error('✗ Error:', (error as Error).message, '\n');
  }

  // Example 2: Invalid composition (Type mismatch)
  console.log('Example 2: Invalid Composition (Type Mismatch)');
  console.log('----------------------------------------------');

  try {
    const invalid = composer.compose(numberSource, stringProcessor);
    console.log('✗ This should not succeed!');
  } catch (error: any) {
    console.log('✓ Composition correctly rejected:', error.message);
    console.log('  Reason:', error.reason?.details);
    console.log('  Suggestion:', error.reason?.suggestion, '\n');
  }

  // Example 3: Protocol mismatch
  console.log('Example 3: Protocol Mismatch');
  console.log('----------------------------');

  try {
    const invalid = composer.compose(jsonProducer, msgpackConsumer as any);
    console.log('✗ This should not succeed!');
  } catch (error: any) {
    console.log('✓ Composition correctly rejected:', error.message);
    console.log('  Reason:', error.reason?.details);
    console.log('  Suggestion:', error.reason?.suggestion, '\n');
  }

  // Example 4: Auto-adaptation
  console.log('Example 4: Automatic Protocol Adaptation');
  console.log('----------------------------------------');

  try {
    const adapted = composer.composeWithAdaptation(jsonProducer, msgpackConsumer as any);

    if (adapted) {
      console.log('✓ Auto-adapted:', adapted.visualize());
      console.log('  Note: An adapter was inserted automatically\n');
    } else {
      console.log('✗ Could not auto-adapt (no adapter available)\n');
    }
  } catch (error: any) {
    console.log('✗ Error:', error.message, '\n');
  }

  console.log('=== Demo Complete ===');
}

/**
 * Export components for use in other examples
 */
export { userDataSource, userDataTransformer, userDataSink, rpcClient };
