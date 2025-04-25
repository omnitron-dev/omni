import { Reference } from './reference';
import { Definition } from './definition';
import { AbstractPeer } from './abstract-peer';
import { StreamReference } from './stream-reference';
import { isNetronStream, isNetronService, isServiceInterface } from './predicates';

const INTERNAL_READ_PROPERTIES = ['$def', '$peer', 'waitForAssigned', '$pendingPromises', 'then'];
const INTERNAL_WRITE_PROPERTIES = ['$def', '$peer'];

/**
 * Interface provides a proxy mechanism to handle method and property access dynamically.
 */
export class Interface {
  private $pendingPromises = new Map<string, Promise<void>>();

  /**
   * Constructs an instance of Interface.
   * @param {Definition} def - The definition object containing metadata about methods and properties.
   * @param {AbstractPeer} peer - The peer object used for communication and data exchange.
   */
  constructor(
    public $def?: Definition,
    public $peer?: AbstractPeer
  ) {
    // Return a Proxy to intercept get and set operations on the instance
    return new Proxy(this, {
      /**
       * Intercepts property access on the Interface instance.
       * @param {Interface} target - The target object (Interface instance).
       * @param {string} prop - The property name being accessed.
       * @returns {any} - The value of the property or a function if it's a method.
       */
      get: (target: Interface, prop: string) => {
        if (!this.$def) {
          throw new Error('Invalid interface');
        }
        // If the property is a method, return an asynchronous function
        if (this.$def?.meta.methods[prop]) {
          // eslint-disable-next-line func-names
          return async function (...args: any[]) {
            const processedArgs = target.$processArgs(args);
            return $peer?.call($def!.id, prop, processedArgs);
          };
        }

        // If the property is a regular property, return its value using `peer.get`
        if ($def?.meta.properties[prop]) {
          return $peer?.get($def.id, prop);
        }

        if (!INTERNAL_READ_PROPERTIES.includes(prop)) {
          throw new Error(`Unknown member: '${prop}'`);
        }

        return Reflect.get(target, prop);
      },

      /**
       * Intercepts property assignment on the Interface instance.
       * @param {Interface} target - The target object (Interface instance).
       * @param {string} prop - The property name being set.
       * @param {any} value - The value being assigned to the property.
       * @returns {boolean} - True if the property was set successfully, otherwise false.
       */
      set: (target: Interface, prop: string, value: any) => {
        if (INTERNAL_WRITE_PROPERTIES.includes(prop)) {
          Reflect.set(target, prop, value);
          return true;
        }

        if (!this.$def) {
          throw new Error('Invalid interface');
        }

        if (!$def?.meta.properties[prop]) {
          throw new Error(`Unknown member: '${prop}'`);
        }

        if (this.$def?.meta.properties[prop]?.readonly) {
          throw new Error(`Property is not writable: ${prop}`);
        }

        let resolvePromise: () => void = () => { };
        let rejectPromise: (reason?: any) => void = () => { };

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

  public async waitForAssigned(prop: string) {
    try {
      const promise = this.$pendingPromises.get(prop);
      return promise ? await promise : Promise.resolve();
    } catch (error) {
      this.$pendingPromises.delete(prop);
      return Promise.reject(error);
    }
  }

  /**
   * Processes a value to convert it into a suitable format for communication.
   * @param {any} value - The value to process.
   * @returns {any} - The processed value.
   */
  private $processValue(value: any) {
    if (isServiceInterface(value)) {
      if (!value.$def) {
        throw new Error('Service interface is not valid');
      }
      return new Reference(value.$def.id);
    } else if (isNetronService(value)) {
      // TODO: Implement this
      throw Error('Unsupported value type');
      // return this.$peer?.exposeService(value);
    } else if (isNetronStream(value)) {
      return StreamReference.from(value);
    }
    return value;
  }

  /**
   * Processes an array of arguments by converting each argument.
   * @param {any[]} args - The array of arguments to process.
   * @returns {any[]} - The array of processed arguments.
   */
  private $processArgs(args: any[]) {
    return args.map((arg) => this.$processValue(arg));
  }

  /**
   * Factory function to create an Interface instance.
   * @param {Definition} def - The definition object for the interface.
   * @param {AbstractPeer} peer - The peer object for communication.
   * @returns {Interface} - A new instance of Interface.
   */
  static create(def: Definition, peer: AbstractPeer) {
    return new Interface(def, peer);
  }
}
