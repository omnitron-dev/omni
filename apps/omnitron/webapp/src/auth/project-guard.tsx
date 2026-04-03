/**
 * ProjectGuard — Requires an active project to access project-scoped routes.
 *
 * Routes like /apps, /stacks, /logs, /metrics, etc. only make sense
 * in the context of a project. Without a project, redirect to dashboard.
 *
 * Dashboard (/) and System Info (/system) and Settings (/settings) are
 * always accessible regardless of project state.
 */

import { Navigate } from 'react-router-dom';
import { useActiveProject } from 'src/stores/project.store';

interface ProjectGuardProps {
  children: React.ReactNode;
}

export function ProjectGuard({ children }: ProjectGuardProps) {
  const activeProject = useActiveProject();

  if (!activeProject) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
