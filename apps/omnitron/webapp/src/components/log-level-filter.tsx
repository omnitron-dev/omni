import { Autocomplete, Chip, Stack, TextField, createFilterOptions } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { isQueryLogLevel, MAX_QUERY_LEVELS } from '../../../src/shared/log-levels';
import { DEFAULT_LOG_LEVELS } from 'src/utils/log-levels';
import { logLevelColor } from 'src/components/log-entry-row';

const suggestions = createFilterOptions<string>({ limit: 20 });

export function LogLevelFilter({ selected, counts, onChange, showCounts = false }: {
  selected: readonly string[];
  counts: ReadonlyMap<string, number>;
  showCounts?: boolean;
  onChange: (levels: string[]) => void;
}) {
  const theme = useTheme();
  const custom = selected.filter(level => !DEFAULT_LOG_LEVELS.includes(level));
  const observed = [...counts.keys()].filter(level => isQueryLogLevel(level) && !DEFAULT_LOG_LEVELS.includes(level));
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
      {DEFAULT_LOG_LEVELS.map(level => {
        const active = selected.includes(level);
        const color = logLevelColor(level, theme);
        return (
          <Chip key={level} label={showCounts ? `${level} ${counts.get(level) ?? 0}` : level} size="small" variant={active ? 'filled' : 'outlined'}
            title={`${level} · ${counts.get(level) ?? 0}`} aria-pressed={active}
            disabled={!active && selected.length >= MAX_QUERY_LEVELS}
            onClick={() => onChange(active ? selected.filter(value => value !== level) : [...selected, level])}
            sx={{ fontFamily: 'monospace', height: 24, fontSize: 11, textTransform: 'uppercase',
              color: active ? theme.palette.getContrastText(color) : color,
              borderColor: alpha(color, 0.45), bgcolor: active ? color : undefined }} />
        );
      })}
      <Autocomplete multiple freeSolo size="small" limitTags={1} filterSelectedOptions filterOptions={suggestions}
        options={observed} value={custom}
        onChange={(_, next) => {
          const standard = selected.filter(level => DEFAULT_LOG_LEVELS.includes(level));
          const customLevels = next.filter(level => isQueryLogLevel(level) && !DEFAULT_LOG_LEVELS.includes(level));
          const levels = [...new Set([...standard, ...customLevels])];
          if (levels.length <= MAX_QUERY_LEVELS) onChange(levels);
        }}
        renderInput={params => <TextField {...params} label="Custom levels" />}
        sx={{ width: 190, maxWidth: '100%' }} />
    </Stack>
  );
}
