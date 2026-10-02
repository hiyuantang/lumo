// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { CalendarCollection, CalendarItem, CalendarRepeat } from '../api/calendar';
import { Checkbox } from '../shell/Checkbox';
import { Select } from '../shell/Select';
import { AppConfirmation, errorText } from './ServerAppUI';
import { dateKey, addDays, zonedParts, zonedISO, localDate } from './calendar-model';
export function newCalendarItem(kind: CalendarItem['kind'], date: Date, collectionId: string): CalendarItem {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const day = dateKey(date);
  return { id: '', revision: '', collectionId, kind, title: '', notes: '', location: '', start: zonedISO(day, '09:00', zone), end: zonedISO(day, '10:00', zone), due: '', allDay: false, timeZone: zone, repeat: 'none', repeatUntil: '', alertMinutes: 10, flagged: false, priority: 'none', completed: false, deleted: false };
}
export function CalendarEditor({ initial, collections, onSave, onCancel, onDirty, onBusy }: { initial: CalendarItem; collections: CalendarCollection[]; onSave: (item: CalendarItem) => Promise<void>; onCancel: () => void; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void }) {
  const [item, setItem] = useState(initial);
  const fallback = `${dateKey(new Date())}T09:00:00`;
  const parts = zonedParts(initial.start || new Date(fallback).toISOString(), initial.timeZone), end = zonedParts(initial.end || new Date(fallback).toISOString(), initial.timeZone);
  const due = initial.due ? zonedParts(initial.due, initial.timeZone) : { date: '', time: '09:00' };
  const [startDay, setStartDay] = useState(parts.date), [startTime, setStartTime] = useState(parts.time);
  const [endDay, setEndDay] = useState(initial.allDay ? dateKey(addDays(localDate(end.date), -1)) : end.date), [endTime, setEndTime] = useState(end.time);
  const [dueDay, setDueDay] = useState(due.date), [dueTime, setDueTime] = useState(due.time), [timed, setTimed] = useState(Boolean(initial.due && initial.due.length > 10));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [baseline] = useState(() => JSON.stringify([initial, parts.date, parts.time, initial.allDay ? dateKey(addDays(localDate(end.date), -1)) : end.date, end.time, due.date, due.time, Boolean(initial.due && initial.due.length > 10)]));
  useEffect(() => { onDirty(JSON.stringify([item, startDay, startTime, endDay, endTime, dueDay, dueTime, timed]) !== baseline); }, [item, startDay, startTime, endDay, endTime, dueDay, dueTime, timed, baseline, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const change = <K extends keyof CalendarItem>(key: K, value: CalendarItem[K]) => setItem((old) => ({ ...old, [key]: value }));
  const event = item.kind === 'event';
  const google = item.collectionId.startsWith('g:');
  async function save() {
    setError('');
    try {
      const next = { ...item, title: item.title.trim() };
      if (event) {
        next.start = item.allDay ? startDay : zonedISO(startDay, startTime, item.timeZone);
        next.end = item.allDay ? dateKey(addDays(localDate(endDay), 1)) : zonedISO(endDay, endTime, item.timeZone);
        if (!next.start || !next.end || localDate(next.end) <= localDate(next.start)) throw new Error('End must be after start.');
      } else {
        next.due = dueDay ? timed ? zonedISO(dueDay, dueTime, item.timeZone) : dueDay : '';
        if (next.repeat !== 'none' && !next.due) throw new Error('Repeating reminders need a due date.');
      }
      setBusy(true); await onSave(next);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <AppConfirmation title={`${initial.id ? 'Edit' : 'New'} ${event ? 'event' : 'reminder'}`} confirm="Save" onConfirm={() => void save()} onCancel={onCancel} busy={busy} confirmDisabled={!item.title.trim()}>
    <div className="calendar-editor app-modal-scroll" data-testid="calendar-editor">
      <label>Title<input className="input" aria-label="Title" maxLength={500} value={item.title} onChange={(e) => change('title', e.target.value)}/></label>
      <label>{event ? 'Calendar' : 'List'}<Select aria-label={event ? 'Calendar' : 'List'} value={item.collectionId} onChange={(id) => change('collectionId', id)} options={collections.filter((c) => c.kind === item.kind && !c.readOnly && (!initial.id || c.provider === (initial.collectionId.startsWith('g:') ? 'google' : 'local')) && (!google || !initial.id || c.id === initial.collectionId)).map((c) => ({ value: c.id, label: `${c.name}${c.provider === 'google' ? ' · Google' : ''}` }))}/></label>
      {event ? <>
        <div className="calendar-form-check"><span>All day</span><Checkbox aria-label="All day" checked={item.allDay} onChange={(value) => change('allDay', value)}/></div>
        <div className="calendar-date-row"><label>Start date<input aria-label="Start date" className="input" type="date" value={startDay} onChange={(e) => { setStartDay(e.target.value); if (endDay < e.target.value) setEndDay(e.target.value); }}/></label>{!item.allDay && <label>Start time<input className="input" aria-label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}/></label>}</div>
        <div className="calendar-date-row"><label>End date<input className="input" aria-label="End date" type="date" value={endDay} onChange={(e) => setEndDay(e.target.value)}/></label>{!item.allDay && <label>End time<input className="input" aria-label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}/></label>}</div>
      </> : <>
        <label>Due date<input className="input" aria-label="Due date" type="date" value={dueDay} onChange={(e) => setDueDay(e.target.value)}/></label>
        <div className="calendar-form-check"><span>At a specific time</span><Checkbox aria-label="At a specific time" checked={timed} disabled={!dueDay} onChange={setTimed}/></div>
        {timed && dueDay && <label>Due time<input className="input" aria-label="Due time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)}/></label>}
        <div className="calendar-form-check"><span>Flagged</span><Checkbox aria-label="Flagged" checked={item.flagged} onChange={(v) => change('flagged', v)}/></div>
        <label>Priority<Select aria-label="Priority" value={item.priority} onChange={(v) => change('priority', v as CalendarItem['priority'])} options={['none', 'low', 'medium', 'high'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}/></label>
      </>}
      {(event && !item.allDay || timed || item.repeat !== 'none') && <label>Time zone<input aria-label="Time zone" className="input" value={item.timeZone} onChange={(e) => change('timeZone', e.target.value)} placeholder="America/New_York"/></label>}
      {!(google && initial.id) && <label>Repeat<Select aria-label="Repeat" disabled={google && Boolean(initial.id)} value={item.repeat} onChange={(v) => change('repeat', v as CalendarRepeat)} options={['none', 'daily', 'weekly', 'monthly', 'yearly'].map((v) => ({ value: v, label: v === 'none' ? 'Never' : v[0].toUpperCase() + v.slice(1) }))}/></label>}
      {google && initial.id && <p className="calendar-hint">Changes apply to this occurrence.</p>}
      {item.repeat !== 'none' && <label>Repeat until<input aria-label="Repeat until" className="input" type="date" value={item.repeatUntil} onChange={(e) => change('repeatUntil', e.target.value)}/></label>}
      {event && <><label>Alert<Select aria-label="Alert" value={item.alertMinutes === null ? 'none' : String(item.alertMinutes)} onChange={(v) => change('alertMinutes', v === 'none' ? null : Number(v))} options={[{ value: 'none', label: 'None' }, ...[0, 5, 10, 15, 30, 60, 1440].map((n) => ({ value: String(n), label: n === 0 ? 'At start' : n === 1440 ? '1 day before' : `${n} minutes before` }))]}/></label><label>Location<input aria-label="Location" className="input" maxLength={2000} value={item.location} onChange={(e) => change('location', e.target.value)}/></label></>}
      <label>Notes<textarea aria-label="Notes" className="input" maxLength={16000} rows={3} value={item.notes} onChange={(e) => change('notes', e.target.value)}/></label>
      {error && <p role="alert" className="calendar-error">{error}</p>}
    </div>
  </AppConfirmation>;
}
