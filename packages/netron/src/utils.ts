import { ServiceMetadata } from './types';
import { SERVICE_ANNOTATION } from './constants';

export const getServiceEventName = (serviceName: string) => `svc:${serviceName}`;
export const getPeerEventName = (peerId: string) => `peer:${peerId}`;

export const getServiceMetadata = (instance: any) =>
  Reflect.getMetadata(SERVICE_ANNOTATION, instance.constructor) as ServiceMetadata;

export const getQualifiedName = (name: string, version?: string) => `${name}${version ? `:${version}` : ''}`;
