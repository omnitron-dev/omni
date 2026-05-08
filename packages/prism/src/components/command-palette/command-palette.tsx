/**
 * CommandPalette — keyboard-driven action launcher.
 *
 * A modal palette opened by a global shortcut (default Cmd/Ctrl+K)
 * that lets the user search and trigger any `CommandAction` in the
 * registered set. Actions can be grouped (`group`) for visual
 * separation and filtered with case-insensitive matching against
 * `title`, `subtitle`, and any `keywords`. Arrow keys move the
 * highlight, Enter selects, Escape closes.
 *
 * Use cases: app-wide navigation jumps, frequently used admin
 * actions, contextual menus that need a quick-search affordance.
 *
 * @example
 * ```tsx
 * <CommandPalette
 *   actions={[
 *     {
 *       id: 'go-users',
 *       title: 'Go to Users',
 *       group: 'Navigation',
 *       keywords: ['admin', 'list'],
 *       onSelect: () => navigate('/admin/users'),
 *     },
 *   ]}
 * />
 * ```
 */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import { alpha } from '@mui/material/styles';

export interface CommandAction {
  /** Stable action identifier — used as React key. */
  id: string;
  /** Primary text shown in the row. */
  title: string;
  /** Optional secondary text shown beside the title. */
  subtitle?: string;
  /** Group label — actions sharing a group are visually clustered. */
  group?: string;
  /** Extra search terms (synonyms, aliases). */
  keywords?: readonly string[];
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Optional shortcut hint (e.g. ['⌘', 'P']) shown right-aligned. */
  shortcut?: readonly string[];
  /** Disable the action without removing it from the list. */
  disabled?: boolean;
  /** Action handler. The palette closes after `onSelect` resolves. */
  onSelect: () => void | Promise<void>;
}

export interface CommandPaletteProps {
  /** Registered actions. Re-render to update; use a memoized array. */
  actions: readonly CommandAction[];
  /**
   * Controlled open state. If omitted, the palette opens itself when
   * `triggerKey` is pressed and closes on Escape/select.
   */
  open?: boolean;
  /** Open-state setter for the controlled mode. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Global keyboard shortcut to open. Default `'k'` (paired with the
   * platform meta key — ⌘ on macOS, Ctrl elsewhere).
   */
  triggerKey?: string;
  /** Disable the global shortcut (useful in nested palettes). */
  disableShortcut?: boolean;
  /** Placeholder for the search field. */
  placeholder?: string;
  /** Empty-state copy shown when no actions match. */
  emptyMessage?: string;
}

export function CommandPalette({
  actions,
  open: controlledOpen,
  onOpenChange,
  triggerKey = 'k',
  disableShortcut = false,
  placeholder = 'Type a command or search…',
  emptyMessage = 'No matching commands',
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global shortcut. We listen on `keydown` capture-phase so editors
  // (TipTap, Monaco, etc.) can preventDefault before us if they need
  // the same key for something — they own focus, so they get priority.
  useEffect(() => {
    if (disableShortcut) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === triggerKey.toLowerCase() && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [triggerKey, disableShortcut, open, setOpen]);

  // Reset query + highlight every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      // Defer focus to the next frame so the dialog's transition has
      // mounted the input.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  const filtered = useMemo(() => filterActions(actions, query), [actions, query]);

  // Re-clamp the highlight when filtering changes.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered.length, highlight]);

  const runAction = useCallback(
    async (action: CommandAction) => {
      if (action.disabled) return;
      setOpen(false);
      try {
        await action.onSelect();
      } catch {
        // Swallow — the caller's onSelect is responsible for surfacing
        // its own errors. We just don't want a rejected promise to
        // crash the palette host.
      }
    },
    [setOpen],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (filtered.length === 0 ? 0 : (h + 1) % filtered.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (filtered.length === 0 ? 0 : (h - 1 + filtered.length) % filtered.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = filtered[highlight];
        if (target) void runAction(target);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    },
    [filtered, highlight, runAction, setOpen],
  );

  // Group rows for rendering. Within each group we record the absolute
  // index so the highlight cursor can address rows by their position
  // in the flat filtered list.
  const grouped = useMemo(() => groupActions(filtered), [filtered]);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          sx: { borderRadius: 2, mt: '10vh', alignSelf: 'flex-start' },
        },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            variant="standard"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            slotProps={{
              input: {
                disableUnderline: true,
                startAdornment: (
                  <InputAdornment position="start" sx={{ ml: 0.5, mr: 1 }}>
                    <Box component="span" sx={{ fontSize: 18, opacity: 0.6 }}>
                      ⌘
                    </Box>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
        <Divider />
        <Box
          sx={{
            maxHeight: 360,
            overflowY: 'auto',
            py: 0.5,
          }}
        >
          {filtered.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {emptyMessage}
              </Typography>
            </Box>
          ) : (
            grouped.map((g) => (
              <Box key={g.label ?? '__none__'}>
                {g.label ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      px: 2,
                      py: 0.75,
                      display: 'block',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {g.label}
                  </Typography>
                ) : null}
                {g.items.map((entry) => (
                  <Row
                    key={entry.action.id}
                    action={entry.action}
                    selected={entry.flatIndex === highlight}
                    onSelect={() => void runAction(entry.action)}
                    onHover={() => setHighlight(entry.flatIndex)}
                  />
                ))}
              </Box>
            ))
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  action,
  selected,
  onSelect,
  onHover,
}: {
  action: CommandAction;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Keep the highlighted row in view as the user navigates.
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  return (
    <Box
      ref={ref}
      onMouseEnter={onHover}
      onClick={onSelect}
      sx={(theme) => ({
        px: 2,
        py: 1.25,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        cursor: action.disabled ? 'not-allowed' : 'pointer',
        opacity: action.disabled ? 0.5 : 1,
        bgcolor: selected ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
        '&:hover': {
          bgcolor: selected
            ? alpha(theme.palette.primary.main, 0.16)
            : alpha(theme.palette.action.hover, 1),
        },
      })}
    >
      {action.icon ? (
        <Box sx={{ display: 'flex', alignItems: 'center', width: 20, opacity: 0.8 }}>
          {action.icon}
        </Box>
      ) : null}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
            {action.title}
          </Typography>
          {action.subtitle ? (
            <Typography variant="caption" color="text.secondary" noWrap>
              {action.subtitle}
            </Typography>
          ) : null}
        </Stack>
      </Box>
      {action.shortcut?.length ? (
        <Stack direction="row" spacing={0.5}>
          {action.shortcut.map((k, i) => (
            <Chip
              key={i}
              size="small"
              label={k}
              variant="outlined"
              sx={{ height: 20, fontSize: 10, fontFamily: 'monospace' }}
            />
          ))}
        </Stack>
      ) : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Filtering — case-insensitive substring match across title, subtitle,
// and any explicit keywords. We intentionally avoid full fuzzy matching
// at this size; a substring score keeps the most-recently-typed prefix
// at the top, which matches user mental models for command palettes.
// ---------------------------------------------------------------------------

function filterActions(
  actions: readonly CommandAction[],
  query: string,
): readonly CommandAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return actions;

  type Scored = { action: CommandAction; score: number };
  const scored: Scored[] = [];

  for (const action of actions) {
    const haystacks: string[] = [action.title.toLowerCase()];
    if (action.subtitle) haystacks.push(action.subtitle.toLowerCase());
    if (action.keywords?.length) {
      for (const k of action.keywords) haystacks.push(k.toLowerCase());
    }

    let bestScore = -1;
    for (const h of haystacks) {
      const idx = h.indexOf(q);
      if (idx === -1) continue;
      // Prefix matches outrank mid-string matches.
      const score = idx === 0 ? 1000 - h.length : 100 - idx;
      if (score > bestScore) bestScore = score;
    }
    if (bestScore >= 0) scored.push({ action, score: bestScore });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.action);
}

interface GroupedRow {
  label: string | undefined;
  items: { action: CommandAction; flatIndex: number }[];
}

function groupActions(actions: readonly CommandAction[]): GroupedRow[] {
  const out = new Map<string, GroupedRow>();
  let flatIndex = 0;
  for (const action of actions) {
    const label = action.group;
    const key = label ?? '__none__';
    let bucket = out.get(key);
    if (!bucket) {
      bucket = { label, items: [] };
      out.set(key, bucket);
    }
    bucket.items.push({ action, flatIndex });
    flatIndex += 1;
  }
  return [...out.values()];
}
