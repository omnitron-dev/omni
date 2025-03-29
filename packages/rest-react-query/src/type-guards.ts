import {
  AppRoute,
  exhaustiveGuard,
  ErrorHttpStatusCode,
  ClientInferResponses,
  isUnknownErrorResponse,
  InferResponseUndefinedStatusCodes,
} from '@devgrid/rest-core';

type FetchError = Error;

type UnknownResponseError<T extends AppRoute> = ClientInferResponses<
  T,
  InferResponseUndefinedStatusCodes<T, ErrorHttpStatusCode>,
  'ignore'
>;

type NotKnownResponseError<T extends AppRoute> =
  | FetchError
  | UnknownResponseError<T>;

export const isFetchError = (error: unknown): error is FetchError => error instanceof Error;

export const isNotKnownResponseError = <T extends AppRoute>(
  error: unknown,
  contractEndpoint: T,
): error is NotKnownResponseError<T> => isFetchError(error) || isUnknownErrorResponse(error, contractEndpoint);

export { exhaustiveGuard, isUnknownErrorResponse };