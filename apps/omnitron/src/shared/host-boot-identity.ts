import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function isNativeBirthDate(value: string): boolean {
  const match = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([1-9]\d{3})$/.exec(value);
  if (!match) return false;
  const [, day, month, date, hours, minutes, seconds, year] = match;
  const instant = new Date(Date.UTC(Number(year), months.indexOf(month!), Number(date), Number(hours), Number(minutes), Number(seconds)));
  return instant.getUTCFullYear() === Number(year) && instant.getUTCMonth() === months.indexOf(month!) &&
    instant.getUTCDate() === Number(date) && instant.getUTCHours() === Number(hours) && instant.getUTCMinutes() === Number(minutes) &&
    instant.getUTCSeconds() === Number(seconds) && weekdays[instant.getUTCDay()] === day;
}
export const isStableDarwinBootIdentity = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('darwin:') && uuid.test(value.slice(7));
export function isLegacyDarwinBootIdentity(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^\{ *sec *= *(\d+), *usec *= *(\d+) *\} (.+)$/.exec(value);
  return !!match && Number.isSafeInteger(Number(match[1])) && Number(match[1]) > 0 &&
    Number.isSafeInteger(Number(match[2])) && Number(match[2]) < 1_000_000 && isNativeBirthDate(match[3]!);
}
export const isStableHostBootIdentity = (value: unknown): value is string =>
  typeof value === 'string' && (isStableDarwinBootIdentity(value) || uuid.test(value));

/** kern.boottime can change after clock adjustments; it is never a boot fence. */
export function readHostBootIdentity(): string {
  if (process.platform === 'linux') {
    const value = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim().toLowerCase();
    if (!uuid.test(value)) throw new Error('Cannot verify the Linux boot identity');
    return value;
  }
  if (process.platform === 'darwin') {
    const value = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
      encoding: 'utf8', timeout: 1000, maxBuffer: 1024,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' },
    }).trim().toLowerCase();
    if (!uuid.test(value)) throw new Error('Cannot verify the macOS boot session');
    return 'darwin:' + value;
  }
  throw new Error('Cannot verify this host boot identity');
}

/** Only comparable stable IDs can prove a reboot; legacy wall-clock text cannot. */
export function provesDifferentHostBoot(previous: string, current: string): boolean {
  return isStableHostBootIdentity(previous) && isStableHostBootIdentity(current) &&
    isStableDarwinBootIdentity(previous) === isStableDarwinBootIdentity(current) && previous.toLowerCase() !== current.toLowerCase();
}

/** Legacy Darwin writer identity differences are uncertainty, not PID reuse. */
export function compareProcessLifetimes(previous: string, current: string): 'same' | 'different' | 'unknown' {
  const format = (value: string): 'linux' | 'darwin' | null => {
    if (value.startsWith('darwin:')) return isStableDarwinBootIdentity(value.slice(0, 43)) && value[43] === ':' && isNativeBirthDate(value.slice(44)) ? 'darwin' : null;
    const split = value.indexOf(':');
    const ticks = value.slice(split + 1);
    return uuid.test(value.slice(0, split)) && /^\d{1,20}$/.test(ticks) && BigInt(ticks) <= 18446744073709551615n ? 'linux' : null;
  };
  const before = format(previous), after = format(current);
  if (!before || !after || before !== after) return 'unknown';
  const normalize = (value: string) => before === 'darwin'
    ? value.slice(0, 43).toLowerCase() + ':' + value.slice(44).replace(/ +/g, ' ')
    : value.slice(0, 36).toLowerCase() + ':' + BigInt(value.slice(37)).toString();
  return normalize(previous) === normalize(current) ? 'same' : 'different';
}
