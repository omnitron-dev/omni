/**
 * Command Palette — Quick navigation and actions (Cmd+K / Ctrl+K)
 *
 * Provides instant access to:
 * - Page navigation (Dashboard, Logs, Topology, etc.)
 * - App actions (restart, stop, scale)
 * - Quick search across logs, apps, nodes
 *
 * Design: centered modal with search input + result list
 * Keyboard: ↑↓ to navigate, Enter to select, Esc to close
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
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
  SearchIcon,
  StacksIcon,
} from 'src/assets/icons';

// =============================================================================
// Command definitions
// =============================================================================

interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<any>;
  action: 'navigate' | 'execute';
  target: string; // URL path or action ID
  keywords: string[];
  section: string;
}

const COMMANDS: Command[] = [
  // Navigation
  { id: 'nav-dashboard', label: 'Dashboard', icon: DashboardIcon, action: 'navigate', target: '/', keywords: ['home', 'overview'], section: 'Navigation' },
  { id: 'nav-apps', label: 'Applications', icon: AppsIcon, action: 'navigate', target: '/apps', keywords: ['processes', 'services'], section: 'Navigation' },
  { id: 'nav-stacks', label: 'Stacks', icon: StacksIcon, action: 'navigate', target: '/stacks', keywords: ['environments', 'dev', 'prod', 'test', 'deploy', 'cluster', 'remote'], section: 'Navigation' },
  { id: 'nav-logs', label: 'Logs', icon: LogsIcon, action: 'navigate', target: '/logs', keywords: ['terminal', 'output', 'stream'], section: 'Navigation' },
  { id: 'nav-metrics', label: 'Metrics', icon: MetricsIcon, action: 'navigate', target: '/metrics', keywords: ['charts', 'cpu', 'memory', 'performance'], section: 'Navigation' },
  { id: 'nav-alerts', label: 'Alerts', icon: AlertIcon, action: 'navigate', target: '/alerts', keywords: ['rules', 'notifications', 'warnings'], section: 'Navigation' },
  { id: 'nav-topology', label: 'Topology', icon: NodesIcon, action: 'navigate', target: '/topology', keywords: ['nodes', 'fleet', 'servers', 'infrastructure'], section: 'Navigation' },
  { id: 'nav-containers', label: 'Containers', icon: ContainersIcon, action: 'navigate', target: '/containers', keywords: ['docker', 'images'], section: 'Navigation' },
  { id: 'nav-deployments', label: 'Deployments', icon: DeployIcon, action: 'navigate', target: '/deployments', keywords: ['deploy', 'rollback', 'releases'], section: 'Navigation' },
  { id: 'nav-settings', label: 'Settings', icon: SettingsIcon, action: 'navigate', target: '/settings', keywords: ['profile', 'password', 'sessions'], section: 'Navigation' },
  { id: 'nav-pipelines', label: 'Pipelines', action: 'navigate', target: '/pipelines', keywords: ['ci', 'cd', 'jobs', 'workflow'], section: 'Navigation' },
  { id: 'nav-traces', label: 'Traces', action: 'navigate', target: '/traces', keywords: ['spans', 'distributed', 'tracing'], section: 'Navigation' },

  // Quick actions
  { id: 'act-logs-error', label: 'View error logs', icon: LogsIcon, action: 'navigate', target: '/logs?level=error', keywords: ['errors', 'failures'], section: 'Quick Actions' },
  { id: 'act-logs-live', label: 'Live log stream', icon: LogsIcon, action: 'navigate', target: '/logs?live=true', keywords: ['tail', 'stream', 'follow'], section: 'Quick Actions' },
];

// =============================================================================
// Component
// =============================================================================

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filter commands
  const filtered = useMemo(() => {
    if (!query.trim()) return COMMANDS;
    const q = query.toLowerCase();
    return COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.keywords.some((kw) => kw.includes(q)) ||
        (cmd.description?.toLowerCase().includes(q) ?? false)
    );
  }, [query]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  const execute = useCallback(
    (cmd: Command) => {
      setOpen(false);
      if (cmd.action === 'navigate') {
        navigate(cmd.target);
      }
    },
    [navigate]
  );

  // Keyboard navigation
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        execute(filtered[selectedIndex]);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [filtered, selectedIndex, execute]
  );

  // Group by section
  const sections = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const cmd of filtered) {
      const list = map.get(cmd.section) ?? [];
      list.push(cmd);
      map.set(cmd.section, list);
    }
    return map;
  }, [filtered]);

  let globalIndex = 0;

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: alpha('#111118', 0.95),
          backdropFilter: 'blur(20px)',
          border: '1px solid',
          borderColor: 'rgba(255,255,255,0.08)',
          borderRadius: 2,
          mt: '15vh',
          alignSelf: 'flex-start',
          maxHeight: '60vh',
          overflow: 'hidden',
        },
      }}
      slotProps={{
        backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' } },
      }}
    >
      {/* Search Input */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <SearchIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
        <InputBase
          inputRef={inputRef}
          placeholder="Search commands, pages, apps..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          fullWidth
          sx={{
            fontSize: '0.95rem',
            color: 'text.primary',
            '& input::placeholder': { color: 'text.secondary', opacity: 1 },
          }}
        />
        <Typography
          variant="caption"
          sx={{
            px: 0.75,
            py: 0.25,
            borderRadius: 0.5,
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'text.secondary',
            fontSize: '0.65rem',
            whiteSpace: 'nowrap',
          }}
        >
          ESC
        </Typography>
      </Box>

      {/* Results */}
      <Box sx={{ overflow: 'auto', maxHeight: 'calc(60vh - 56px)', py: 0.5 }}>
        {filtered.length === 0 && (
          <Typography color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center', fontSize: '0.85rem' }}>
            No results for &quot;{query}&quot;
          </Typography>
        )}

        {Array.from(sections.entries()).map(([section, cmds]) => (
          <Box key={section}>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                px: 2,
                py: 0.75,
                color: 'text.secondary',
                fontSize: '0.65rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {section}
            </Typography>
            {cmds.map((cmd) => {
              const idx = globalIndex++;
              const isSelected = idx === selectedIndex;
              const Icon = cmd.icon;

              return (
                <Box
                  key={cmd.id}
                  onClick={() => execute(cmd)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1,
                    cursor: 'pointer',
                    bgcolor: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
                    transition: 'background-color 100ms',
                  }}
                >
                  {Icon && <Icon sx={{ fontSize: 18, color: isSelected ? 'primary.main' : 'text.secondary' }} />}
                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? 'text.primary' : 'text.secondary',
                    }}
                  >
                    {cmd.label}
                  </Typography>
                  {cmd.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      {cmd.description}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}
