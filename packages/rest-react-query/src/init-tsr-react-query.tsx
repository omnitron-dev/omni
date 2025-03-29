import React from 'react';
import { QueryClient } from '@tanstack/react-query';
import { AppRouter, ClientArgs } from '@devgrid/rest-core';

import { TsRestInnerProvider } from './internal/provider-inner';
import { useTsrQueryClient } from './internal/use-tsr-query-client';
import { initQueryClient, initHooksContainer } from './internal/create-hooks';

export const initTsrReactQuery = <
  TContract extends AppRouter,
  TClientArgs extends ClientArgs,
>(
  contract: TContract,
  clientOptions: TClientArgs,
) => ({
  ReactQueryProvider({ children }: React.PropsWithChildren) {
    return (
      <TsRestInnerProvider contract={contract} clientOptions={clientOptions}>
        {children}
      </TsRestInnerProvider>
    );
  },
  ...initHooksContainer(contract, clientOptions),
  useQueryClient: useTsrQueryClient<TContract, TClientArgs>,
  initQueryClient: (queryClient: QueryClient) => initQueryClient(contract, clientOptions, queryClient),
});