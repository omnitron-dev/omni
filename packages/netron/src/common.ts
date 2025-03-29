/* eslint-disable no-bitwise */

import { ServiceMetadata } from './types';

export const MAX_UID_VALUE = Number.MAX_SAFE_INTEGER >>> 0;

export const CONTEXTIFY_SYMBOL = Symbol();

export const SERVICE_ANNOTATION = 'nsvc';
export const PUBLIC_ANNOTATION = 'nsvc:pub';

export const NETRON_EVENT_SERVICE_EXPOSE = 'service:expose';
export const NETRON_EVENT_SERVICE_UNEXPOSE = 'service:unexpose';

export const NETRON_EVENT_PEER_CONNECT = 'peer:connect';
export const NETRON_EVENT_PEER_DISCONNECT = 'peer:disconnect';

export const CONNECT_TIMEOUT = 5000;
export const REQUEST_TIMEOUT = 5000;

export const getServiceEventName = (serviceName: string) => `svc:${serviceName}`;
export const getPeerEventName = (peerId: string) => `peer:${peerId}`;

export const getServiceMetadata = (instance: any) =>
  Reflect.getMetadata(SERVICE_ANNOTATION, instance.constructor) as ServiceMetadata;
