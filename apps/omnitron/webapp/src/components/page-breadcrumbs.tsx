import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import { Breadcrumbs as PrismBreadcrumbs, type BreadcrumbsProps } from '@omnitron-dev/prism/components/breadcrumbs';

/** One navigation trail per page; the accessible title does not consume workspace. */
export function Breadcrumbs({
  heading,
  links = [],
  backHref,
  sx,
  active = true,
  action,
  ...props
}: BreadcrumbsProps & { active?: boolean }) {
  const title = heading || links.at(-1)?.name || 'Console';
  const trail = links.length ? links : [{ name: title }];
  const navigation =
    trail[0]?.href === '/' || trail[0]?.name === 'Console' ? [...trail] : [{ name: 'Console', href: '/' }, ...trail];
  if (backHref && !navigation.some((link) => link.href === backHref)) {
    navigation.splice(navigation.length - 1, 0, { name: 'Back', href: backHref });
  }
  useEffect(() => {
    if (active) document.title = `${title} · Omnitron`;
  }, [title, active]);
  return (
    <>
      <Box
        component="h1"
        sx={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          p: 0,
          m: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {title}
      </Box>
      <Box data-keyboard-region="Page tools" tabIndex={-1} sx={{ minWidth: 0, flexShrink: 0 }}>
      <PrismBreadcrumbs
        {...props}
        links={navigation}
        linkComponent={Link}
        action={
          action ? (
            <Box sx={{ minWidth: 0, maxWidth: '100%', '& > .MuiStack-root': { flexWrap: 'wrap' } }}>{action}</Box>
          ) : undefined
        }
        sx={[
          {
            minWidth: 0,
            flexShrink: 0,
            '& .MuiBreadcrumbs-ol': { rowGap: 0.5 },
            '& .MuiBreadcrumbs-li': { minWidth: 0 },
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      />
      </Box>
    </>
  );
}
