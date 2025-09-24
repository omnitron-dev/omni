import 'reflect-metadata';

// Basic types and utilities first
export * from './uid.js';
export * from './types.js';
export * from './utils.js';
export * from './constants.js';
export * from './predicates.js';

// Core classes - order matters for initialization
export * from './definition.js';
export * from './reference.js';
export * from './stream-reference.js';

// Interfaces and decorators
export * from './interface.js';

// Peer classes
export * from './local-peer.js';
export * from './remote-peer.js';

// Stream classes
export * from './writable-stream.js';
export * from './readable-stream.js';

// Other components
export * from './task-manager.js';
export * from './service-stub.js';

// Packet system (includes serializer)
export * from './packet/index.js';

// Main Netron class
export * from './netron.js';
