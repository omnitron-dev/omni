/** Transport- and storage-independent constraints on an authenticated session. */
export interface SessionPolicy {
  requireMfa?: boolean;
  /** Absolute session age in minutes; renewing a token does not reset it. */
  maxSessionDuration?: number;
  timeWindows?: Array<{ days: number[]; startHour: number; endHour: number; timezone: string }>;
}
export interface SessionFacts {
  hasMfa: boolean;
  createdAt: number;
  now?: number;
}
export type SessionPolicyDecision = { allowed: true } | {
  allowed: false; reason: 'invalid_policy' | 'mfa_required' | 'session_expired' | 'outside_time_window';
};

/** Unknown/malformed controls fail closed. Hours use each window's IANA timezone. */
export function evaluateSessionPolicy(policy: SessionPolicy | null, facts: SessionFacts): SessionPolicyDecision {
  if (policy === null) return { allowed: true };
  const now = facts.now ?? Date.now();
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || !Number.isFinite(now) ||
      Object.keys(policy).some(key => !['requireMfa', 'maxSessionDuration', 'timeWindows'].includes(key)) ||
      (policy.requireMfa !== undefined && typeof policy.requireMfa !== 'boolean') ||
      (policy.maxSessionDuration !== undefined && (!Number.isSafeInteger(policy.maxSessionDuration) || policy.maxSessionDuration <= 0)))
    return { allowed: false, reason: 'invalid_policy' };
  if (policy.requireMfa && !facts.hasMfa) return { allowed: false, reason: 'mfa_required' };
  if (policy.maxSessionDuration !== undefined && (!Number.isFinite(facts.createdAt) || facts.createdAt > now ||
      now - facts.createdAt >= policy.maxSessionDuration * 60_000))
    return { allowed: false, reason: 'session_expired' };
  if (policy.timeWindows !== undefined) {
    if (!Array.isArray(policy.timeWindows) || policy.timeWindows.length > 64)
      return { allowed: false, reason: 'invalid_policy' };
    let matches = false;
    for (const window of policy.timeWindows) {
      if (!window || !Array.isArray(window.days) || window.days.length > 7 ||
          window.days.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
          !Number.isInteger(window.startHour) || window.startHour < 0 || window.startHour > 23 ||
          !Number.isInteger(window.endHour) || window.endHour < 0 || window.endHour > 24 ||
          window.startHour === window.endHour || typeof window.timezone !== 'string' || !window.timezone)
        return { allowed: false, reason: 'invalid_policy' };
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: window.timezone,
          weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
        const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find(p => p.type === 'weekday')!.value);
        const hour = Number(parts.find(p => p.type === 'hour')!.value);
        matches ||= window.startHour < window.endHour
          ? window.days.includes(day) && hour >= window.startHour && hour < window.endHour
          : (window.days.includes(day) && hour >= window.startHour) ||
            (window.days.includes((day + 6) % 7) && hour < window.endHour);
      } catch { return { allowed: false, reason: 'invalid_policy' }; }
    }
    if (policy.timeWindows.length && !matches) return { allowed: false, reason: 'outside_time_window' };
  }
  return { allowed: true };
}
