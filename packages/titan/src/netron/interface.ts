import { Errors } from '../errors/index.js';
import { Reference } from './reference.js';
import { Definition } from './definition.js';
import { StreamReference } from './stream-reference.js';
import { isNetronStream } from './stream-utils.js';
import { isNetronService } from './service-utils.js';
import { IPeer } from './types.js';

/**
 * List of internal properties that can be read from the Interface instance.
 * These properties are used for internal bookkeeping and should not be exposed
 * as part of the public API.
 *
 * @constant {string[]} INTERNAL_READ_PROPERTIES
 */
const INTERNAL_READ_PROPERTIES = [
  '$def',
  '$peer',
  'waitForAssigned',
  '$pendingPromises',
  '$methodCache',
  'then',
  '$$typeof',
  'nodeType',
  'tagName',
];

/**
 * List of internal properties that can be written to the Interface instance.
 * These properties are used for internal state management and should not be
 * modified by external code.
 *
 * @constant {string[]} INTERNAL_WRITE_PROPERTIES
 */
const INTERNAL_WRITE_PROPERTIES = ['$def', '$peer'];

/**
 * The Interface class implements a sophisticated proxy mechanism for remote service interaction
 * within the Netron framework. It serves as a transparent bridge between local code and remote
 * services, handling method calls, property access, and type conversion between different
 * execution contexts.
 *
 * This class uses JavaScript's Proxy API to intercept and handle all property access and
 * method calls, providing a seamless experience for developers while maintaining proper
 * type safety and error handling.
 *
 * @class Interface
 * @property {Definition} $def - The service definition containing metadata about available
 *                              methods and properties
 * @property {AbstractPeer} $peer - The peer instance responsible for network communication
 */
export class Interface {
  /**
   * A Map tracking pending promises for asynchronous property assignments.
   * This is used to ensure proper handling of concurrent property updates
   * and to provide a mechanism for waiting on property assignment completion.
   *
   * @private
   * @type {Map<string, Promise<void>>}
   */
  private $pendingPromises = new Map<string, Promise<void>>();

  /**
   * Cache for method proxy functions to avoid creating new functions on each access.
   * This improves performance by reusing the same function instance for repeated method calls.
   *
   * @private
   * @type {Map<string, Function>}
   */
  private $methodCache = new Map<string, Function>();

  /**
   * Constructs a new Interface instance with the specified service definition and peer.
   * The constructor returns a Proxy that intercepts all property access and method calls,
   * providing transparent remote service interaction.
   *
   * @param {Definition} [def] - The service definition containing metadata about available
   *                            methods and properties
   * @param {AbstractPeer} [peer] - The peer instance responsible for network communication
   * @returns {Proxy} A Proxy instance that intercepts property access and method calls
   */
  constructor(
    public $def?: Definition,
    public $peer?: IPeer
  ) {
    return new Proxy(this, {
      /**
       * Intercepts property access on the Interface instance.
       * This handler implements the core logic for remote service interaction:
       * - Method calls are converted to asynchronous remote procedure calls
       * - Property access triggers remote property retrieval
       * - Internal properties are handled directly
       *
       * @param {Interface} target - The target Interface instance
       * @param {string} prop - The name of the property being accessed
       * @returns {any} The property value or a function for method calls
       * @throws {Error} If the interface is invalid or the member is unknown
       */
      get: (target: Interface, prop: string) => {
        if (!this.$def) {
          throw Errors.badRequest('Invalid interface: Service definition is missing');
        }

        if (this.$def?.meta.methods[prop]) {
          // Return cached method proxy or create and cache a new one
          let cachedMethod = target.$methodCache.get(prop);
          if (!cachedMethod) {
            cachedMethod = async function methodProxy(...args: any[]) {
              const processedArgs = target.$processArgs(args);
              return $peer?.call($def!.id, prop, processedArgs);
            };
            target.$methodCache.set(prop, cachedMethod);
          }
          return cachedMethod;
        }

        if ($def?.meta.properties[prop]) {
          return $peer?.get($def.id, prop);
        }

        if (INTERNAL_READ_PROPERTIES.includes(prop)) {
          return Reflect.get(target, prop);
        }

        // For inspection properties (symbols, special prefixes), return undefined
        // This allows debugging tools and test frameworks to inspect the object
        if (typeof prop === 'symbol' || prop.startsWith('$$') || prop.startsWith('@@')) {
          return undefined;
        }

        // For regular properties not in the interface, throw an error
        throw Errors.badRequest(`Unknown member: '${prop}' is not defined in the service interface`);
      },

      /**
       * Intercepts property assignment on the Interface instance.
       * This handler manages asynchronous property updates and ensures proper
       * type conversion and validation before remote updates are performed.
       *
       * @param {Interface} target - The target Interface instance
       * @param {string} prop - The name of the property being set
       * @param {any} value - The value being assigned
       * @returns {boolean} true if the assignment was successful
       * @throws {Error} If the interface is invalid, the member is unknown, or the property is read-only
       */
      set: (target: Interface, prop: string, value: any) => {
        if (INTERNAL_WRITE_PROPERTIES.includes(prop)) {
          Reflect.set(target, prop, value);
          return true;
        }

        if (!this.$def) {
          throw Errors.badRequest('Invalid interface: Service definition is missing');
        }

        if (!$def?.meta.properties[prop]) {
          throw Errors.badRequest(`Unknown member: '${prop}' is not defined in the service interface`);
        }

        if (this.$def?.meta.properties[prop]?.readonly) {
          throw Errors.badRequest(`Property is not writable: '${prop}' is marked as readonly`);
        }

        let resolvePromise: () => void = () => {};
        let rejectPromise: (reason?: any) => void = () => {};

        const promise = new Promise<void>((resolve, reject) => {
          resolvePromise = resolve;
          rejectPromise = reject;
        });

        this.$pendingPromises.set(prop, promise);

        (async () => {
          try {
            value = await this.$processValue(value);
            await $peer?.set($def!.id, prop, value);
            resolvePromise();
            this.$pendingPromises.delete(prop);
          } catch (error) {
            rejectPromise(error);
          }
        })();

        return true;
      },
    });
  }

  /**
   * Waits for the completion of a property assignment operation.
   * This method is particularly useful when you need to ensure that a property
   * update has been successfully propagated to the remote service before proceeding.
   *
   * @param {string} prop - The name of the property to wait for
   * @returns {Promise<void>} A promise that resolves when the assignment is complete
   * @throws {Error} If the assignment operation fails
   */
  public async waitForAssigned(prop: string): Promise<void> {
    try {
      const promise = this.$pendingPromises.get(prop);
      return promise ? await promise : Promise.resolve();
    } catch (error) {
      this.$pendingPromises.delete(prop);
      return Promise.reject(error);
    }
  }

  /**
   * Processes a value to convert it into a format suitable for network transmission.
   * This method handles various special types that require special serialization:
   * - Service interfaces are converted to references
   * - Streams are converted to stream references
   * - Other types are passed through unchanged
   *
   * @private
   * @param {any} value - The value to process
   * @returns {any} The processed value
   * @throws {Error} If the value type is not supported
   */
  private $processValue(value: any): any {
    if (value instanceof Interface) {
      if (!value.$def) {
        throw Errors.badRequest('Service interface is not valid: Missing service definition');
      }
      return new Reference(value.$def.id);
    } else if (isNetronService(value)) {
      // Handle direct service exposure
      // When a service instance is passed as an argument, we need to expose it
      // to the remote peer so it can be used there
      const peer = this.$peer;
      if (!peer || !peer.netron) {
        throw Errors.badRequest('Cannot expose service: No peer or netron instance available');
      }

      // Get or create a definition for this service instance
      const localPeer = peer.netron.getLocalPeer();
      const existingStub = localPeer.serviceInstances.get(value);

      if (existingStub) {
        // Service already exposed, return its reference
        return new Reference(existingStub.definition.id);
      }

      // Service not exposed yet, expose it synchronously
      // Note: This is a synchronous operation because we're in a processing pipeline
      // The actual exposure happens on the local peer, which is synchronous
      try {
        const metadata = Reflect.getMetadata('service:metadata', value.constructor);
        if (!metadata) {
          throw Errors.badRequest('Service instance does not have proper metadata');
        }

        // For now, we'll throw an error indicating this needs to be done explicitly
        // This is because exposing a service should be an explicit action by the developer
        throw Errors.badRequest(
          'Direct service exposure in RPC calls requires the service to be exposed first. ' +
          'Please expose the service using netron.exposeService() before passing it as an argument.'
        );
      } catch (err: any) {
        throw Errors.badRequest(`Failed to expose service: ${err.message}`);
      }
    } else if (isNetronStream(value)) {
      return StreamReference.from(value);
    }
    return value;
  }

  /**
   * Processes an array of arguments by converting each argument using $processValue.
   * This method ensures that all arguments passed to remote methods are properly
   * serialized for network transmission.
   *
   * @private
   * @param {any[]} args - The array of arguments to process
   * @returns {any[]} The array of processed arguments
   */
  private $processArgs(args: any[]): any[] {
    return args.map((arg) => this.$processValue(arg));
  }

  /**
   * Factory method for creating new Interface instances.
   * This method provides a more convenient way to create Interface instances
   * while maintaining proper type safety.
   *
   * @static
   * @param {Definition} def - The service definition
   * @param {AbstractPeer} peer - The peer instance
   * @returns {Interface} A new Interface instance
   */
  static create(def: Definition, peer: IPeer): Interface {
    return new Interface(def, peer);
  }
}
