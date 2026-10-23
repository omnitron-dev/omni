import { useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { Box, Button, Stack } from '@mui/material';
import { createPrismTheme } from '../../../src/theme';
import { KnowledgeGraph } from '../../../src/components/knowledge-graph';

/** Browser acceptance fixture: repeated roles are separate incidence edges. */
export function KnowledgeGraphTestPage() {
  const [long, setLong] = useState(false),
    [dark, setDark] = useState(false),
    [changed, setChanged] = useState(false),
    [removed, setRemoved] = useState(false);
  const theme = useMemo(() => createPrismTheme({ mode: dark ? 'dark' : 'light' }), [dark]);
  const data = useMemo(
    () => ({
      entities: [
        { id: 'source', kind: 'claim', label: 'Исходное утверждение / Source claim' },
        {
          id: 'proof',
          kind: 'formalization',
          label: 'Formal judgment',
          badges: [
            {
              label: changed ? 'Premises changed: attributed review required' : 'Proof verified',
              tone: changed ? ('warning' as const) : ('success' as const),
            },
          ],
        },
        { id: 'map', kind: 'interpretation', label: 'Source–formal correspondence' },
      ],
      relations: removed
        ? []
        : [
            {
              id: 'r',
              kind: 'context',
              label: 'Ordered dependency contract',
              inputs: Array.from({ length: 9 }, (_, i) => ({
                entity: i === 1 ? 'proof' : 'source',
                role: `${i + 1}. ${long ? 'Interpretation of a quantified variable / Интерпретация связанной переменной с точной цитатой источника Ω' : 'interpretation'} · context`,
              })),
              outputs: [{ entity: 'map', role: 'owner' }],
            },
          ],
    }),
    [long, changed, removed]
  );
  return (
    <ThemeProvider theme={theme}>
      <Box component="main" sx={{ p: 2, bgcolor: 'background.paper', color: 'text.primary' }}>
        <h1>Knowledge graph acceptance</h1>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button onClick={() => setLong((v) => !v)}>Toggle long roles</Button>
          <Button onClick={() => setDark((v) => !v)}>Toggle theme</Button>
          <Button onClick={() => setChanged((v) => !v)}>Change proof status</Button>
          <Button onClick={() => setRemoved((v) => !v)}>Toggle relation</Button>
        </Stack>
        <KnowledgeGraph data={data} height={650} />
      </Box>
    </ThemeProvider>
  );
}
