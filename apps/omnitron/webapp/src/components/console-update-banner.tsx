import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import { Alert } from '@omnitron-dev/prism/components/alert';

/** A deployment never discards open editor drafts or terminal sessions by reloading itself. */
export function ConsoleUpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    const current = document.querySelector<HTMLMetaElement>('meta[name="omnitron-console-build"]')?.content;
    let stopped = false;
    let controller: AbortController | null = null;
    const check = async () => {
      if (document.hidden || controller || !current) return;
      controller = new AbortController();
      const timer = window.setTimeout(() => controller?.abort(), 5000);
      try {
        const result = await fetch('/console-version.json', { cache: 'no-store', signal: controller.signal });
        if (!result.ok) return;
        const data: unknown = await result.json();
        if (!stopped && data && typeof data === 'object' && 'version' in data &&
            typeof data.version === 'string' && /^[a-f0-9]{64}$/.test(data.version)) setAvailable(data.version !== current);
      } catch { /* Availability is handled by DaemonOfflineBanner; a failed probe is not an update. */ }
      finally { window.clearTimeout(timer); controller = null; }
    };
    const failed = () => { setLoadFailed(true); void check(); };
    const visible = () => { void check(); };
    window.addEventListener('vite:preloadError', failed);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(visible, 60_000);
    void check();
    return () => {
      stopped = true; controller?.abort(); window.clearInterval(interval);
      window.removeEventListener('vite:preloadError', failed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  if (!available && !loadFailed) return null;
  return (
    <Alert severity={loadFailed ? 'warning' : 'info'} sx={{ borderRadius: 0, py: 0.5 }}
      action={<Button color="inherit" size="small" onClick={() => window.location.reload()}>Reload</Button>}>
      {available ? 'Console update available.' : 'This page could not load. Check your connection and try reloading.'}
      {' Save open edits before reloading; your current workspace stays open until then.'}
    </Alert>
  );
}
