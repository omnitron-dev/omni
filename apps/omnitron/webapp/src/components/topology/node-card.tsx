import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Card } from '@omnitron-dev/prism/components/card';
import { Label } from '@omnitron-dev/prism/components/label';
import { statusColor } from 'src/utils/constants';
import { TOPOLOGY_CARD_HEIGHT, TOPOLOGY_CARD_WIDTH } from './topology-layout';

/** One bounded, readable summary; the inspector holds unabridged operational details. */
export function NodeCard({
  title,
  icon,
  status,
  selected,
  meta,
  children,
  source = true,
  target = true,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
}: {
  title: string;
  icon: ReactNode;
  status: string;
  selected?: boolean;
  meta?: string;
  children: ReactNode;
  source?: boolean;
  target?: boolean;
  sourcePosition?: Position;
  targetPosition?: Position;
}) {
  const theme = useTheme();
  const palette = theme.vars?.palette ?? theme.palette;
  const kind = statusColor(status);
  const color = kind === 'default' ? palette.text.secondary : palette[kind].main;
  const handleStyle = { background: palette.text.secondary, width: 6, height: 6 };
  return (
    <>
      {target && <Handle type="target" position={targetPosition} style={handleStyle} />}
      {source && <Handle type="source" position={sourcePosition} style={handleStyle} />}
      <Card
        variant="outlined"
        disablePadding
        sx={{
          width: TOPOLOGY_CARD_WIDTH,
          height: TOPOLOGY_CARD_HEIGHT,
          borderRadius: 1.5,
          bgcolor: 'background.paper',
          borderColor: selected ? 'primary.main' : 'divider',
          boxShadow: selected ? `0 0 0 1px ${palette.primary.main}` : 'none',
          cursor: 'pointer',
          '&:hover': { borderColor: 'primary.main' },
        }}
        contentSx={{ height: '100%' }}
      >
        <Stack spacing={1} sx={{ height: '100%', p: 1.5 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minHeight: 44 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                flexShrink: 0,
                borderRadius: 1,
                bgcolor: theme.alpha(color, 0.1),
                color,
                '& svg': { fontSize: 20 },
              }}
            >
              {icon}
            </Box>
            <Tooltip title={title} describeChild>
              <Typography
                component="h3"
                variant="subtitle1"
                sx={{
                  fontSize: 16,
                  lineHeight: 1.375,
                  fontWeight: 650,
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {title}
              </Typography>
            </Tooltip>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Label color={kind} sx={{ flexShrink: 0, height: 22, fontSize: 12, cursor: 'inherit' }}>
              {status}
            </Label>
            {meta && (
              <Typography
                variant="body2"
                noWrap
                title={meta}
                sx={{ fontSize: 13, color: 'text.secondary', minWidth: 0 }}
              >
                {meta}
              </Typography>
            )}
          </Stack>
          <Box sx={{ minWidth: 0, flex: 1, '& .MuiTypography-root': { fontSize: 13, lineHeight: '20px' } }}>
            {children}
          </Box>
        </Stack>
      </Card>
    </>
  );
}
