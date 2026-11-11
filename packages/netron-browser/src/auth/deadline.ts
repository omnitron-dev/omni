const MAX_TIMEOUT = 2_147_483_647;

/** Schedule an absolute deadline without overflowing the platform's timer. */
export function scheduleDeadline(callback: () => void, deadline: number): () => void {
  let cancelled = false;
  const delay = () => Math.min(MAX_TIMEOUT, Math.max(0, deadline - Date.now()));
  let timer = setTimeout(check, delay());

  function check(): void {
    if (cancelled) return;
    if (deadline > Date.now()) {
      timer = setTimeout(check, delay());
      return;
    }
    cancelled = true;
    callback();
  }

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
