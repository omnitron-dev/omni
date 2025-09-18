import { Netron } from './netron.js';
import { Interface } from './interface.js';
import { Reference } from './reference.js';
import { LocalPeer } from './local-peer.js';
import { Definition } from './definition.js';
import { ServiceStub } from './service-stub.js';
import { AbstractPeer } from './abstract-peer.js';
import { SERVICE_ANNOTATION } from './constants.js';
import { StreamReference } from './stream-reference.js';
import { NetronWritableStream } from './writable-stream.js';
import { NetronReadableStream } from './readable-stream.js';

/**
 * Determines whether the provided object is an instance of the Netron class.
 * This predicate function is essential for type checking and runtime validation
 * of Netron instances throughout the application.
 *
 * @param {any} obj - The object to be evaluated for Netron instance membership
 * @returns {boolean} Returns true if the object is a Netron instance, false otherwise
 * @example
 * const netron = new Netron();
 * isNetron(netron); // returns true
 * isNetron({}); // returns false
 */
export const isNetron = (obj: any) => obj instanceof Netron;

/**
 * Validates if the given object is an instance of the Definition class.
 * This predicate is crucial for service definition validation and type checking
 * in the Netron service architecture.
 *
 * @param {any} obj - The object to be checked for Definition instance membership
 * @returns {boolean} Returns true if the object is a Definition instance, false otherwise
 * @see Definition
 */
export const isServiceDefinition = (obj: any) => obj instanceof Definition;

/**
 * Verifies if the provided object is an instance of the Reference class.
 * This predicate function is used to identify service references in the Netron
 * distributed system architecture.
 *
 * @param {any} obj - The object to be evaluated for Reference instance membership
 * @returns {boolean} Returns true if the object is a Reference instance, false otherwise
 * @see Reference
 */
export const isServiceReference = (obj: any) => obj instanceof Reference;

/**
 * Determines whether the given object is an instance of the Interface class.
 * This predicate is essential for interface validation in the Netron service
 * communication layer.
 *
 * @param {any} obj - The object to be checked for Interface instance membership
 * @returns {boolean} Returns true if the object is an Interface instance, false otherwise
 * @see Interface
 */
export const isServiceInterface = (obj: any) => obj instanceof Interface;

/**
 * Validates if the provided object is an instance of the ServiceStub class.
 * This predicate function is used to identify service stubs in the Netron
 * service proxy system.
 *
 * @param {any} obj - The object to be evaluated for ServiceStub instance membership
 * @returns {boolean} Returns true if the object is a ServiceStub instance, false otherwise
 * @see ServiceStub
 */
export const isServiceStub = (obj: any) => obj instanceof ServiceStub;

/**
 * Checks if the given object is an instance of the AbstractPeer class.
 * This predicate is fundamental for peer type validation in the Netron
 * peer-to-peer communication system.
 *
 * @param {any} obj - The object to be checked for AbstractPeer instance membership
 * @returns {boolean} Returns true if the object is an AbstractPeer instance, false otherwise
 * @see AbstractPeer
 */
export const isNetronPeer = (obj: any) => obj instanceof AbstractPeer;

/**
 * Determines whether the provided object is an instance of the LocalPeer class.
 * This predicate function is used to identify local peer instances in the Netron
 * distributed system.
 *
 * @param {any} obj - The object to be evaluated for LocalPeer instance membership
 * @returns {boolean} Returns true if the object is a LocalPeer instance, false otherwise
 * @see LocalPeer
 */
export const isNetronOwnPeer = (obj: any) => obj instanceof LocalPeer;

/**
 * Validates if the given object is a Netron service by checking for the presence
 * of the SERVICE_ANNOTATION metadata on its constructor. This predicate is crucial
 * for service identification and validation in the Netron service architecture.
 *
 * @param {any} obj - The object to be checked for Netron service membership
 * @returns {boolean} Returns true if the object is a Netron service, false otherwise
 * @see SERVICE_ANNOTATION
 */
export const isNetronService = (obj: any) => {
  if (obj && typeof obj === 'object' && obj.constructor) {
    return Reflect.hasMetadata(SERVICE_ANNOTATION, obj.constructor);
  }
  return false;
};

/**
 * Determines whether the provided object is an instance of either NetronReadableStream
 * or NetronWritableStream. This predicate is essential for stream type validation
 * in the Netron streaming system.
 *
 * @param {any} obj - The object to be evaluated for stream instance membership
 * @returns {boolean} Returns true if the object is a Netron stream instance, false otherwise
 * @see NetronReadableStream
 * @see NetronWritableStream
 */
export const isNetronStream = (obj: any) => obj instanceof NetronReadableStream || obj instanceof NetronWritableStream;

/**
 * Validates if the given object is an instance of the StreamReference class.
 * This predicate function is used to identify stream references in the Netron
 * streaming system.
 *
 * @param {any} obj - The object to be checked for StreamReference instance membership
 * @returns {boolean} Returns true if the object is a StreamReference instance, false otherwise
 * @see StreamReference
 */
export const isNetronStreamReference = (obj: any) => obj instanceof StreamReference;
