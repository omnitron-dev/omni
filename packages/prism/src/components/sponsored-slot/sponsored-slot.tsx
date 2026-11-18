/**
 * One advertising placement, as every page draws it.
 *
 * Always marked as advertising, by whom, and why it is here — the page's own
 * context, never anything about the reader. Its words are the caller's (it
 * knows the placement and the reader's language); the one word the slot says
 * itself comes through `labels`.
 *
 * Its geometry is fixed by its variant, so a page can reserve the box while
 * the placement is asked for (`loading`) and nothing moves when it arrives. A
 * slot with nothing to show collapses to nothing: an empty frame reads as a
 * broken page, and a placeholder «your ad here» is an ad for advertising.
 */

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { DEFAULT_SPONSORED_SLOT_LABELS, type SponsoredSlotProps } from './types.js';

const TILE_IMAGE = { width: '100%', aspectRatio: '4 / 3' } as const;
const BANNER_IMAGE = { width: { xs: 72, sm: 160 }, minHeight: 120, flexShrink: 0 } as const;
const COMPACT_IMAGE = { width: 48, height: 48, flexShrink: 0, m: 1.5, mr: 0, borderRadius: 1 } as const;

export function SponsoredSlot({
  content,
  variant = 'tile',
  loading = false,
  labels: labelsProp,
  icon,
  link,
  onOpen,
  id,
}: SponsoredSlotProps) {
  const labels = { ...DEFAULT_SPONSORED_SLOT_LABELS, ...labelsProp };
  const banner = variant === 'banner';
  const compact = variant === 'compact';
  const horizontal = banner || compact;
  const imageBox = compact ? COMPACT_IMAGE : banner ? BANNER_IMAGE : TILE_IMAGE;

  if (!content) {
    if (!loading) return null;
    return (
      <Card variant="outlined" sx={{ height: '100%' }} data-sponsored-pending="">
        <Box sx={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', height: '100%' }}>
          <Skeleton variant="rectangular" sx={{ ...imageBox, ...(!horizontal && { height: 'auto' }) }} />
          <Box sx={{ p: 1.5, flex: 1 }}>
            <Skeleton width="40%" />
            <Skeleton width="80%" />
          </Box>
        </Box>
      </Card>
    );
  }

  const mark = (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        color: 'text.secondary',
        typography: 'caption',
        overflowWrap: 'anywhere',
      }}
    >
      {icon}
      {content.byline || labels.sponsored}
    </Box>
  );

  const body = (
    <Box sx={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', height: '100%' }}>
      {content.image && (
        <Box
          component="img"
          src={content.image}
          alt=""
          loading="lazy"
          decoding="async"
          sx={{
            display: 'block',
            objectFit: content.imageFit ?? 'cover',
            ...(content.imageFit === 'contain' && { p: compact ? 0 : 2, boxSizing: 'border-box' }),
            bgcolor: 'action.hover',
            ...imageBox,
          }}
        />
      )}
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
        {content.because ? <Tooltip title={content.because}>{mark}</Tooltip> : mark}
        <Typography variant="subtitle2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {content.title}
        </Typography>
        {content.body && (
          <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {content.body}
          </Typography>
        )}
        {link && content.cta && (
          <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, mt: 'auto' }}>
            {content.cta}
          </Typography>
        )}
      </Box>
    </Box>
  );

  return (
    <Card variant="outlined" sx={{ height: '100%' }} {...(id !== undefined && { 'data-sponsored': id })}>
      {link ? (
        <CardActionArea component={link.component} {...link.props} onClick={onOpen} sx={{ height: '100%' }}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
}
