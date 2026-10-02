// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CalendarCollection, CalendarOccurrence } from '../api/calendar';
import { addDays, dateKey, monthDays, onDate, startWeek, timeLabel, timedLayout, type CalendarView } from './calendar-model';
import { useNow, useShell } from '../shell/ShellContext';
import { useCalendarGridSnap } from './useCalendarGridSnap';
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function MiniMonth({ date, selected, onDay, dots = [] }: { date: Date; selected?: string; onDay: (date: Date) => void; dots?: CalendarOccurrence[] }) {
  const today = dateKey(new Date());
  return <div className="calendar-mini-grid" role="group" aria-label={date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
    {weekdays.map((day) => <span className="calendar-weekday" key={day}>{day[0]}</span>)}
    {monthDays(date).map((day) => <button type="button" key={dateKey(day)} aria-label={day.toLocaleDateString(undefined, { dateStyle: 'full' })} aria-current={day.getMonth() === date.getMonth() && dateKey(day) === today ? 'date' : undefined} aria-pressed={selected ? selected === dateKey(day) : undefined} className={`${day.getMonth() !== date.getMonth() ? 'calendar-other ' : ''}${day.getMonth() === date.getMonth() && dateKey(day) === today ? 'calendar-today ' : ''}${selected === dateKey(day) ? 'calendar-picked ' : ''}${dots.some((item) => onDate(item, day)) ? 'calendar-has-events' : ''}`} onClick={() => onDay(day)}>{day.getDate()}</button>)}
  </div>;
}
interface Props { date: Date; view: CalendarView; events: CalendarOccurrence[]; collections: CalendarCollection[]; selected: string | null; onDay: (date: Date) => void; onSelect: (item: CalendarOccurrence) => void; onCreate: (date: Date) => void; onMonth?: (date: Date) => void; onTimeline?: (date: Date) => void; monthNavigation?: number; preview?: boolean; scrollPosition?: { top: number; left: number } }
export function CalendarViews(props: Props) {
  if (props.view === 'year') return <div className="calendar-year" data-testid={props.preview ? 'calendar-preview-year' : 'calendar-year'}>{Array.from({ length: 12 }, (_, month) => {
    const date = new Date(props.date.getFullYear(), month, 1);
    return <section className="calendar-year-month" key={month}><h3><button onClick={() => props.onDay(date)}>{date.toLocaleDateString(undefined, { month: 'long' })}</button></h3><MiniMonth date={date} onDay={props.onDay} dots={props.events}/></section>;
  })}</div>;
  if (props.view === 'month') return <Month {...props}/>;
  return <Timeline {...props}/>;
}
function EventLabel({ item, color, selected, onClick, preview }: { item: CalendarOccurrence; color: string; selected: boolean; onClick: () => void; preview?: boolean }) {
  return <button className={`calendar-event-label${selected ? ' selected' : ''}`} style={{ '--event-color': color } as CSSProperties} data-testid={preview ? 'calendar-preview-event' : 'calendar-event'} title={`${item.title} · ${timeLabel(item.start)}`} onClick={onClick}><span>{item.title}</span>{!item.allDay && <time>{timeLabel(item.start)}</time>}</button>;
}
function Month({ date, events, collections, selected, onDay, onSelect, onCreate, onMonth, monthNavigation }: Props) {
  const { reducedMotion } = useShell();
  const today = dateKey(new Date());
  const scroller = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() => ({ start: addDays(monthDays(date)[0], -26 * 7), top: 26 * 112, height: 112 }));
  const current = useRef(position); current.current = position;
  const reportedMonth = useRef(`${date.getFullYear()}:${date.getMonth()}`);
  const navigation = useRef(monthNavigation);
  const pendingTop = useRef<number | null>(position.top);
  const changeMonth = useRef(onMonth); changeMonth.current = onMonth;
  const stopSnap = useCalendarGridSnap(scroller, () => ({ left: 0, top: Math.round((scroller.current?.scrollTop ?? 0) / current.current.height) * current.current.height }), reducedMotion);
  useLayoutEffect(() => {
    const month = `${date.getFullYear()}:${date.getMonth()}`;
    if (reportedMonth.current === month && navigation.current === monthNavigation) return;
    stopSnap.current();
    reportedMonth.current = month; navigation.current = monthNavigation;
    const next = { ...current.current, start: addDays(monthDays(date)[0], -26 * 7), top: 26 * current.current.height };
    pendingTop.current = next.top; current.current = next; setPosition(next);
  }, [date, monthNavigation]);
  useLayoutEffect(() => {
    if (scroller.current && pendingTop.current !== null) { scroller.current.scrollTop = pendingTop.current; pendingTop.current = null; }
  }, [position]);
  useLayoutEffect(() => {
    const node = scroller.current; if (!node) return;
    const observer = new ResizeObserver(() => {
      if (!node.clientHeight) return;
      const old = current.current, height = node.clientHeight / Math.max(1, Math.min(5, Math.floor(node.clientHeight / 82)));
      if (height === old.height) return;
      stopSnap.current();
      const next = { ...old, height, top: Math.round(node.scrollTop / old.height) * height };
      pendingTop.current = next.top; current.current = next; setPosition(next);
    });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  function scroll() {
    const node = scroller.current; if (!node || pendingTop.current !== null) return;
    const old = current.current, index = Math.floor((node.scrollTop + .5) / old.height);
    const areas = new Map<string, { date: Date; area: number }>();
    for (let row = index; row * old.height < node.scrollTop + node.clientHeight; row++) {
      const visible = Math.max(0, Math.min((row + 1) * old.height, node.scrollTop + node.clientHeight) - Math.max(row * old.height, node.scrollTop));
      for (let day = 0; day < 7; day++) {
        const value = addDays(old.start, row * 7 + day), key = `${value.getFullYear()}:${value.getMonth()}`;
        const entry = areas.get(key);
        if (entry) entry.area += visible;
        else areas.set(key, { date: value, area: visible });
      }
    }
    let month = reportedMonth.current, largest = areas.get(month)?.area ?? 0;
    for (const [key, value] of areas) if (value.area > largest + .5) { month = key; largest = value.area; }
    const shift = index < 8 ? -26 : index > 52 ? 26 : 0;
    const next = { ...old, start: shift ? addDays(old.start, shift * 7) : old.start, top: node.scrollTop - shift * old.height };
    if (shift) pendingTop.current = next.top;
    current.current = next; setPosition(next);
    if (reportedMonth.current !== month) { reportedMonth.current = month; const value = areas.get(month)!.date; changeMonth.current?.(new Date(value.getFullYear(), value.getMonth(), 1)); }
  }
  const first = Math.max(0, Math.floor(position.top / position.height) - 1);
  const count = Math.min(65 - first, Math.ceil((scroller.current?.clientHeight ?? 560) / position.height) + 3);
  const days = Array.from({ length: count * 7 }, (_, index) => addDays(position.start, first * 7 + index));
  return <div className="calendar-month-view">
    <div className="calendar-month-weekdays" data-testid="calendar-month-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-month" data-testid="calendar-month" ref={scroller} onScroll={scroll}>
    <div className="calendar-month-grid" style={{ gridTemplateRows: `repeat(${count}, ${position.height}px)`, paddingTop: first * position.height, paddingBottom: (65 - first - count) * position.height }}>{days.map((day) => {
      const dayEvents = events.filter((item) => onDate(item, day)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
      return <div className={`calendar-month-cell${day.getMonth() !== date.getMonth() ? ' calendar-other' : ''}`} key={dateKey(day)} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('.calendar-event-label')) onCreate(day); }}>
        <button className={`calendar-date-number${dateKey(day) === today ? ' calendar-today' : ''}`} aria-label={`Open ${day.toLocaleDateString(undefined, { dateStyle: 'full' })}`} aria-current={dateKey(day) === today ? 'date' : undefined} onClick={() => onDay(day)}>{day.getDate() === 1 && dateKey(day) !== today ? `${day.toLocaleDateString(undefined, { month: 'short' })} ` : ''}{day.getDate()}</button>
        <div className="calendar-day-events">{dayEvents.slice(0, 3).map((item) => <EventLabel key={item.occurrenceId} item={item} selected={selected === item.occurrenceId} color={collections.find((c) => c.id === item.collectionId)?.color ?? '#487ccc'} onClick={() => onSelect(item)}/>)}{dayEvents.length > 3 && <button className="calendar-more" onClick={() => onDay(day)}>+{dayEvents.length - 3} more</button>}</div>
      </div>;
    })}</div></div>
  </div>;
}
function Timeline({ date, view, events, collections, selected, onDay, onSelect, onCreate, onTimeline, monthNavigation }: Props) {
  const scroller = useRef<HTMLDivElement>(null), allDay = useRef<HTMLDivElement>(null);
  const { reducedMotion } = useShell();
  useNow(60_000);
  const [position, setPosition] = useState(() => ({ start: addDays(view === 'week' ? startWeek(date) : date, -26), left: 26 * 112, top: 7 * 60, width: 112, height: 60, columns: view === 'week' ? 7 : 1 }));
  const current = useRef(position); current.current = position;
  const reported = useRef(dateKey(date)), navigation = useRef({ view, value: monthNavigation });
  const resizePosition = useRef<{ column: number; hour: number } | null>(null);
  const pending = useRef<{ left: number; top: number } | null>({ left: position.left, top: position.top });
  const changeDate = useRef(onTimeline); changeDate.current = onTimeline;
  const stopSnap = useCalendarGridSnap(scroller, () => ({ left: Math.round((scroller.current?.scrollLeft ?? 0) / current.current.width) * current.current.width, top: Math.round((scroller.current?.scrollTop ?? 0) / current.current.height) * current.current.height }), reducedMotion);
  useLayoutEffect(() => {
    if (navigation.current.view === view && navigation.current.value === monthNavigation) return;
    stopSnap.current(); reported.current = dateKey(date);
    const changedView = navigation.current.view !== view; navigation.current = { view, value: monthNavigation };
    const old = current.current, next = { ...old, start: addDays(view === 'week' ? startWeek(date) : date, -26), left: 26 * old.width, top: changedView ? 7 * old.height : old.top };
    if (resizePosition.current) resizePosition.current = { column: 26, hour: changedView ? 7 : resizePosition.current.hour };
    pending.current = { left: next.left, top: next.top }; current.current = next; setPosition(next);
  }, [date, view, monthNavigation]);
  useLayoutEffect(() => {
    if (scroller.current && pending.current) { scroller.current.scrollTo(pending.current); pending.current = null; }
  }, [position]);
  useLayoutEffect(() => {
    const node = scroller.current, header = allDay.current; if (!node || !header) return;
    let timer = 0;
    const release = () => { window.clearTimeout(timer); resizePosition.current = null; };
    const measure = () => {
      const available = node.clientHeight - 38 - header.getBoundingClientRect().height;
      if (available <= 0 || node.clientWidth <= 52) return;
      const old = current.current, columns = view === 'day' ? 1 : Math.max(1, Math.min(7, Math.floor((node.clientWidth - 52) / 112)));
      const width = (node.clientWidth - 52) / columns, height = available / Math.max(1, Math.min(24, Math.floor(available / 60)));
      if (Math.abs(width - old.width) < .01 && Math.abs(height - old.height) < .01 && columns === old.columns) return;
      stopSnap.current();
      const fixed = resizePosition.current ?? { column: Math.round(old.left / old.width), hour: Math.round(old.top / old.height) };
      resizePosition.current = fixed;
      window.clearTimeout(timer); timer = window.setTimeout(() => { release(); scroll(); }, 120);
      const next = { ...old, width, height, columns, left: fixed.column * width, top: fixed.hour * height };
      pending.current = { left: next.left, top: next.top }; current.current = next; setPosition(next);
    };
    const observer = new ResizeObserver(measure); observer.observe(node); observer.observe(header);
    node.addEventListener('wheel', release, { passive: true }); node.addEventListener('keydown', release); node.addEventListener('pointerdown', release);
    return () => { release(); observer.disconnect(); node.removeEventListener('wheel', release); node.removeEventListener('keydown', release); node.removeEventListener('pointerdown', release); };
  }, [view]);
  function scroll() {
    const node = scroller.current; if (!node || pending.current || resizePosition.current) return;
    const old = current.current, index = Math.round(node.scrollLeft / old.width);
    const anchor = addDays(old.start, index + (view === 'week' ? Math.floor(old.columns / 2) : 0));
    const shift = index < 8 ? -26 : index > 52 ? 26 : 0;
    const next = { ...old, start: shift ? addDays(old.start, shift) : old.start, left: node.scrollLeft - shift * old.width, top: node.scrollTop };
    if (shift) { stopSnap.current(); pending.current = { left: next.left, top: next.top }; }
    current.current = next; setPosition(next);
    if (index !== Math.round(old.left / old.width) && reported.current !== dateKey(anchor)) { reported.current = dateKey(anchor); changeDate.current?.(anchor); }
  }
  const first = Math.max(0, Math.floor(position.left / position.width) - 1), count = Math.min(65 - first, position.columns + 3);
  const days = Array.from({ length: count }, (_, i) => addDays(position.start, first + i));
  const template = `52px ${first * position.width}px repeat(${count}, ${position.width}px) ${(65 - first - count) * position.width}px`;
  const now = new Date();
  const color = (item: CalendarOccurrence) => collections.find((c) => c.id === item.collectionId)?.color ?? '#487ccc';
  const spacer = <div className="calendar-timeline-spacer" aria-hidden="true"/>;
  return <div className="calendar-timeline-scroll" ref={scroller} onScroll={scroll} data-testid="calendar-timeline"><div className="calendar-timeline" style={{ width: 52 + 65 * position.width, '--hour-height': `${position.height}px`, '--timeline-columns': template } as CSSProperties}>
    <div className="calendar-time-head"><span className="calendar-timezone" title={Intl.DateTimeFormat().resolvedOptions().timeZone}>{now.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').at(-1)}</span>{spacer}{days.map((day) => <button key={dateKey(day)} data-date={dateKey(day)} onClick={() => onDay(day)}>{day.toLocaleDateString(undefined, { weekday: 'short' })} <span className={dateKey(day) === dateKey(now) ? 'calendar-today' : ''}>{day.getDate()}</span></button>)}{spacer}</div>
    <div className="calendar-all-day" ref={allDay}><span>All day</span>{spacer}{days.map((day) => <div key={dateKey(day)}>{events.filter((item) => item.allDay && onDate(item, day)).map((item) => <EventLabel item={item} key={item.occurrenceId} color={color(item)} selected={selected === item.occurrenceId} onClick={() => onSelect(item)}/>)}</div>)}{spacer}</div>
    <div className="calendar-hours"><div className="calendar-hour-labels">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour === 0 ? '12 AM' : hour === 12 ? 'Noon' : `${hour % 12} ${hour < 12 ? 'AM' : 'PM'}`}</span>)}</div>{spacer}
      {days.map((day) => <div className="calendar-time-column" data-date={dateKey(day)} key={dateKey(day)}>{Array.from({ length: 24 }, (_, hour) => <button className="calendar-hour-slot" key={hour} aria-label={`New event ${dateKey(day)} ${hour}:00`} onDoubleClick={() => onCreate(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCreate(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour)); } }}/>) }
        {timedLayout(events, day).map(({ item, top, bottom, column, columns }) => <button key={item.occurrenceId} data-testid="calendar-timed-event" className={`calendar-timed-event${selected === item.occurrenceId ? ' selected' : ''}`} style={{ top: top / 60 * position.height, height: Math.max(24, (bottom - top) / 60 * position.height), left: `calc(${column / columns * 100}% + 3px)`, width: `calc(${100 / columns}% - 6px)`, '--event-color': color(item) } as CSSProperties} title={`${item.title} · ${timeLabel(item.start)} – ${timeLabel(item.end)}`} onClick={() => onSelect(item)}><strong>{item.title}</strong><span>{timeLabel(item.start)} – {timeLabel(item.end)}</span>{(bottom - top) / 60 * position.height >= 55 && item.location && <span>{item.location}</span>}</button>)}
        {dateKey(day) === dateKey(now) && <div className="calendar-now" style={{ top: (now.getHours() + now.getMinutes() / 60) * position.height }} aria-label="Current time"/>}
      </div>)}{spacer}
    </div>
  </div></div>;
}
