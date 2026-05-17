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
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
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
  type SkinTone,
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
  defaultTone = 0,
  i18n: i18nOverride,
  className,
}: EmojiPickerProps) {
  const i18n = useMemo(() => mergeI18n(i18nOverride), [i18nOverride]);
  const { data, error } = useEmojiData();
  const { recent, push: pushRecent } = useRecentEmojis(maxRecent);

  const [query, setQuery] = useState('');
  const [tone, setTone] = useState<SkinTone>(defaultTone);
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);
  const [activeGroup, setActiveGroup] = useState<string>('recent');

  // Apply skin tone to an emoji entry. Returns the tone-applied
  // unicode + a tone-suffixed id used by the recent list.
  const applyTone = useCallback(
    (entry: EmojiEntry, useTone: SkinTone = tone): PickedEmoji => {
      if (useTone === 0 || !entry.s) {
        return { native: entry.e, id: entry.i, name: entry.n, tone: 0 };
      }
      const idx = (useTone - 1) as 0 | 1 | 2 | 3 | 4;
      const variant = entry.s[idx];
      if (!variant) return { native: entry.e, id: entry.i, name: entry.n, tone: 0 };
      return { native: variant[0], id: variant[1], name: entry.n, tone: useTone };
    },
    [tone],
  );

  // Build the flat row list once per (data, query, recent, tone) change.
  const rows = useMemo<GridRow[]>(() => {
    if (!data) return [];

    if (query.trim()) {
      const matches = searchEmojis(data.dataset.emojis, data.searchTokens, query);
      const out: GridRow[] = [];
      if (matches.length === 0) return out;
      out.push({ kind: 'header', label: i18n.searchPlaceholder, group: 'search' });
      for (let i = 0; i < matches.length; i += perLine) {
        out.push({ kind: 'row', entries: matches.slice(i, i + perLine), group: 'search' });
      }
      return out;
    }

    const out: GridRow[] = [];
    // Recent row first (if non-empty).
    if (recent.length > 0) {
      out.push({ kind: 'header', label: i18n.categories.recent, group: 'recent' });
      const resolved: EmojiEntry[] = [];
      for (const id of recent) {
        // Recent id might carry a tone suffix; look up the base entry.
        const base = id.includes('-') && id.length > 5 ? id.split('-')[0]! : id;
        const entry = data.indexById.get(base) ?? data.indexById.get(id);
        if (entry) {
          // Build a synthetic entry whose `e` field already reflects the
          // recent tone so the grid renders the user's exact prior pick.
          if (id !== base && entry.s) {
            const variant = entry.s.find(([, h]) => h === id);
            if (variant) {
              resolved.push({ ...entry, e: variant[0], i: variant[1] });
              continue;
            }
          }
          resolved.push(entry);
        }
      }
      for (let i = 0; i < resolved.length; i += perLine) {
        out.push({ kind: 'row', entries: resolved.slice(i, i + perLine), group: 'recent' });
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

  // Scroll-spy: keep the active category strip in sync with what's
  // visible at the top of the scroll viewport.
  useEffect(() => {
    if (!data || query) return;
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return;
    const top = items.find((i) => i.start + i.size >= (scrollRef.current?.scrollTop ?? 0));
    const row = top ? rows[top.index] : undefined;
    if (row && row.group !== activeGroup) setActiveGroup(row.group);
  }, [virtualizer, rows, data, query, activeGroup]);

  const handlePick = useCallback(
    (entry: EmojiEntry) => {
      const picked = applyTone(entry);
      pushRecent(picked.id);
      onSelect(picked);
    },
    [applyTone, pushRecent, onSelect],
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
      {/* Search input */}
      <Box sx={{ p: 1, pb: 0.5 }}>
        <TextField
          autoFocus
          size="small"
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={i18n.searchPlaceholder}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start" sx={{ pl: 0.5, color: 'text.disabled' }}>
                  <SearchGlyph />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setQuery('')}
                    sx={{ width: 22, height: 22, color: 'text.disabled' }}
                    aria-label="clear"
                  >
                    <ClearGlyph />
                  </IconButton>
                </InputAdornment>
              ) : null,
              sx: { fontSize: '0.8125rem', borderRadius: 1.5 },
            },
          }}
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
                          <Emoji native={applyTone(entry).native} set={set} size={emojiSize} />
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

      {/* Preview + skin-tone selector */}
      <Stack
        direction="row"
        sx={(theme) => ({
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.25,
          py: 0.75,
          borderTop: `1px solid ${theme.palette.divider}`,
          minHeight: 36,
        })}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
          {hovered ? (
            <>
              <Emoji native={applyTone(hovered).native} set={set} size={20} />
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
              {i18n.searchPlaceholder}
            </Typography>
          )}
        </Stack>

        <Tooltip title={i18n.skinTone}>
          <Box>
            <SkinToneSelector value={tone} onChange={setTone} set={set} />
          </Box>
        </Tooltip>
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

// Skin tone palette: 0 = neutral yellow, 1..5 = Fitzpatrick scale.
// Using literal emoji squares lets us paint with the same Emoji
// renderer the rest of the picker uses — keeps the palette
// consistent across the native/twemoji axis.
const SKIN_TONES: { tone: SkinTone; emoji: string }[] = [
  { tone: 0, emoji: '✋' }, // neutral
  { tone: 1, emoji: '✋🏻' },
  { tone: 2, emoji: '✋🏼' },
  { tone: 3, emoji: '✋🏽' },
  { tone: 4, emoji: '✋🏾' },
  { tone: 5, emoji: '✋🏿' },
];

function SkinToneSelector({
  value,
  onChange,
  set,
}: {
  value: SkinTone;
  onChange: (t: SkinTone) => void;
  set: EmojiSet;
}) {
  const [open, setOpen] = useState(false);
  const current = SKIN_TONES.find((t) => t.tone === value) ?? SKIN_TONES[0]!;
  return (
    <Box sx={{ position: 'relative' }}>
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-label="skin tone"
        sx={{ width: 26, height: 26, borderRadius: '50%' }}
      >
        <Emoji native={current.emoji} set={set} size={18} />
      </ButtonBase>
      {open && (
        <Box
          sx={(theme) => ({
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 4px)',
            display: 'flex',
            gap: 0.25,
            p: 0.5,
            bgcolor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            boxShadow: theme.shadows[4],
            zIndex: 1,
          })}
        >
          {SKIN_TONES.map((t) => (
            <ButtonBase
              key={t.tone}
              onClick={() => {
                onChange(t.tone);
                setOpen(false);
              }}
              sx={(theme) => ({
                width: 26,
                height: 26,
                borderRadius: '50%',
                ...(t.tone === value && {
                  boxShadow: `0 0 0 2px ${theme.palette.primary.main}`,
                }),
              })}
            >
              <Emoji native={t.emoji} set={set} size={18} />
            </ButtonBase>
          ))}
        </Box>
      )}
    </Box>
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
