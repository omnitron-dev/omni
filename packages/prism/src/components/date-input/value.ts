import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);
export type CalendarValueKind = 'date' | 'time' | 'datetime';
export type CalendarPrecision = 'minute' | 'second';
export function calendarFormat(kind: CalendarValueKind, precision: CalendarPrecision = 'minute') {
  const time = precision === 'second' ? 'HH:mm:ss' : 'HH:mm';
  return kind === 'date' ? 'YYYY-MM-DD' : kind === 'time' ? time : `YYYY-MM-DD[T]${time}`;
}
/** A calendar/wall-clock value has no time zone. UTC is only the picker's carrier;
 * it must never be serialized as an instant or converted to the device zone. */
export function parseCalendarValue(value: string, kind: CalendarValueKind): Dayjs | null {
  if (value === '') return null;
  const source = kind === 'time' ? `2000-01-01T${value}` : value;
  const pattern =
    kind === 'date' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
  const match = pattern.exec(source);
  if (!match) return dayjs.utc(NaN);
  const [, y, m, d, h = '0', minute = '0', sec = '0'] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(y), Number(m) - 1, Number(d));
  date.setUTCHours(Number(h), Number(minute), Number(sec), 0);
  const second = /:\d{2}:\d{2}$/.test(value);
  const format = calendarFormat(kind, second ? 'second' : 'minute');
  const parsed = dayjs.utc(date);
  return parsed.isValid() && parsed.format(format) === value ? parsed : dayjs.utc(NaN);
}
export function formatCalendarValue(
  value: Dayjs | null,
  kind: CalendarValueKind,
  precision: CalendarPrecision
): string {
  return value?.isValid() ? value.format(calendarFormat(kind, precision)) : '';
}
