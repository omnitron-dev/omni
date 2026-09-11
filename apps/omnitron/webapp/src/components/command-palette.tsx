/**
 * Command Palette — quick navigation (Cmd+K / Ctrl+K).
 *
 * The palette itself is prism's `CommandPalette`: the search, grouping,
 * keyboard handling, shortcut binding and empty state all live there. What
 * stays here is the one thing that is genuinely this console's — the list of
 * places you can jump to.
 *
 * This file used to carry its own 300-line implementation of the same modal,
 * written before prism shipped one. Two copies of a keyboard-driven list is
 * two sets of focus-management bugs, and the console's copy had the palette
 * styled with hard-coded colours that ignored the theme.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandPalette as PrismCommandPalette, type CommandAction } from '@omnitron-dev/prism';

import {
  DashboardIcon,
  AppsIcon,
  LogsIcon,
  MetricsIcon,
  AlertIcon,
  NodesIcon,
  ContainersIcon,
  DeployIcon,
  SettingsIcon,
  StacksIcon,
} from 'src/assets/icons';

// =============================================================================
// Command definitions
// =============================================================================

interface ConsoleCommand {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<Record<string, unknown>>;
  /** URL path to navigate to. */
  target: string;
  keywords: readonly string[];
  group: string;
}

const COMMANDS: readonly ConsoleCommand[] = [
  // Navigation
  { id: 'nav-dashboard', title: 'Dashboard', icon: DashboardIcon, target: '/', keywords: ['home', 'overview'], group: 'Navigation' },
  { id: 'nav-apps', title: 'Applications', icon: AppsIcon, target: '/apps', keywords: ['processes', 'services'], group: 'Navigation' },
  { id: 'nav-stacks', title: 'Stacks', icon: StacksIcon, target: '/stacks', keywords: ['environments', 'dev', 'prod', 'test', 'deploy', 'cluster', 'remote'], group: 'Navigation' },
  { id: 'nav-logs', title: 'Logs', icon: LogsIcon, target: '/logs', keywords: ['terminal', 'output', 'stream'], group: 'Navigation' },
  { id: 'nav-metrics', title: 'Metrics', icon: MetricsIcon, target: '/metrics', keywords: ['charts', 'cpu', 'memory', 'performance'], group: 'Navigation' },
  { id: 'nav-alerts', title: 'Alerts', icon: AlertIcon, target: '/alerts', keywords: ['rules', 'notifications', 'warnings'], group: 'Navigation' },
  { id: 'nav-topology', title: 'Topology', icon: NodesIcon, target: '/topology', keywords: ['nodes', 'fleet', 'servers', 'infrastructure'], group: 'Navigation' },
  { id: 'nav-containers', title: 'Containers', icon: ContainersIcon, target: '/containers', keywords: ['docker', 'images'], group: 'Navigation' },
  { id: 'nav-deployments', title: 'Deployments', icon: DeployIcon, target: '/deployments', keywords: ['deploy', 'rollback', 'releases'], group: 'Navigation' },
  { id: 'nav-settings', title: 'Settings', icon: SettingsIcon, target: '/settings', keywords: ['profile', 'password', 'sessions'], group: 'Navigation' },
  { id: 'nav-pipelines', title: 'Pipelines', target: '/pipelines', keywords: ['ci', 'cd', 'jobs', 'workflow'], group: 'Navigation' },
  { id: 'nav-traces', title: 'Traces', target: '/traces', keywords: ['spans', 'distributed', 'tracing'], group: 'Navigation' },

  // Quick actions
  { id: 'act-logs-error', title: 'View error logs', icon: LogsIcon, target: '/logs?level=error', keywords: ['errors', 'failures'], group: 'Quick Actions' },
  { id: 'act-logs-live', title: 'Live log stream', icon: LogsIcon, target: '/logs?live=true', keywords: ['tail', 'stream', 'follow'], group: 'Quick Actions' },
];

// =============================================================================
// Component
// =============================================================================

export function CommandPalette() {
  const navigate = useNavigate();

  const actions = useMemo<CommandAction[]>(
    () =>
      COMMANDS.map((cmd) => {
        const Icon = cmd.icon;
        return {
          id: cmd.id,
          title: cmd.title,
          ...(cmd.subtitle !== undefined && { subtitle: cmd.subtitle }),
          group: cmd.group,
          keywords: cmd.keywords,
          ...(Icon && { icon: <Icon /> }),
          onSelect: () => navigate(cmd.target),
        };
      }),
    [navigate],
  );

  return (
    <PrismCommandPalette
      actions={actions}
      placeholder="Search pages and actions…"
      emptyMessage="No matching command"
    />
  );
}
