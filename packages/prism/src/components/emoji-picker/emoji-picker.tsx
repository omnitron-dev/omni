/**
 * EmojiPicker — the prism-native replacement for emoji-mart.
 *
 * Anatomy (top → bottom):
 *   - Search input (sticky)
 *   - Category strip (sticky, scrolls horizontally on overflow)
 *   - Virtualised grid (rows of `perLine`, windowed by @tanstack/react-virtual)
 *   - Preview bar (last hovered / focused emoji + label) + skin-tone selector
 *
 * Design constraints
 *   - Zero blocking JS on mount: dataset is loaded in a separate
 *     chunk via dynamic import. A 32-row skeleton holds the panel
 *     shape while the JSON streams.
 *   - One re-render per keystroke. Search runs synchronously over a
 *     pre-computed blob array (see emoji-search.ts) — at ~1900
 *     entries this stays well under a frame budget.
 *   - Twitter rendering uses jsdelivr's twemoji CDN; native fallback
 *     kicks in per-emoji if the SVG fails.
 *   - All theming flows through MUI: sx accepts the theme function
 *     so the picker matches the host app's palette + density.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Emoji } from './emoji.js';
import { searchEmojis } from './emoji-search.js';
import { useEmojiData } from './use-emoji-data.js';
import { useRecentEmojis } from './use-recent-emojis.js';
import {
  DEFAULT_I18N,
  type EmojiEntry,
  type EmojiPickerI18n,
  type EmojiPickerProps,
  type EmojiSet,
  type PickedEmoji,
} from './types.js';

// Match emojibase's group ordering (after we dropped "components").
const GROUP_KEYS = [
  'smileys',
  'people',
  'nature',
  'food',
  'travel',
  'activities',
  'objects',
  'symbols',
  'flags',
] as const satisfies readonly (keyof EmojiPickerI18n['categories'])[];

// Lightweight inline icons — avoids pulling in @mui/icons-material as
// a runtime dep for prism's smallest atoms.
const GROUP_ICONS: Record<(typeof GROUP_KEYS)[number], string> = {
  smileys: '😀',
  people: '👋',
  nature: '🌿',
  food: '🍕',
  travel: '✈️',
  activities: '⚽',
  objects: '💡',
  symbols: '❤️',
  flags: '🏳️',
};

interface GridRow {
  /** Either a section header (string) or an array of emoji entries (one per cell). */
  kind: 'header' | 'row';
  /** Header text for `kind === 'header'`. */
  label?: string;
  /** Emoji entries in `kind === 'row'`. */
  entries?: EmojiEntry[];
  /** Group key the row belongs to — used by the category strip to scroll-spy. */
  group: string;
}

export function EmojiPicker({
  onSelect,
  set = 'twitter',
  perLine = 9,
  emojiSize = 22,
  maxRecent = 16,
  i18n: i18nOverride,
  className,
}: EmojiPickerProps) {
  const i18n = useMemo(() => mergeI18n(i18nOverride), [i18nOverride]);
  const { data, error } = useEmojiData();
  const { recent, push: pushRecent } = useRecentEmojis(maxRecent);

  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);
  const [activeGroup, setActiveGroup] = useState<string>('recent');

  // Build the flat row list once per (data, query, recent) change.
  // Each pick produces a `PickedEmoji` shape directly from the
  // dataset entry — no per-pick mutation needed.
  const rows = useMemo<GridRow[]>(() => {
    if (!data) return [];

    if (query.trim()) {
      const matches = searchEmojis(data.dataset.emojis, data.searchTokens, query);
      const out: GridRow[] = [];
      if (matches.length === 0) return out;
      out.push({ kind: 'header', label: i18n.searchResults, group: 'search' });
      for (let i = 0; i < matches.length; i += perLine) {
        out.push({ kind: 'row', entries: matches.slice(i, i + perLine), group: 'search' });
      }
      return out;
    }

    const out: GridRow[] = [];
    // Recent row first (if non-empty). Lookups are by base id — the
    // picker no longer produces tone-suffixed ids, so the lookup is
    // a single map hit. Pre-existing tone-suffixed ids in localStorage
    // are skipped (they'd otherwise render as "?", and they'll age out
    // of the MRU after a few picks).
    if (recent.length > 0) {
      const resolved: EmojiEntry[] = [];
      for (const id of recent) {
        const entry = data.indexById.get(id);
        if (entry) resolved.push(entry);
      }
      if (resolved.length > 0) {
        out.push({ kind: 'header', label: i18n.categories.recent, group: 'recent' });
        for (let i = 0; i < resolved.length; i += perLine) {
          out.push({ kind: 'row', entries: resolved.slice(i, i + perLine), group: 'recent' });
        }
      }
    }

    // Category sections (smileys → flags).
    const byGroup: EmojiEntry[][] = data.dataset.groups.map(() => []);
    for (const e of data.dataset.emojis) byGroup[e.g]!.push(e);

    for (let g = 0; g < data.dataset.groups.length; g++) {
      const groupKey = GROUP_KEYS[g];
      const entries = byGroup[g]!;
      if (!groupKey || entries.length === 0) continue;
      out.push({
        kind: 'header',
        label: i18n.categories[groupKey],
        group: groupKey,
      });
      for (let i = 0; i < entries.length; i += perLine) {
        out.push({ kind: 'row', entries: entries.slice(i, i + perLine), group: groupKey });
      }
    }

    return out;
  }, [data, query, recent, perLine, i18n]);

  // Virtualised grid — fixed row height keeps positioning trivial.
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerHeight = 28;
  const rowHeight = emojiSize + 14; // emoji + vertical padding
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? headerHeight : rowHeight),
    overscan: 6,
  });

  // ----- Scroll-spy -----
  //
  // We can't drive this off a `useEffect` keyed on the virtualizer
  // object — its identity is stable across scrolls. The previous
  // version subscribed to `virtualizer.getVirtualItems()` inside an
  // effect's body, which only re-evaluates when the effect's deps
  // change, never on actual scroll. The result was that the active
  // category never advanced past `recent` (or `smileys` for users
  // without a recent list) no matter how far you scrolled.
  //
  // Fix: bind to the scroll container's native `scroll` event and
  // walk the cached `virtualizer.measurementsCache` (synchronous,
  // already computed) to find the first row whose start >= viewport
  // top. A short rAF debounce coalesces fast scrolls into a single
  // setState — the strip stays jitter-free.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!data || query) return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;

    let raf = 0;
    const HEADER_OFFSET = 24; // bias so a section's first row counts as "in"
    const update = () => {
      raf = 0;
      const currentRows = rowsRef.current;
      const top = el.scrollTop + HEADER_OFFSET;
      const measurements = virtualizer.measurementsCache;
      // Walk linearly — measurements is in row order and we typically
      // only travel a few entries past the previous active section.
      let activeIdx = -1;
      for (let i = 0; i < measurements.length; i++) {
        const m = measurements[i]!;
        if (m.start <= top) activeIdx = i;
        else break;
      }
      const row = activeIdx >= 0 ? currentRows[activeIdx] : currentRows[0];
      if (row) {
        setActiveGroup((prev) => (prev === row.group ? prev : row.group));
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };

    // Prime the initial value so the strip is correct on first render.
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [data, query, virtualizer]);

  const handlePick = useCallback(
    (entry: EmojiEntry) => {
      const picked: PickedEmoji = { native: entry.e, id: entry.i, name: entry.n };
      pushRecent(picked.id);
      onSelect(picked);
    },
    [pushRecent, onSelect],
  );

  // Jump to a section when a category icon is clicked.
  const jumpTo = useCallback(
    (groupKey: string) => {
      const idx = rows.findIndex((r) => r.kind === 'header' && r.group === groupKey);
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: 'start' });
        setActiveGroup(groupKey);
      }
    },
    [rows, virtualizer],
  );

  return (
    <Box
      className={className}
      sx={(theme) => ({
        width: perLine * (emojiSize + 14) + 32,
        maxWidth: '100%',
        height: 380,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 2,
        boxShadow: theme.shadows[8],
        overflow: 'hidden',
      })}
    >
      {/* Search input — InputBase (not OutlinedInput) so there's no
          notched-legend remnant when we don't pass a label. The
          outline is drawn by us via `sx`, so it stays a continuous
          rounded rect with no rvani granica. */}
      <Box sx={{ p: 1, pb: 0.5 }}>
        <InputBase
          autoFocus
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={i18n.searchPlaceholder}
          startAdornment={
            <InputAdornment position="start" sx={{ pl: 0.75, color: 'text.disabled' }}>
              <SearchGlyph />
            </InputAdornment>
          }
          endAdornment={
            query ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setQuery('')}
                  sx={{ width: 22, height: 22, mr: 0.25, color: 'text.disabled' }}
                  aria-label={i18n.clear}
                >
                  <ClearGlyph />
                </IconButton>
              </InputAdornment>
            ) : null
          }
          sx={(theme) => ({
            fontSize: '0.8125rem',
            px: 0.5,
            py: 0.25,
            borderRadius: 1.5,
            border: `1px solid ${theme.palette.divider}`,
            transition: theme.transitions.create(['border-color', 'box-shadow'], {
              duration: theme.transitions.duration.shortest,
            }),
            '&.Mui-focused': {
              borderColor: theme.palette.primary.main,
              boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`,
            },
            '& input::placeholder': {
              color: theme.palette.text.disabled,
              opacity: 1,
            },
          })}
        />
      </Box>

      {/* Category strip */}
      {!query && (
        <Stack
          direction="row"
          sx={(theme) => ({
            px: 0.5,
            borderBottom: `1px solid ${theme.palette.divider}`,
            gap: 0.25,
            overflowX: 'auto',
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { height: 4 },
          })}
        >
          {recent.length > 0 && (
            <CategoryBtn
              icon="🕘"
              label={i18n.categories.recent}
              active={activeGroup === 'recent'}
              onClick={() => jumpTo('recent')}
              set={set}
            />
          )}
          {GROUP_KEYS.map((key) => (
            <CategoryBtn
              key={key}
              icon={GROUP_ICONS[key]}
              label={i18n.categories[key]}
              active={activeGroup === key}
              onClick={() => jumpTo(key)}
              set={set}
            />
          ))}
        </Stack>
      )}

      {/* Grid */}
      <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {!data && !error && (
          <Box sx={{ p: 2 }}>
            <LinearProgress />
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.disabled' }}>
              {i18n.loading}
            </Typography>
          </Box>
        )}
        {error && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="caption" color="error.main">
              {error.message}
            </Typography>
          </Box>
        )}
        {data && rows.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              {i18n.noResults}
            </Typography>
          </Box>
        )}
        {data && rows.length > 0 && (
          <Box
            sx={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]!;
              return (
                <Box
                  key={virtualRow.key}
                  data-row-index={virtualRow.index}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.kind === 'header' ? (
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        fontSize: '0.625rem',
                        letterSpacing: '0.04em',
                        color: 'text.disabled',
                        px: 1.5,
                        pt: 1,
                        pb: 0.5,
                      }}
                    >
                      {row.label}
                    </Typography>
                  ) : (
                    <Stack direction="row" sx={{ px: 1, gap: 0, flexWrap: 'nowrap' }}>
                      {row.entries!.map((entry) => (
                        <ButtonBase
                          key={entry.i}
                          onClick={() => handlePick(entry)}
                          onMouseEnter={() => setHovered(entry)}
                          onFocus={() => setHovered(entry)}
                          aria-label={entry.n}
                          sx={(theme) => ({
                            flex: `0 0 ${emojiSize + 14}px`,
                            height: rowHeight,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 1,
                            transition: 'background-color 0.1s',
                            '&:hover, &:focus-visible': {
                              bgcolor: alpha(theme.palette.primary.main, 0.12),
                            },
                          })}
                        >
                          <Emoji native={entry.e} set={set} size={emojiSize} />
                        </ButtonBase>
                      ))}
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Preview bar */}
      <Stack
        direction="row"
        sx={(theme) => ({
          alignItems: 'center',
          px: 1.25,
          py: 0.75,
          borderTop: `1px solid ${theme.palette.divider}`,
          minHeight: 36,
        })}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
          {hovered ? (
            <>
              <Emoji native={hovered.e} set={set} size={20} />
              <Typography
                variant="caption"
                noWrap
                sx={{ color: 'text.secondary', fontWeight: 500 }}
              >
                {hovered.n}
              </Typography>
            </>
          ) : (
            <Typography
              variant="caption"
              sx={{ color: 'text.disabled', fontStyle: 'italic' }}
            >
              {i18n.previewHint}
            </Typography>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CategoryBtn({
  icon,
  label,
  active,
  onClick,
  set,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  set: EmojiSet;
}) {
  return (
    <Tooltip title={label} placement="bottom">
      <ButtonBase
        onClick={onClick}
        aria-label={label}
        sx={(theme) => ({
          flex: '0 0 auto',
          width: 34,
          height: 34,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 1,
          opacity: active ? 1 : 0.55,
          borderBottom: active
            ? `2px solid ${theme.palette.primary.main}`
            : '2px solid transparent',
          transition: 'opacity 0.15s, border-color 0.15s',
          '&:hover': { opacity: 1 },
        })}
      >
        <Emoji native={icon} set={set} size={18} />
      </ButtonBase>
    </Tooltip>
  );
}

// Inline glyphs — no @mui/icons-material runtime dep.
function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3-3" />
    </svg>
  );
}

function ClearGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 6 12 12M6 18 18 6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// i18n merge helper
// ---------------------------------------------------------------------------

function mergeI18n(override: Partial<EmojiPickerI18n> | undefined): EmojiPickerI18n {
  if (!override) return DEFAULT_I18N;
  return {
    ...DEFAULT_I18N,
    ...override,
    categories: {
      ...DEFAULT_I18N.categories,
      ...(override.categories ?? {}),
    },
  };
}
