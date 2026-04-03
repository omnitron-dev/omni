/**
 * Example demonstrating the improved NetronReadableStream features
 *
 * This example showcases:
 * 1. Backpressure mechanism with configurable high water mark
 * 2. State machine lifecycle management
 * 3. Memory tracking and metrics
 * 4. Error handling with severity levels
 * 5. Pause/resume functionality
 */

import {
  NetronReadableStream,
  StreamState,
  ErrorSeverity,
  type NetronReadableStreamOptions,
  type StreamMetrics,
} from '../src/core/readable-stream.js';

// Mock peer object for demonstration
const mockPeer = {
  logger: console,
  readableStreams: new Map(),
  options: {
    streamTimeout: 30000, // 30 seconds
  },
};

// Example 1: Basic stream with custom configuration
function example1_BasicStreamWithConfig() {
  console.log('\n=== Example 1: Basic Stream with Custom Configuration ===\n');

  const stream = new NetronReadableStream({
    peer: mockPeer,
    streamId: 1,
    isLive: false,
    highWaterMark: 10, // Trigger backpressure when buffer has 10 packets
    maxBufferSize: 100, // Maximum 100 packets in buffer
    onError: (error, severity) => {
      console.log(`Error callback: ${error.message}, Severity: ${severity}`);
    },
  });

  // Subscribe to events
  stream.on('stateChange', ({ oldState, newState }) => {
    console.log(`State changed: ${oldState} -> ${newState}`);
  });

  stream.on('backpressure', ({ bufferSize, highWaterMark }) => {
    console.log(`Backpressure detected! Buffer: ${bufferSize}, High Water Mark: ${highWaterMark}`);
  });

  stream.on('resume', () => {
    console.log('Stream resumed after backpressure');
  });

  return stream;
}

// Example 2: Monitoring stream metrics
function example2_MonitorMetrics(stream: NetronReadableStream) {
  console.log('\n=== Example 2: Monitoring Stream Metrics ===\n');

  // Get metrics periodically
  const metricsInterval = setInterval(() => {
    const metrics: StreamMetrics = stream.getMetrics();

    console.log('Current Metrics:');
    console.log(`  Bytes Received: ${metrics.bytesReceived}`);
    console.log(`  Packets Received: ${metrics.packetsReceived}`);
    console.log(`  Backpressure Events: ${metrics.backpressureEvents}`);
    console.log(`  Buffer Peak Size: ${metrics.bufferPeakSize}`);
    console.log(`  Current Buffer Size: ${metrics.currentBufferSize}`);
    console.log(`  Estimated Memory Usage: ${metrics.estimatedMemoryUsage} bytes`);
    console.log(`  State: ${metrics.state}`);
    console.log(`  Is Paused: ${metrics.isPaused}`);
    console.log('---');
  }, 5000);

  // Clean up after 30 seconds
  setTimeout(() => {
    clearInterval(metricsInterval);
  }, 30000);
}

// Example 3: Pause and resume functionality
function example3_PauseResume(stream: NetronReadableStream) {
  console.log('\n=== Example 3: Manual Pause/Resume ===\n');

  console.log(`Current state: ${stream.getState()}`);
  console.log(`Is paused: ${stream.isPaused}`);
  console.log(`Desired size: ${stream.desiredSize}`);

  // Manually pause the stream
  console.log('\nManually pausing stream...');
  stream.pause();
  console.log(`State after pause: ${stream.getState()}`);
  console.log(`Is paused: ${stream.isPaused}`);

  // Resume after 5 seconds
  setTimeout(() => {
    console.log('\nResuming stream...');
    stream.resume();
    console.log(`State after resume: ${stream.getState()}`);
    console.log(`Is paused: ${stream.isPaused}`);
  }, 5000);
}

// Example 4: State machine transitions
function example4_StateTransitions(stream: NetronReadableStream) {
  console.log('\n=== Example 4: State Machine Transitions ===\n');

  // Subscribe to all state changes
  stream.on('stateChange', ({ oldState, newState }) => {
    console.log(`[State Transition] ${oldState} -> ${newState}`);

    // Valid transitions from the state machine:
    const validTransitions = {
      IDLE: ['ACTIVE', 'CLOSED', 'ERROR'],
      ACTIVE: ['PAUSED', 'CLOSING', 'CLOSED', 'ERROR'],
      PAUSED: ['ACTIVE', 'CLOSING', 'ERROR'],
      CLOSING: ['CLOSED', 'ERROR'],
      CLOSED: [],
      ERROR: ['CLOSED'],
    };

    console.log(`  Valid next states from ${newState}:`, validTransitions[newState]);
  });

  console.log(`Initial state: ${stream.getState()}`);
}

// Example 5: Error handling with severity
function example5_ErrorHandling() {
  console.log('\n=== Example 5: Error Handling with Severity ===\n');

  const stream = new NetronReadableStream({
    peer: mockPeer,
    streamId: 5,
    isLive: false,
    onError: (error, severity) => {
      if (severity === ErrorSeverity.RECOVERABLE) {
        console.log(`⚠️  Recoverable error: ${error.message}`);
        console.log('   Stream continues operation');
      } else if (severity === ErrorSeverity.FATAL) {
        console.log(`❌ Fatal error: ${error.message}`);
        console.log('   Stream will be destroyed');
      }
    },
  });

  // Recoverable errors don't destroy the stream
  stream.on('error', (error) => {
    console.log(`Error event emitted: ${error.message}`);
    console.log(`Stream state: ${stream.getState()}`);
  });

  return stream;
}

// Example 6: Memory management and buffer cleanup
function example6_MemoryManagement(stream: NetronReadableStream) {
  console.log('\n=== Example 6: Memory Management ===\n');

  // Monitor memory usage
  const memoryInterval = setInterval(() => {
    const metrics = stream.getMetrics();
    const memoryMB = (metrics.estimatedMemoryUsage / 1024 / 1024).toFixed(2);

    console.log(`Memory Usage: ${memoryMB} MB`);
    console.log(`Buffer Size: ${metrics.currentBufferSize} packets`);
    console.log(`Peak Buffer: ${metrics.bufferPeakSize} packets`);

    // Periodic buffer cleanup runs automatically every 30 seconds for non-live streams
    // It removes stale packets that are far behind the expected index
  }, 10000);

  setTimeout(() => {
    clearInterval(memoryInterval);
  }, 60000);
}

// Example 7: Complete workflow with packet simulation
async function example7_CompleteWorkflow() {
  console.log('\n=== Example 7: Complete Workflow ===\n');

  const stream = new NetronReadableStream({
    peer: mockPeer,
    streamId: 7,
    isLive: false,
    highWaterMark: 5,
    maxBufferSize: 50,
    onError: (error, severity) => {
      console.log(`Error: ${error.message} [${severity}]`);
    },
  });

  // Set up event listeners
  stream.on('stateChange', ({ oldState, newState }) => {
    console.log(`📊 State: ${oldState} -> ${newState}`);
  });

  stream.on('backpressure', ({ bufferSize }) => {
    console.log(`⚠️  Backpressure! Buffer size: ${bufferSize}`);
  });

  stream.on('resume', () => {
    console.log('✅ Stream resumed');
  });

  // Read from stream
  const reader = stream.getReader();

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('Stream ended');
          break;
        }
        console.log(`📦 Received chunk:`, value);
      }
    } catch (error) {
      console.error('Reader error:', error);
    } finally {
      reader.releaseLock();
    }
  })();

  // Simulate packet arrival
  // Note: In real usage, packets come from network via peer.onPacket()
  console.log('\nNote: To simulate packets, you would call stream.onPacket(packet)');
  console.log('where packet is a Packet instance with streamIndex and data properties.\n');

  // Print final metrics after 10 seconds
  setTimeout(() => {
    const metrics = stream.getMetrics();
    console.log('\n📈 Final Metrics:');
    console.log(JSON.stringify(metrics, null, 2));
  }, 10000);
}

// Run all examples
async function runExamples() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  NetronReadableStream - Feature Demonstration             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const stream1 = example1_BasicStreamWithConfig();
  example2_MonitorMetrics(stream1);
  example3_PauseResume(stream1);
  example4_StateTransitions(stream1);

  const stream5 = example5_ErrorHandling();
  example6_MemoryManagement(stream5);

  await example7_CompleteWorkflow();

  console.log('\n✨ All examples completed!\n');
}

// Uncomment to run examples
// runExamples().catch(console.error);

export {
  example1_BasicStreamWithConfig,
  example2_MonitorMetrics,
  example3_PauseResume,
  example4_StateTransitions,
  example5_ErrorHandling,
  example6_MemoryManagement,
  example7_CompleteWorkflow,
  runExamples,
};
