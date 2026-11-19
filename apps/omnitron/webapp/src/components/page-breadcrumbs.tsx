import { useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAccess } from 'src/auth/access';
import { stackHref, workspaceHref, workspaceLocation } from 'src/routes/workspace';
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
  const { pathname, search } = useLocation();
  const { project, stack, stackDetail } = workspaceLocation({ pathname, search });
  const { can } = useAccess();
  const overview = can('OmnitronDaemon.status');
  const here = pathname + search;
  const crumb = (name: string, href?: string) => ({ name, ...(href && href !== here && { href }) });
  const scopedTitle = [...new Set([title, stack, project, 'Omnitron'].filter(Boolean))].join(' · ');
  const navigation: NonNullable<BreadcrumbsProps['links']> = [crumb('Console', overview ? '/' : undefined)];
  if (project) {
    navigation.push(crumb(project, overview ? workspaceHref({ project, stack: null }) : undefined));
    if (stack && !stackDetail) {
      const href = can('OmnitronProject.listStacks') ? stackHref(project, stack)
        : overview ? workspaceHref({ project, stack }) : undefined;
      navigation.push(crumb(stack, href));
    }
  }
  navigation.push(...(links.length ? links : [{ name: title }]));
  if (backHref && !navigation.some((link) => link.href === backHref)) {
    navigation.splice(navigation.length - 1, 0, { name: 'Back', href: backHref });
  }
  useEffect(() => {
    if (active) document.title = scopedTitle;
  }, [scopedTitle, active]);
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
        slotProps={{ ...props.slotProps, breadcrumbs: { 'aria-label': 'Breadcrumb', ...props.slotProps?.breadcrumbs } }}
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
