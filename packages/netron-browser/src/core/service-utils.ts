/**
 * Service utility functions for browser
 * Stub implementation - service decorators are not used in browser client
 */

/**
 * Determines if an object is a Netron service
 * Browser version always returns false as services are defined on the server
 *
 * @param _obj - The object to check
 * @returns false - services are server-side only
 */
export const isNetronService = (_obj: any): boolean =>
  // Services are defined on the server, not in the browser client
  // This is a placeholder for potential future browser-side service definitions
  false;
