// SPDX-License-Identifier: AGPL-3.0-only
import type { CalendarItem, CalendarOccurrence, CalendarRepeat } from '@lumo/sdk/api/calendar';
export type CalendarView = 'day' | 'week' | 'month' | 'year';
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const localDate = (value: string) => value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
export const addDays = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
export const startWeek = (date: Date) => addDays(date, -date.getDay());
export const monthDays = (date: Date) => Array.from({ length: 42 }, (_, i) => addDays(startWeek(new Date(date.getFullYear(), date.getMonth(), 1)), i));
export const monthLabel = (date: Date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
export const timeLabel = (value: string) => value.length === 10 ? 'All day' : new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const zonedParts = (value: string, timeZone: string) => {
  if (value.length === 10) return { date: value, time: '09:00' };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = (name: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === name)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
};
export function zonedISO(date: string, clock: string, zone: string) {
  const target = Date.parse(`${date}T${clock}:00Z`);
  let guess = target;
  for (let n = 0; n < 4; n++) {
    const p = zonedParts(new Date(guess).toISOString(), zone);
    const offset = Date.parse(`${p.date}T${p.time}:00Z`) - guess;
    guess = target - offset;
  }
  const actual = zonedParts(new Date(guess).toISOString(), zone);
  if (actual.date !== date || actual.time !== clock) throw new Error('This time does not exist in the chosen time zone. Choose another time.');
  return new Date(guess).toISOString();
}
export function viewRange(date: Date, view: CalendarView) {
  if (view === 'year') return [new Date(date.getFullYear(), 0, 1), new Date(date.getFullYear() + 1, 0, 1)];
  if (view === 'month') { const days = monthDays(date); return [days[0], addDays(days[41], 1)]; }
  const from = view === 'week' ? startWeek(date) : addDays(date, 0);
  return [from, addDays(from, view === 'week' ? 7 : 1)];
}
export function shiftDate(date: Date, view: CalendarView, direction: number) {
  if (view === 'year') return new Date(date.getFullYear() + direction, date.getMonth(), 1);
  if (view === 'month') return new Date(date.getFullYear(), date.getMonth() + direction, 1);
  return addDays(date, direction * (view === 'week' ? 7 : 1));
}
export function onDate(item: CalendarItem, date: Date) {
  if (item.kind === 'reminder') return item.due && dateKey(localDate(item.due)) === dateKey(date);
  return localDate(item.start) < addDays(date, 1) && localDate(item.end) > date;
}
export function repeatDate(base: Date, repeat: CalendarRepeat, index: number): Date {
  if (repeat === 'daily' || repeat === 'weekly') return new Date(base.getFullYear(), base.getMonth(), base.getDate() + index * (repeat === 'weekly' ? 7 : 1), base.getHours(), base.getMinutes());
  const y = base.getFullYear() + (repeat === 'yearly' ? index : 0), m = base.getMonth() + (repeat === 'monthly' ? index : 0);
  const next = new Date(y, m, base.getDate(), base.getHours(), base.getMinutes());
  return next;
}
export function expandMock(items: CalendarItem[], from: Date, to: Date): CalendarOccurrence[] {
  const out: CalendarOccurrence[] = [];
  for (const item of items) {
    if (item.deleted || item.completed || item.kind === 'reminder') continue;
    const original = zonedParts(item.start, item.timeZone), end = zonedParts(item.end, item.timeZone);
    const wall = new Date(`${original.date}T${original.time}`);
    for (let n = 0; n < 50000; n++) {
      const next = repeatDate(wall, item.repeat, n);
      if ((item.repeat === 'monthly' || item.repeat === 'yearly') && next.getDate() !== wall.getDate()) continue;
      const day = dateKey(next);
      if (item.repeatUntil && day > item.repeatUntil) break;
      const dateShift = (Date.parse(`${day}T12:00Z`) - Date.parse(`${original.date}T12:00Z`)) / 86400000;
      const endDay = dateKey(addDays(localDate(end.date), dateShift));
      let start: string, stop: string;
      try { start = item.allDay ? day : zonedISO(day, original.time, item.timeZone); stop = item.allDay ? endDay : zonedISO(endDay, end.time, item.timeZone); } catch { if (item.repeat === 'none') break; continue; }
      if (localDate(start) >= to) break;
      if (localDate(stop) > from) out.push({ ...item, start, end: stop, occurrenceId: `${item.id}:${start}` });
      if (item.repeat === 'none') break;
    }
  }
  return out;
}
export function timedLayout(items: CalendarOccurrence[], date: Date) {
  const midnight = date.getTime(), tomorrow = addDays(date, 1).getTime();
  const minute = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  const events = items.filter((item) => !item.allDay && onDate(item, date)).map((item) => ({ item, top: localDate(item.start).getTime() <= midnight ? 0 : minute(localDate(item.start).getTime()), bottom: localDate(item.end).getTime() >= tomorrow ? 1440 : minute(localDate(item.end).getTime()), column: 0, columns: 1 })).sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let group: typeof events = [], end = -1;
  function finish() { const columns = Math.max(1, ...group.map((event) => event.column + 1)); for (const event of group) event.columns = columns; group = []; }
  for (const event of events) {
    if (event.top >= end) finish();
    const occupied = new Set(group.filter((other) => other.bottom > event.top).map((other) => other.column));
    while (occupied.has(event.column)) event.column++;
    group.push(event); end = Math.max(...group.map((other) => other.bottom));
  }
  finish(); return events;
}
