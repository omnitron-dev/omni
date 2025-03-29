import { isObject, isFunction } from '@devgrid/common';

import { Netron } from './netron';
import { Interface } from './interface';
import { Reference } from './reference';
import { LocalPeer } from './local-peer';
import { Definition } from './definition';
import { ServiceStub } from './service-stub';
import { SERVICE_ANNOTATION } from './common';
import { AbstractPeer } from './abstract-peer';

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
 * Checks if the specified property of the given object is a method in the context interface.
 * @param ni - The object to check.
 * @param name - The name of the property.
 * @returns True if the property is a method, otherwise false.
 */
export const isContextIMethod = (ni: any, name: string) => isFunction(ni[name]) && ni.$def.$[name].method === true;

/**
 * Checks if the specified property of the given object is a property in the context interface.
 * @param ni - The object to check.
 * @param name - The name of the property.
 * @returns True if the property is a context property, otherwise false.
 */
export const isContextIProperty = (ni: any, name: string) =>
  isObject(ni[name]) && isFunction(ni[name].get) && ni.$def.$[name].method === void 0;

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
