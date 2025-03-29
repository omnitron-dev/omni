/* eslint-disable default-case */
import { AppRoute } from '@devgrid/rest-core';
import {
  Get,
  Put,
  Post,
  Patch,
  Delete,
  SetMetadata,
  applyDecorators,
  UseInterceptors,
} from '@nestjs/common';

import { TsRestOptions } from './ts-rest-options';
import { TsRestInterceptor } from './ts-rest.interceptor';
import {
  TsRestOptionsMetadataKey,
  TsRestAppRouteMetadataKey,
} from './constants';

type TsRestType = {
  (appRoute: AppRoute, options?: TsRestOptions): MethodDecorator;
  (options: TsRestOptions): ClassDecorator;
};

/**
 * As a class decorator, you can configure ts-rest options. As a method decorator, you can assign the route and also configure options
 * @param appRouteOrOptions For a method decorator, this is the route. For a class decorator, this is the options
 * @param options For a method decorator, this is the options
 *
 * @deprecated Please use `TsRestHandler` instead - will be removed in v4
 */
export const TsRest: TsRestType = (
  appRouteOrOptions: AppRoute | TsRestOptions,
  options?: TsRestOptions,
) => {
  const decorators: any[] = [];

  const isMethodDecorator = 'path' in appRouteOrOptions;
  const optionsToUse = isMethodDecorator ? options : appRouteOrOptions;

  if (isMethodDecorator) {
    decorators.push(
      ...[
        SetMetadata(TsRestAppRouteMetadataKey, appRouteOrOptions),
        getMethodDecorator(appRouteOrOptions),
        UseInterceptors(TsRestInterceptor),
      ],
    );
  }

  if (optionsToUse) {
    decorators.push(SetMetadata(TsRestOptionsMetadataKey, optionsToUse));
  }

  return applyDecorators(...decorators);
};

// eslint-disable-next-line consistent-return
const getMethodDecorator = (appRoute: AppRoute) => {
  switch (appRoute.method) {
    case 'DELETE':
      return Delete(appRoute.path);
    case 'GET':
      return Get(appRoute.path);
    case 'POST':
      return Post(appRoute.path);
    case 'PATCH':
      return Patch(appRoute.path);
    case 'PUT':
      return Put(appRoute.path);
  }
};
