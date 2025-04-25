
import { Netron } from './netron';
import { Interface } from './interface';
import { Reference } from './reference';
import { LocalPeer } from './local-peer';
import { Definition } from './definition';
import { ServiceStub } from './service-stub';
import { AbstractPeer } from './abstract-peer';
import { SERVICE_ANNOTATION } from './constants';
import { StreamReference } from './stream-reference';
import { NetronWritableStream } from './writable-stream';
import { NetronReadableStream } from './readable-stream';

/**
 * Checks if the given object is an instance of the Netron class.
 * @param obj - The object to check.
 * @returns True if the object is an instance of Netron, otherwise false.
 */
export const isNetron = (obj: any) => obj instanceof Netron;

/**
 * Checks if the given object is an instance of the Definition class.
 * @param obj - The object to check.
 * @returns True if the object is an instance of Definition, otherwise false.
 */
export const isServiceDefinition = (obj: any) => obj instanceof Definition;

/**
 * Checks if the given object is an instance of the Reference class.
 * @param obj - The object to check.
 * @returns True if the object is an instance of Reference, otherwise false.
 */
export const isServiceReference = (obj: any) => obj instanceof Reference;

/**
 * Checks if the given object is an instance of the Interface class.
 * @param obj - The object to check.
 * @returns True if the object is an instance of Interface, otherwise false.
 */
export const isServiceInterface = (obj: any) => obj instanceof Interface;

/**
 * Checks if the given object is an instance of the ServiceStub class.
 * @param obj - The object to check.
 * @returns True if the object is an instance of ServiceStub, otherwise false.
 */
export const isServiceStub = (obj: any) => obj instanceof ServiceStub;

/**
 * Checks if the given object is an instance of the AbstractPeer class.
 * @param obj - The object to check.
 * @returns True if the object is an instance of AbstractPeer, otherwise false.
 */
export const isNetronPeer = (obj: any) => obj instanceof AbstractPeer;

/**
 * Checks if the given object is an instance of the LocalPeer class.
 * @param obj - The object to check.
 * @returns True if the object is an instance of LocalPeer, otherwise false.
 */
export const isNetronOwnPeer = (obj: any) => obj instanceof LocalPeer;

/**
 * Checks if the given object is a Netron service.
 * @param obj - The object to check.
 * @returns True if the object is a Netron service, otherwise false.
 */
export const isNetronService = (obj: any) => {
  if (obj && typeof obj === 'object' && obj.constructor) {
    return Reflect.hasMetadata(SERVICE_ANNOTATION, obj.constructor);
  }
  return false;
};

export const isNetronStream = (obj: any) => obj instanceof NetronReadableStream || obj instanceof NetronWritableStream;

export const isNetronStreamReference = (obj: any) => obj instanceof StreamReference;