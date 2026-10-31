import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { CommandPalette, type CommandAction } from '@omnitron-dev/prism/components/command-palette';
import type { LayoutNavData } from '@omnitron-dev/prism/layouts';
import {
  WORKSPACE_COMMANDS,
  commandControl,
  controlDisabled,
  focusRegion,
  invokeControl,
  isEditing,
  isVisible,
  ownsKeyboard,
  type WorkspaceCommand,
} from './keyboard-model';

export interface ConsoleAction extends CommandAction {
  key?: string;
}
interface CommandScope {
  actions: ConsoleAction[];
  region?: RefObject<HTMLElement | null>;
}
const KeyboardContext = createContext({
  openCommands: () => {},
  openHelp: () => {},
  register:
    (_id: string, _scope: CommandScope): (() => void) =>
    () => {},
});
export const useConsoleKeyboard = () => useContext(KeyboardContext);

/** One callback for pointer controls, keyboard and palette; the active region owns the binding. */
export function useConsoleActions(
  actions: ConsoleAction[],
  enabled = true,
  region?: RefObject<HTMLElement | null>
): void {
  const { register } = useConsoleKeyboard(),
    id = useId(),
    latest = useRef(actions);
  latest.current = actions;
  const available = useRef(enabled);
  available.current = enabled;
  const signature = JSON.stringify(actions.map(({ onSelect: _run, icon: _icon, ...metadata }) => metadata));
  useEffect(() => {
    if (!enabled) return undefined;
    return register(id, {
      region,
      actions: latest.current.map((action) => ({
        ...action,
        onSelect: () => {
          const current = latest.current.find((item) => item.id === action.id);
          return available.current && (!region || (region.current && isVisible(region.current))) && current && !current.disabled ? current.onSelect() : undefined;
        },
      })),
    });
  }, [id, signature, enabled, register, region]);
}

const HELP = [
  ['Console', 'Ctrl / ⌘ K', 'Search available pages and commands'],
  ['Console', 'Ctrl / ⌘ /', 'Open this keyboard guide'],
  ['Console', 'F6 · Shift F6', 'Next / previous workspace region, including from SSH or the editor'],
  ['Current view', '/ · R', 'Focus search / refresh, when those controls are available'],
  ['Controls', 'Tab · Shift Tab', 'Next / previous control; arrows switch tabs and menu items'],
  ['Tables', '↑ ↓ · Home End · Page ↑ ↓', 'Browse rows; Enter opens, Space selects, Escape returns to the table'],
  ['Files', 'Tab · Shift Tab', 'Switch A / B while the file list has focus'],
  ['Files', '↑ ↓ · Shift ↑ ↓ · Space', 'Move cursor, extend selection, toggle a file'],
  ['Files', 'Enter · Alt ↑ · Alt ← →', 'Open / parent folder / directory history'],
  ['Files', 'F2 · F4 · F5 · Delete', 'Rename / edit / copy / trash; confirmations and permissions still apply'],
  ['Files', 'Ctrl / ⌘ L · Ctrl / ⌘ A', 'Edit path / select loaded files'],
  ['Logs', 'Home', 'Jump to the newest logs without changing filters'],
  ['Topology', '0 · 1', 'Fit the graph / restore a readable viewport'],
  ['Dialogs', 'Escape', 'Close the topmost dialog; unsaved changes still require a decision'],
] as const;

/** Navigation comes from the authorized menu; view commands invoke the existing controls. */
export function ConsoleKeyboard({ navigation, children }: { navigation: LayoutNavData; children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false),
    [help, setHelp] = useState(false);
  const [contextual, setContextual] = useState<CommandAction[]>([]);
  const [scopes, setScopes] = useState<Record<string, CommandScope>>({});
  const register = useCallback((id: string, scope: CommandScope) => {
    setScopes((previous) => ({ ...previous, [id]: scope }));
    return () =>
      setScopes((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
  }, []);
  const pending = useRef<(() => void) | null>(null);
  const openCommands = () => {
    setContextual(
      (
        Object.entries(WORKSPACE_COMMANDS) as Array<[WorkspaceCommand, (typeof WORKSPACE_COMMANDS)[WorkspaceCommand]]>
      ).flatMap(([id, definition]) => {
        const control = commandControl(id);
        return control
          ? [
              {
                id: `view-${id}`,
                title: definition.title,
                group: 'Current view',
                shortcut: [definition.hint],
                disabled: controlDisabled(control),
                onSelect: () => {
                  pending.current = () => invokeControl(id, control);
                },
              },
            ]
          : [];
      })
    );
    setOpen(true);
  };
  const actions = useMemo<CommandAction[]>(
    () => [
      ...Object.values(scopes).flatMap((scope) =>
        scope.actions.map((action) => ({
          ...action,
          onSelect: () => {
            pending.current = () => {
              void action.onSelect();
            };
          },
        }))
      ),
      ...contextual,
      ...navigation.flatMap((section) =>
        section.items.flatMap((item) =>
          item.path
            ? [
                {
                  id: `nav-${item.path}`,
                  title: item.title,
                  group: section.subheader ?? 'Navigation',
                  icon: item.icon,
                  onSelect: () => {
                    pending.current = () => navigate(item.path!);
                  },
                },
              ]
            : []
        )
      ),
      {
        id: 'keyboard-guide',
        title: 'Keyboard shortcuts',
        group: 'Console',
        shortcut: ['Ctrl / ⌘', '/'],
        onSelect: () => {
          pending.current = () => setHelp(true);
        },
      },
    ],
    [contextual, scopes, navigation, navigate]
  );

  useEffect(() => {
    const modalOpen = () =>
      [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],[role="menu"]')].some(isVisible);
    // F6 is the one explicit escape from embedded editors/terminals. All text
    // editing and terminal control sequences otherwise belong to that surface.
    const regions = (event: KeyboardEvent) => {
      if (
        event.key === 'F6' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.isComposing &&
        !modalOpen()
      ) {
        event.preventDefault();
        event.stopPropagation();
        focusRegion(event.shiftKey ? -1 : 1);
      }
    };
    const shortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || modalOpen() || ownsKeyboard(event.target))
        return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommands();
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key === '/') {
        event.preventDefault();
        setHelp(true);
        return;
      }
      if (mod || event.altKey || event.shiftKey || isEditing(event.target)) return;
      const local = Object.values(scopes)
        .filter((scope) => !scope.region || scope.region.current?.contains(event.target as Node))
        .flatMap((scope) => scope.actions)
        .find((action) => action.key?.toLowerCase() === event.key.toLowerCase());
      if (local) {
        event.preventDefault();
        if (!local.disabled) void local.onSelect();
        return;
      }
      const entry = Object.entries(WORKSPACE_COMMANDS).find(
        ([, command]) => command.key.toLowerCase() === event.key.toLowerCase()
      );
      if (!entry) return;
      const command = entry[0] as WorkspaceCommand,
        control = commandControl(command);
      if (control && !controlDisabled(control)) {
        event.preventDefault();
        invokeControl(command, control);
      }
    };
    window.addEventListener('keydown', regions, true);
    window.addEventListener('keydown', shortcuts);
    return () => {
      window.removeEventListener('keydown', regions, true);
      window.removeEventListener('keydown', shortcuts);
    };
  });

  return (
    <KeyboardContext.Provider value={{ openCommands, openHelp: () => setHelp(true), register }}>
      {children}
      <CommandPalette
        actions={actions}
        open={open}
        onOpenChange={setOpen}
        disableShortcut
        placeholder="Search Console commands…"
        onClosed={() => {
          const run = pending.current;
          pending.current = null;
          if (run) requestAnimationFrame(run);
        }}
      />
      <Dialog open={help} onClose={() => setHelp(false)} fullWidth maxWidth="md" aria-labelledby="keyboard-guide-title">
        <DialogTitle id="keyboard-guide-title">Keyboard</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Console → workspace region → focused control. Fields, editors and SSH own their input. F6 moves focus
            between regions; shortcuts never bypass permissions or confirmation dialogs.
          </Typography>
          <Stack divider={<Divider />}>
            {HELP.map(([scope, keys, description]) => (
              <Box
                key={scope + keys}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '100px minmax(180px, 1fr) 2fr' },
                  gap: 1,
                  py: 1,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {scope}
                </Typography>
                <Typography component="kbd" variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {keys}
                </Typography>
                <Typography variant="body2">{description}</Typography>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHelp(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </KeyboardContext.Provider>
  );
}
