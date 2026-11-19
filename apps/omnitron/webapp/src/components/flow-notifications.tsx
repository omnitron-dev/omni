import { useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Button from '@mui/material/Button';
import { SnackbarProvider, useSnackbar } from '@omnitron-dev/prism/components/snackbar';
import type { FlowWorkspace } from '@omnitron-dev/omnitron/dto/services';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { flows } from 'src/netron/client';
import { flowHref } from 'src/routes/workspace';

const position = { vertical: 'top', horizontal: 'right' } as const;

function NotificationReader({ workspace, mayOpen }: { workspace: FlowWorkspace; mayOpen: boolean }) {
  const cursor = useRef<number | undefined>(undefined);
  const snackbar = useSnackbar();
  const { data } = usePolledResource(
    () => flows.notifications({ workspace, ...(cursor.current !== undefined && { after: cursor.current }), limit: 32 }),
    { intervalMs: 5000 }
  );
  useEffect(() => {
    if (!data) return;
    const prior = cursor.current;
    cursor.current = data.cursor;
    if (prior === undefined || data.cursor <= prior) return;
    const fresh = data.items.filter((item) => item.sequence > prior);
    if (!fresh.length) return;
    const first = fresh[0]!;
    const oneFlow = fresh.every((item) => item.flowId === first.flowId);
    const titles = fresh
      .slice(0, 3)
      .map((item) => item.title)
      .join(' · ');
    snackbar.info(titles + (fresh.length > 3 ? ' · +' + (fresh.length - 3) : ''), {
      key: first.id,
      ...(mayOpen && {
        action: (
          <Button
            size="small"
            color="inherit"
            component={RouterLink}
            to={flowHref(workspace, oneFlow ? { flow: first.flowId } : {})}
          >
            {oneFlow ? 'Open flow' : 'Open flows'}
          </Button>
        ),
      }),
    });
  }, [data, mayOpen, snackbar, workspace]);
  return null;
}

/** The layout keys this notification region by its account and workspace, including its visible message. */
export function FlowNotifications({ workspace, mayOpen }: { workspace: FlowWorkspace; mayOpen: boolean }) {
  return (
    <SnackbarProvider defaultPosition={position}>
      <NotificationReader workspace={workspace} mayOpen={mayOpen} />
    </SnackbarProvider>
  );
}
