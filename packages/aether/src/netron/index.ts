/**
 * Aether Netron Module
 *
 * This module provides Netron RPC client functionality for Aether applications.
 * It re-exports the @omnitron-dev/netron-browser package with Aether-specific
 * naming conventions and compatibility layers.
 *
 * All exports are now sourced from the external @omnitron-dev/netron-browser package
 * for better maintainability and consistency.
 */

// Re-export everything from the netron-browser compatibility layer
export * from '../netron-reexport.js';

/**
 * Usage Examples:
 *
 * Basic WebSocket Client:
 * ```typescript
 * import { NetronClient } from '@omnitron-dev/aether/netron';
 *
 * const client = new NetronClient({ url: 'ws://localhost:3000' });
 * await client.connect();
 * const service = await client.queryInterface<MyService>('MyService@1.0.0');
 * ```
 *
 * HTTP Client:
 * ```typescript
 * import { HttpNetronClient } from '@omnitron-dev/aether/netron';
 *
 * const client = new HttpNetronClient({ baseUrl: 'http://localhost:3000' });
 * await client.initialize();
 * const service = await client.queryInterface<MyService>('MyService@1.0.0');
 * ```
 *
 * With Authentication:
 * ```typescript
 * import { NetronClient } from '@omnitron-dev/aether/netron';
 *
 * const client = new NetronClient({ url: 'ws://localhost:3000' });
 * await client.connect();
 * const peer = client.getPeer();
 * await peer?.runTask('authenticate', { token: 'your-token' });
 * ```
 */
