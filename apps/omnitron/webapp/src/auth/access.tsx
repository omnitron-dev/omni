import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Alert, Button } from '@mui/material';
import { LoadingScreen } from '@omnitron-dev/prism/components/loading-screen';
import { RoleBasedGuard, hasPermission, type AuthState } from '@omnitron-dev/prism/auth';
import type { ConsoleAccess } from '@omnitron-dev/omnitron/dto/services';
import { useLocation } from 'react-router-dom';
import { access, type OmnitronConsoleSchema } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { useAuthStore } from './store';

type Services = OmnitronConsoleSchema['daemon'];
export type RpcPermission = {
  [S in keyof Services]: `${S & string}.${Extract<keyof Services[S], string>}`;
}[keyof Services];
interface AccessState {
  snapshot: ConsoleAccess | null;
  authorization: AuthState;
  can: (permission: RpcPermission) => boolean;
  refresh: () => Promise<void>;
  error: string | null;
}
const Context = createContext<AccessState>({
  snapshot: null,
  authorization: { isAuthenticated: false, isLoading: true },
  can: () => false,
  refresh: async () => {},
  error: null,
});

/** Session-keyed provider. A failed refresh clears effective grants; the server remains authoritative. */
export function ConsoleAccessProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const { data, error, refresh } = usePolledResource(() => access.describe(), {
    intervalMs: 15_000,
    enabled: Boolean(user),
  });
  const snapshot = !error && data?.userId === user?.id ? (data ?? null) : null;
  useEffect(() => {
    if (snapshot && user && snapshot.role !== user.role)
      useAuthStore.getState().setUser({ ...user, role: snapshot.role });
  }, [snapshot, user]);
  const value = useMemo<AccessState>(() => {
    const principal = snapshot
      ? {
          id: snapshot.userId,
          roles: [snapshot.role],
          permissions: snapshot.capabilities.filter((c) => c.allowed).map((c) => `${c.service}.${c.method}`),
        }
      : null;
    return {
      snapshot,
      authorization: { isAuthenticated: Boolean(user), isLoading: !snapshot && !error, user: principal },
      can: (permission) => hasPermission(principal, permission),
      refresh,
      error: error ?? null,
    };
  }, [snapshot, user, error, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useAccess = () => useContext(Context);
function useAuthorization() {
  return useAccess().authorization;
}

/** A UI hint, never a substitute for RPC authorization. */
export function Can({ permission, children }: { permission: RpcPermission; children: ReactNode }) {
  const { can } = useAccess();
  return can(permission) ? children : null;
}

export function AccessBoundary({ permission, children }: { permission: RpcPermission; children: ReactNode }) {
  const { error, refresh } = useAccess();
  if (error)
    return (
      <Alert severity="error" action={<Button onClick={() => void refresh()}>Retry</Button>}>
        Could not verify your access. {error}
      </Alert>
    );
  return (
    <RoleBasedGuard
      useAuth={useAuthorization}
      permissions={[permission]}
      loadingComponent={<LoadingScreen />}
      accessDeniedComponent={
        <Alert severity="info">
          Your account does not have access to this area. See Access for your current permissions.
        </Alert>
      }
    >
      {children}
    </RoleBasedGuard>
  );
}

/** Entry-point permissions come from the actual RPC each page reads. */
export const PAGE_PERMISSIONS: Record<string, RpcPermission> = {
  dashboard: 'OmnitronDaemon.status',
  apps: 'OmnitronDaemon.list',
  nodes: 'OmnitronNodes.listNodes',
  terminal: 'OmnitronTerminal.open',
  files: 'OmnitronFiles.roots',
  projects: 'OmnitronProject.listProjects',
  system: 'OmnitronSystemInfo.getSnapshot',
  logs: 'OmnitronLogs.queryLogs',
  audit: 'OmnitronAudit.list',
  access: 'OmnitronAccess.describe',
  releases: 'OmnitronRelease.list',
  stacks: 'OmnitronProject.listStacks',
  metrics: 'OmnitronMetrics.getSnapshot',
  topology: 'OmnitronNodes.listNodes',
  containers: 'OmnitronInfra.getState',
  deployments: 'OmnitronDeploy.getHistory',
  alerts: 'OmnitronAlerts.getRules',
  pipelines: 'OmnitronPipelines.listPipelines',
  traces: 'OmnitronTraces.queryTraces',
};
export function PageAccess({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const permission = PAGE_PERMISSIONS[pathname.split('/')[1] || 'dashboard'];
  return permission ? <AccessBoundary permission={permission}>{children}</AccessBoundary> : children;
}
