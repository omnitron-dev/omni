/**
 * Toast wrapper with short-window deduplication.
 *
 * Problem: identical toast.error() calls fire twice in dev (React
 * StrictMode double-mounts every effect), and can also fire twice
 * in prod when a parent re-fetches mid-flight or a retry wrapper
 * surfaces the same error path. Sonner has no built-in dedupe, so
 * every duplicate landed as a separate snack-bar.
 *
 * Fix: collapse identical {method, message} calls inside a 1.5 s
 * window. The first call lands; subsequent identical calls within
 * the window are silently dropped. We DON'T forward to sonner's
 * own `id` option because then any later call with a different
 * message but the same id would *replace* the visible toast — we
 * want suppression, not replacement.
 *
 * Drop-in replacement for `import { toast } from 'sonner'`.
 * Same surface: error/success/info/warning + the passthroughs.
 *
 * Lives in prism so every UI app on the platform shares one
 * notification policy instead of each app reinventing it.
 */
import { toast as sonner } from 'sonner';

type ToastFn = (message: string, options?: Parameters<typeof sonner.error>[1]) => void;

const DEDUP_WINDOW_MS = 1500;
const recent = new Map<string, number>();

function shouldSuppress(key: string): boolean {
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
    recent.set(key, now);
    return true;
  }
  recent.set(key, now);
  // Sweep entries older than 4x the window to keep the map bounded.
  if (recent.size > 64) {
    const cutoff = now - DEDUP_WINDOW_MS * 4;
    for (const [k, t] of recent) if (t < cutoff) recent.delete(k);
  }
  return false;
}

function makeMethod(method: 'error' | 'success' | 'info' | 'warning'): ToastFn {
  return (message, options) => {
    const key = `${method}:${message}`;
    if (shouldSuppress(key)) return;
    sonner[method](message, options);
  };
}

// Use `typeof sonner` as the public type so we don't have to re-spell
// every method signature (and so sonner's internal types — e.g.
// `PromiseIExtendedResult` from `toast.promise` — don't have to be
// re-exported from prism's DTS bundle).
export const toast: typeof sonner = Object.assign(
  // Allow `toast(msg)` (sonner's default = neutral toast) to work too.
  ((message: string, options?: Parameters<typeof sonner>[1]) => {
    const key = `default:${message}`;
    if (shouldSuppress(key)) return;
    sonner(message, options);
  }) as typeof sonner,
  {
    error: makeMethod('error'),
    success: makeMethod('success'),
    info: makeMethod('info'),
    warning: makeMethod('warning'),
    // Pass-through methods that don't need dedup
    loading: sonner.loading.bind(sonner),
    promise: sonner.promise.bind(sonner),
    dismiss: sonner.dismiss.bind(sonner),
    custom: sonner.custom.bind(sonner),
    message: sonner.message.bind(sonner),
  }
) as typeof sonner;
