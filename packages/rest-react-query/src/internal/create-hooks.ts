import {
  AppRoute,
  fetchApi,
  AppRouter,
  ClientArgs,
  isAppRoute,
  getRouteQuery,
  isAppRouteQuery,
  isErrorResponse,
  evaluateFetchApiArgs,
} from '@devgrid/rest-core';
import {
  QueryKey,
  useQuery,
  skipToken,
  useQueries,
  QueryClient,
  useMutation,
  QueryOptions,
  useInfiniteQuery,
  useSuspenseQuery,
  usePrefetchQuery,
  useSuspenseQueries,
  QueryFunctionContext,
  useSuspenseInfiniteQuery,
  usePrefetchInfiniteQuery,
} from '@tanstack/react-query';

import {
  QueryHooks,
  RequestData,
  DataResponse,
  MutationHooks,
  TsRestQueryOptions,
  TsRestReactQueryClient,
  TsRestInfiniteQueryOptions,
  TsRestQueryClientFunctions,
  TsRestReactQueryHooksContainer,
  TsRestReactQueryClientFunctionsContainer,
} from '../types';

const apiFetcher = <TAppRoute extends AppRoute, TClientArgs extends ClientArgs>(
  route: TAppRoute,
  clientArgs: TClientArgs,
  abortSignal?: AbortSignal,
) => async (requestData?: RequestData<TAppRoute, TClientArgs>) => {
  const fetchApiArgs = evaluateFetchApiArgs(
    route,
    clientArgs,
    requestData as any,
  );
  const result = await fetchApi({
    ...fetchApiArgs,
    fetchOptions: {
      ...(abortSignal && { signal: abortSignal }),
      ...fetchApiArgs.fetchOptions,
    },
  });

  // If the response is not a 2XX, throw an error to be handled by react-query
  if (isErrorResponse(result)) {
    throw result;
  }

  return result as DataResponse<TAppRoute>;
};

function createBaseQueryOptions<
  TAppRoute extends AppRoute,
  TClientArgs extends ClientArgs,
  TOptions extends QueryOptions<any, any>,
>(route: TAppRoute, clientArgs: TClientArgs, options: TOptions): TOptions {
  const { queryData: queryDataOrFunction, ...rqOptions } =
    options as unknown as TOptions &
    (
      | TsRestQueryOptions<TAppRoute, TClientArgs>
      | TsRestInfiniteQueryOptions<TAppRoute, TClientArgs>
    );
  return {
    ...rqOptions,
    queryFn:
      queryDataOrFunction === skipToken
        ? skipToken
        : (context?: QueryFunctionContext<QueryKey, unknown>) => {
          const requestData =
            typeof queryDataOrFunction === 'function'
              ? queryDataOrFunction(context!)
              : queryDataOrFunction;

          return apiFetcher(route, clientArgs, context?.signal)(requestData);
        },
  } as unknown as TOptions;
}

const appendTsRestResult = <T, TAppRoute extends AppRoute>(
  result: T,
  tsResult: {
    contractEndpoint: TAppRoute;
  },
) => ({
  ...result,
  ...tsResult,
});

const tanstackQueryHooks = {
  query: {
    useQuery,
    useSuspenseQuery,
    useInfiniteQuery,
    useSuspenseInfiniteQuery,
  },
  queries: {
    useQueries,
    useSuspenseQueries,
  },
  prefetch: {
    usePrefetchQuery,
    usePrefetchInfiniteQuery,
  },
};

const wrapHooks = <
  T extends
  | typeof tanstackQueryHooks.query
  | typeof tanstackQueryHooks.queries
  | typeof tanstackQueryHooks.prefetch,
  H extends T extends
  | typeof tanstackQueryHooks.query
  | typeof tanstackQueryHooks.prefetch
  ? (options: QueryOptions<any, any>, queryClient?: QueryClient) => any
  : (
    options: { queries: QueryOptions<any, any>[] },
    queryClient?: QueryClient,
  ) => any,
>(
  hooks: T,
  getWrapper: (hook: H) => H,
) => Object.fromEntries(
  Object.entries(hooks).map(([hookName, hook]) => [
    hookName,
    getWrapper(hook),
  ]),
) as any;

const wrapAllHooks = <
  TAppRoute extends AppRoute,
  TClientArgs extends ClientArgs,
>(
  appRoute: TAppRoute,
  clientOptions: TClientArgs,
) => ({
  ...wrapHooks(tanstackQueryHooks.query, (hook) => (options, queryClient) => appendTsRestResult(
    hook(
      createBaseQueryOptions(appRoute, clientOptions, options),
      queryClient,
    ),
    {
      contractEndpoint: appRoute,
    },
  )),
  ...wrapHooks(
    tanstackQueryHooks.queries,
    (hook) => (options, queryClient) => hook(
      {
        ...options,
        queries: options.queries.map((queryOptions) =>
          createBaseQueryOptions(
            appRoute,
            clientOptions,
            queryOptions as any,
          ),
        ),
      } as any,
      queryClient,
    ),
  ),
  ...wrapHooks(tanstackQueryHooks.prefetch, (hook) => (options) => hook(createBaseQueryOptions(appRoute, clientOptions, options))),
});

export const initHooksContainer = <
  TContract extends AppRouter,
  TClientArgs extends ClientArgs,
>(
  contract: TContract,
  clientOptions: TClientArgs,
): TsRestReactQueryHooksContainer<TContract, TClientArgs> => {
  const recursiveInit = <TInner extends AppRouter>(
    innerRouter: TInner,
  ): TsRestReactQueryHooksContainer<TInner, TClientArgs> => Object.fromEntries(
    Object.entries(innerRouter).map(([key, subRouter]) => {
      if (isAppRoute(subRouter)) {
        if (isAppRouteQuery(subRouter)) {
          return [
            key,
            {
              query: getRouteQuery(subRouter, clientOptions) as any,
              ...wrapAllHooks(subRouter, clientOptions),
            } as QueryHooks<typeof subRouter, TClientArgs>,
          ];
        }
        return [
          key,
          {
            mutate: getRouteQuery(subRouter, clientOptions) as any,
            useMutation: (options) => appendTsRestResult(
              useMutation({
                ...options,
                mutationFn: apiFetcher(subRouter, clientOptions) as any,
              }),
              {
                contractEndpoint: subRouter,
              },
            ),
          } as MutationHooks<typeof subRouter, TClientArgs>,
        ];

      }
      return [key, recursiveInit(subRouter)];

    }),
  );

  return recursiveInit(contract);
};

export const initQueryClient = <
  TContract extends AppRouter,
  TClientArgs extends ClientArgs,
>(
  contract: TContract,
  clientOptions: TClientArgs,
  queryClient: QueryClient,
): TsRestReactQueryClient<TContract, TClientArgs> => {
  const recursiveInit = <TInner extends AppRouter>(
    innerRouter: TInner,
  ): TsRestReactQueryClientFunctionsContainer<TInner, TClientArgs> => Object.fromEntries(
    Object.entries(innerRouter).map(([key, subRouter]) => {
      if (isAppRoute(subRouter)) {
        if (isAppRouteQuery(subRouter)) {
          return [
            key,
            {
              getQueryData: (queryKey) => queryClient.getQueryData(queryKey),
              ensureQueryData: (options) => queryClient.ensureQueryData(
                createBaseQueryOptions(subRouter, clientOptions, options),
              ),
              getQueriesData: (filters) => queryClient.getQueriesData(filters),
              setQueryData: (queryKey, updater, options) => queryClient.setQueryData(queryKey, updater, options),
              setQueriesData: (filters, updater, options) => queryClient.setQueriesData(filters, updater, options),
              getQueryState: (queryKey) => queryClient.getQueryState(queryKey),
              fetchQuery: (options) => queryClient.fetchQuery(
                createBaseQueryOptions(subRouter, clientOptions, options),
              ),
              prefetchQuery: (options) => queryClient.prefetchQuery(
                createBaseQueryOptions(subRouter, clientOptions, options),
              ),
              fetchInfiniteQuery: (options) => queryClient.fetchInfiniteQuery(
                createBaseQueryOptions(subRouter, clientOptions, options),
              ),
              prefetchInfiniteQuery: (options) => queryClient.prefetchInfiniteQuery(
                createBaseQueryOptions(subRouter, clientOptions, options),
              ),
            } as TsRestQueryClientFunctions<typeof subRouter, TClientArgs>,
          ];
        }
        return [key, undefined];

      }
      return [key, recursiveInit(subRouter)];

    }),
  );

  return Object.assign(queryClient, recursiveInit(contract));
};