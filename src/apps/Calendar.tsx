// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { getDataSource } from '../api/source';
import type { CalendarChange, CalendarItem, CalendarOccurrence, CalendarSnapshot } from '../api/calendar';
import { useShell } from '../shell/ShellContext';
import { useCurrentWindow } from '../shell/WindowContext';
import { useAppState } from '../shell/useAppState';
import { useAppMenus } from '../shell/appMenus';
import { Checkbox } from '../shell/Checkbox';
import { IconBell, IconCalendar, IconChevronLeft, IconChevronRight, IconPlus, IconRefresh, IconSearch, IconSidebar, IconUser, IconX } from '../shell/icons';
import { AppConfirmation, errorText } from './ServerAppUI';
import { CalendarEditor, newCalendarItem } from './CalendarEditor';
import { CalendarViews, MiniMonth } from './CalendarViews';
import { CalendarGoogle } from './CalendarGoogle';
import { useCalendarSwipe } from './useCalendarSwipe';
import { addDays, dateKey, expandMock, localDate, monthLabel, shiftDate, timeLabel, viewRange, type CalendarView } from './calendar-model';
import '../styles/calendar.css';
type Tab = 'calendar' | 'reminders' | 'accounts';
const views: CalendarView[] = ['day', 'week', 'month', 'year'];
const smart = ['Today', 'Scheduled', 'All', 'Flagged', 'Urgent', 'Completed'] as const;
const collectionColors = [{ name: 'Blue', value: '#487ccc' }, { name: 'Purple', value: '#8861bb' }, { name: 'Pink', value: '#c55b91' }, { name: 'Red', value: '#d3323b' }, { name: 'Orange', value: '#c28245' }, { name: 'Yellow', value: '#ad902c' }, { name: 'Green', value: '#428763' }, { name: 'Teal', value: '#368b94' }];
function moveTab<T extends string>(event: KeyboardEvent<HTMLElement>, choices: readonly T[], selected: T, change: (value: T) => void) {
  let index = choices.indexOf(selected);
  if (['ArrowRight', 'ArrowDown'].includes(event.key)) index = (index + 1) % choices.length;
  else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) index = (index + choices.length - 1) % choices.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = choices.length - 1;
  else return;
  event.preventDefault(); change(choices[index]); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
}
const matchesFilter = (item: CalendarItem, filter: string) => {
  if (item.kind !== 'reminder' || item.deleted) return false;
  if (filter === 'Completed') return item.completed;
  if (item.completed) return false;
  if (filter === 'Today') return Boolean(item.due && localDate(item.due).getTime() < addDays(new Date(), 1).setHours(0, 0, 0, 0));
  if (filter === 'Scheduled') return Boolean(item.due);
  if (filter === 'Flagged') return item.flagged;
  if (filter === 'Urgent') return item.priority === 'high';
  return filter === 'All' || item.collectionId === filter;
};
export function Calendar() {
  const source = getDataSource(); const { actions, reducedMotion } = useShell(); const win = useCurrentWindow();
  const [tab, setTab] = useAppState<Tab>('calendar', 'tab', 'calendar', ['calendar', 'reminders', 'accounts']);
  const [view, setView] = useAppState<CalendarView>('calendar', 'view', 'month', views);
  const [anchor, setAnchor] = useAppState('calendar', 'date', dateKey(new Date()));
  const [hidden, setHidden] = useAppState<string[]>('calendar', 'hidden', []);
  const [filter, setFilter] = useAppState<string>('calendar', 'filter', 'Today');
  const [sidebar, setSidebar] = useAppState<boolean>('calendar', 'sidebar', () => win.w > 620);
  const date = useMemo(() => { const d = localDate(anchor); return Number.isNaN(d.getTime()) ? new Date() : d; }, [anchor]);
  const [miniDate, setMiniDate] = useState(date);
  useEffect(() => setMiniDate(date), [date]);
  const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CalendarOccurrence | CalendarItem | null>(null);
  const [editing, setEditing] = useState<CalendarItem | null>(null), [dirty, setDirty] = useState(false), [editorBusy, setEditorBusy] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null), [deleting, setDeleting] = useState<CalendarItem | null>(null), [undo, setUndo] = useState<CalendarItem | null>(null);
  const [newCollection, setNewCollection] = useState(false), [name, setName] = useState(''), [color, setColor] = useState('#487ccc');
  const [monthNavigation, setMonthNavigation] = useState(0);
  const scrollMonth = useCallback((value: Date) => setAnchor(dateKey(value)), [setAnchor]);
  const today = () => { const value = new Date(); setMiniDate(value); setMonthNavigation((version) => version + 1); setAnchor(dateKey(value)); };
  const navigate = useCallback((direction: number) => { setMonthNavigation((value) => value + 1); setSelected(null); setAnchor((old) => { const current = localDate(old); return dateKey(shiftDate(Number.isNaN(current.getTime()) ? new Date() : current, view, direction)); }); }, [setAnchor, view]);
  const swipe = useCalendarSwipe(tab === 'calendar' && view === 'year' && Boolean(snapshot) && !editing && !deleting && !newCollection && !discard && !busy, `${tab}:${view}:${anchor}`, view === 'month', reducedMotion, navigate);
  const [from, to] = useMemo(() => { const range = viewRange(date, tab === 'calendar' ? view : 'day'); return range.map((d, index) => (tab === 'calendar' && view !== 'year' ? addDays(d, index === 0 ? -14 : 14) : d).toISOString()); }, [date, tab, view]);
  const [neighbor, setNeighbor] = useState<{ key: string; snapshot: CalendarSnapshot } | null>(null);
  const prepared = useRef<{ key: string; snapshot: CalendarSnapshot } | null>(null);
  const currentKey = `${from}:${to}:${revision}`;
  const displayed = tab === 'calendar' && prepared.current?.key === currentKey ? prepared.current.snapshot : snapshot;
  const neighborDate = useMemo(() => shiftDate(date, view, swipe.preview), [date, view, swipe.preview]);
  const [neighborFrom, neighborTo] = useMemo(() => viewRange(neighborDate, view).map((d) => d.toISOString()), [neighborDate, view]);
  const neighborKey = `${neighborFrom}:${neighborTo}:${revision}`;
  const previewScroll = useMemo(() => { const scroller = swipe.pane.current?.querySelector<HTMLElement>('.calendar-page-current > *'); return { top: scroller?.scrollTop ?? 0, left: scroller?.scrollLeft ?? 0 }; }, [swipe.preview, view, swipe.pane]);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    if (tab === 'calendar' && prepared.current?.key === currentKey) { setSnapshot(prepared.current.snapshot); prepared.current = null; setLoading(false); return; }
    void source.calendarSnapshot(from, to, tab === 'calendar').then((value) => { if (alive) { setSnapshot(value); setSelected((old) => old ? value.occurrences.find((item) => 'occurrenceId' in old && item.occurrenceId === old.occurrenceId) ?? value.items.find((item) => item.id === old.id) ?? null : null); } }).catch((err) => { if (alive) setError(errorText(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, from, to, tab, revision, currentKey]);
  useEffect(() => {
    if (!swipe.preview || tab !== 'calendar') return;
    let alive = true;
    void source.calendarSnapshot(neighborFrom, neighborTo, true).then((value) => { if (alive) { prepared.current = { key: neighborKey, snapshot: value }; setNeighbor(prepared.current); } }).catch(() => {});
    return () => { alive = false; };
  }, [source, neighborFrom, neighborTo, neighborKey, swipe.preview, tab]);
  useLayoutEffect(() => { const scroller = swipe.pane.current?.querySelector<HTMLElement>('.calendar-page-neighbor > *'); if (scroller) { scroller.scrollTop = previewScroll.top; scroller.scrollLeft = previewScroll.left; } }, [previewScroll, swipe.pane]);
  useEffect(() => {
    const resume = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(resume, 60_000);
    window.addEventListener('focus', resume); window.addEventListener('lumo-calendar-changed', resume);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', resume); window.removeEventListener('lumo-calendar-changed', resume); };
  }, [refresh]);
  useEffect(() => { if (new URLSearchParams(window.location.search).has('calendar')) setTab('accounts'); }, [setTab]);
  useLayoutEffect(() => actions.registerWindowGuard(win.id, (proceed) => { if (busy || editorBusy) return; if (dirty) setDiscard(() => proceed); else proceed(); }), [actions, win.id, dirty, busy, editorBusy]);
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const collections = displayed?.collections ?? [];
  const visibleEvents = useCallback((items: CalendarOccurrence[]) => items.filter((item) => item.kind === 'event' && !hidden.includes(item.collectionId) && `${item.title} ${item.notes} ${item.location}`.toLowerCase().includes(query.toLowerCase())), [hidden, query]);
  const events = useMemo(() => visibleEvents(displayed?.occurrences ?? []), [displayed, visibleEvents]);
  const neighborEvents = useMemo(() => {
    if (!swipe.preview) return [];
    if (neighbor?.key === neighborKey) return visibleEvents(neighbor.snapshot.occurrences);
    const known = new Map((snapshot?.occurrences ?? []).map((item) => [item.occurrenceId, item]));
    for (const item of expandMock((snapshot?.items ?? []).filter((item) => item.repeat === 'none' && collections.find((c) => c.id === item.collectionId)?.provider === 'local'), new Date(neighborFrom), new Date(neighborTo))) known.set(item.occurrenceId, item);
    return visibleEvents([...known.values()]);
  }, [swipe.preview, neighbor, neighborKey, visibleEvents, snapshot, collections, neighborFrom, neighborTo]);
  const reminders = snapshot?.items.filter((item) => item.kind === 'reminder') ?? [];
  const shownReminders = reminders.filter((item) => matchesFilter(item, filter) && `${item.title} ${item.notes}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title));
  function create(kind: CalendarItem['kind'], when = date) {
    const collection = collections.find((c) => c.kind === kind && c.provider === 'local' && !c.readOnly && (kind !== 'reminder' || c.id === filter)) ?? collections.find((c) => c.kind === kind && !c.readOnly);
    if (!collection) { setError('Create a calendar or list first.'); return; }
    const item = newCalendarItem(kind, when, collection.id);
    if (kind === 'reminder') {
      if (filter === 'Today' || filter === 'Scheduled') item.due = dateKey(new Date());
      if (filter === 'Flagged') item.flagged = true;
      if (filter === 'Urgent') item.priority = 'high';
      if (filter === 'Completed') setFilter('All');
    }
    if (kind === 'event' && when.getHours()) { item.start = when.toISOString(); item.end = new Date(when.getTime() + 3600000).toISOString(); }
    setEditing(item); setDirty(false);
  }
  function edit(item: CalendarItem) { setEditing(snapshot?.items.find((value) => value.id === item.id) ?? item); setDirty(false); }
  function closeEditor() { if (editorBusy) return; if (dirty) setDiscard(() => () => { setEditing(null); setDirty(false); }); else setEditing(null); }
  async function change(request: CalendarChange) {
    if (busy) throw new Error('Wait for the current change to finish.');
    setBusy(true); setError('');
    try { const item = await source.calendarChange(request); refresh(); window.dispatchEvent(new Event('lumo-calendar-changed')); return item; } finally { setBusy(false); }
  }
  async function save(item: CalendarItem) { await change({ action: 'save', item }); setEditing(null); setDirty(false); setSelected(null); }
  async function remove() {
    if (!deleting) return;
    try { const item = await change({ action: 'delete', id: deleting.id, revision: deleting.revision }); setUndo(deleting.id.startsWith('g:') ? null : item); setSelected(null); setDeleting(null); } catch (err) { setError(errorText(err)); }
  }
  async function complete(item: CalendarItem) { try { await change({ action: 'complete', id: item.id, revision: item.revision }); } catch (err) { setError(errorText(err)); } }
  function pickDay(day: Date) { setMonthNavigation((value) => value + 1); setAnchor(dateKey(day)); setView('day'); }
  function chooseTab(next: Tab) { setTab(next); setQuery(''); setSelected(null); }
  useAppMenus({ file: [{ id: 'calendar-new', label: 'New Event', disabled: !snapshot || busy, run: () => create('event') }, { id: 'reminder-new', label: 'New Reminder', disabled: !snapshot || busy, run: () => create('reminder') }], view: [...views.map((v) => ({ id: `calendar-${v}`, label: v[0].toUpperCase() + v.slice(1), checked: tab === 'calendar' && view === v, run: () => { chooseTab('calendar'); setView(v); } })), { id: 'calendar-refresh', label: 'Refresh', separatorAbove: true, disabled: loading, run: refresh }] });
  const filterTitle = smart.includes(filter as typeof smart[number]) ? filter : collections.find((c) => c.id === filter)?.name ?? 'Reminders';
  const heading = tab === 'reminders' ? filterTitle : view === 'year' ? String(date.getFullYear()) : view === 'day' ? date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : monthLabel(date);
  const grouping = (item: CalendarItem) => {
    if (filter !== 'Today') return item.due ? localDate(item.due).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'No due date';
    if (item.due.slice(0, 10) < dateKey(new Date())) return 'Overdue';
    if (item.due.length === 10) return 'Any time';
    const hour = localDate(item.due).getHours(); return hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  };
  const groups = [...new Set(shownReminders.map(grouping))];
  return <div className="calendar-app" data-testid="calendar-app">
    <nav className="calendar-rail" aria-label="Calendar app"><div role="tablist" aria-orientation="vertical" onKeyDown={(e) => moveTab(e, ['calendar', 'reminders'] as const, tab === 'calendar' ? 'calendar' : 'reminders', chooseTab)}>{([{ id: 'calendar', label: 'Calendar', icon: IconCalendar }, { id: 'reminders', label: 'Reminders', icon: IconBell }] as const).map(({ id, label, icon: Icon }) => <button key={id} role="tab" tabIndex={tab === id || tab === 'accounts' && id === 'calendar' ? 0 : -1} aria-selected={tab === id} aria-label={label} title={label} onClick={() => chooseTab(id)}><Icon size={21}/></button>)}</div><button className={tab === 'accounts' ? 'selected' : ''} aria-label="Accounts" title="Accounts" onClick={() => chooseTab('accounts')}><IconUser size={20}/></button></nav>
    {tab !== 'accounts' && sidebar && <aside className="calendar-sidebar" data-testid="calendar-sidebar">
      <div className="calendar-section-heading"><h2>{tab === 'calendar' ? 'Calendars' : 'Reminders'}</h2><button className="btn btn-icon calendar-hide-sidebar" aria-label="Hide sidebar" title="Hide sidebar" onClick={() => setSidebar(false)}><IconSidebar size={15}/></button><button className="btn btn-icon" aria-label="Refresh calendar" title="Refresh calendar" disabled={loading || busy} onClick={refresh}><IconRefresh size={17}/></button></div>
      {tab === 'reminders' && <div className="calendar-smart-grid">{smart.map((label) => <button className={filter === label ? 'selected' : ''} key={label} aria-pressed={filter === label} onClick={() => setFilter(label)} data-testid={`reminders-${label.toLowerCase()}`}><span>{label}</span><strong>{reminders.filter((item) => matchesFilter(item, label)).length}</strong></button>)}</div>}
      <div className="calendar-sidebar-lists">{(tab === 'calendar' ? ['local', 'google'] : ['local']).map((provider) => {
        const group = collections.filter((c) => c.kind === (tab === 'calendar' ? 'event' : 'reminder') && c.provider === provider);
        return group.length > 0 || provider === 'local' ? <section key={provider}><div className="calendar-section-heading"><h3>{tab === 'reminders' ? 'My lists' : provider === 'google' ? 'Google' : 'Lumo'}</h3>{provider === 'local' && <button className="btn btn-icon" aria-label={tab === 'calendar' ? 'New calendar' : 'New list'} title={tab === 'calendar' ? 'New calendar' : 'New list'} disabled={busy} onClick={() => { setName(''); setNewCollection(true); }}><IconPlus size={17}/></button>}</div>{group.map((c) => <div className="calendar-collection" key={c.id}>
          <span className="calendar-color-dot" style={{ background: c.color }}/>{tab === 'reminders' ? <button className={filter === c.id ? 'selected' : ''} onClick={() => setFilter(c.id)}>{c.name}</button> : <span title={c.readOnly ? `${c.name} · Read only` : c.name}>{c.name}</span>}
          {tab === 'calendar' ? <Checkbox aria-label={`Show ${c.name}`} checked={!hidden.includes(c.id)} onChange={(checked) => setHidden((old) => checked ? old.filter((id) => id !== c.id) : [...old, c.id])}/> : <small>{reminders.filter((item) => item.collectionId === c.id && !item.completed).length}</small>}
        </div>)}</section> : null;
      })}</div>
      {tab === 'calendar' && <div className="calendar-sidebar-mini" data-testid="calendar-sidebar-mini"><div className="calendar-section-heading"><button className="btn btn-icon" aria-label="Previous month" title="Previous month" onClick={() => setMiniDate((old) => shiftDate(old, 'month', -1))}><IconChevronLeft size={17}/></button><h3>{monthLabel(miniDate)}</h3><button className="btn btn-icon" aria-label="Next month" title="Next month" onClick={() => setMiniDate((old) => shiftDate(old, 'month', 1))}><IconChevronRight size={17}/></button></div><MiniMonth date={miniDate} selected={anchor} onDay={pickDay} dots={events}/></div>}
    </aside>}
    <main className="calendar-main">
      {tab === 'accounts' ? <CalendarGoogle onChanged={refresh}/> : <>
        <header className="calendar-toolbar"><div className="calendar-toolbar-left"><button className="btn btn-icon" aria-label="Toggle sidebar" title="Toggle sidebar" onClick={() => setSidebar((value) => !value)}><IconSidebar size={17}/></button>{tab === 'calendar' && <button className="btn" onClick={today}>Today</button>}</div>
          {tab === 'calendar' && <div className="calendar-view-tabs" role="tablist" aria-label="Calendar view" onKeyDown={(e) => moveTab(e, views, view, setView)}>{views.map((v) => <button key={v} role="tab" tabIndex={view === v ? 0 : -1} aria-selected={view === v} data-testid={`calendar-view-${v}`} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>}
          <button className="btn btn-icon" aria-label={tab === 'calendar' ? 'New event' : 'New reminder'} title={tab === 'calendar' ? 'New event' : 'New reminder'} disabled={!snapshot || busy} onClick={() => create(tab === 'calendar' ? 'event' : 'reminder')}><IconPlus size={18}/></button>
        </header>
        <div className="calendar-content-heading"><h1>{heading}</h1><div className="app-search"><IconSearch size={15}/><input aria-label={tab === 'calendar' ? 'Search events' : 'Search reminders'} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><IconX size={14}/></button>}</div></div>
        {(error || snapshot?.googleError) && <p className="calendar-error" role="alert">{error || snapshot?.googleError} <button className="btn" disabled={loading} onClick={refresh}>Retry</button></p>}
        {loading && !snapshot ? <p className="calendar-loading" role="status">Loading…</p> : <div className="calendar-body">
          {tab === 'calendar' ? <div className="calendar-swipe-pane" ref={swipe.pane} data-testid="calendar-swipe-pane" data-swipe-axis={view === 'month' ? 'vertical' : 'horizontal'}><div className="calendar-swipe-track" ref={swipe.track} data-testid="calendar-swipe-track"><div className="calendar-page calendar-page-current"><CalendarViews date={date} onMonth={scrollMonth} onTimeline={scrollMonth} monthNavigation={monthNavigation} view={view} events={events} collections={collections} selected={selected && 'occurrenceId' in selected ? selected.occurrenceId : null} onDay={pickDay} onSelect={setSelected} onCreate={(when) => create('event', when)}/></div>{swipe.preview !== 0 && <div className="calendar-page calendar-page-neighbor" aria-hidden="true" ref={(node) => { if (node) node.inert = true; }} data-testid="calendar-neighbor-page" data-date={dateKey(neighborDate)} style={view === 'month' ? { top: `${swipe.preview * 100}%`, bottom: 'auto', height: '100%' } : { left: `${swipe.preview * 100}%` }}><CalendarViews date={neighborDate} view={view} events={neighborEvents} collections={neighbor?.key === neighborKey ? neighbor.snapshot.collections : collections} selected={null} onDay={pickDay} onSelect={setSelected} onCreate={(when) => create('event', when)} preview scrollPosition={previewScroll}/></div>}</div></div> : <div className="calendar-reminders" data-testid="calendar-reminders">
            {!shownReminders.length && <div className="calendar-empty"><IconBell size={30}/><h2>{query ? 'No matching reminders' : filter === 'Completed' ? 'No completed reminders' : 'Nothing here yet'}</h2>{filter !== 'Completed' && <button className="btn" disabled={!snapshot} onClick={() => create('reminder')}>New reminder</button>}</div>}
            {groups.map((group) => <section className="calendar-reminder-group" key={group}><h3>{group}</h3>{shownReminders.filter((item) => grouping(item) === group).map((item) => <div className={`calendar-reminder-row${item.completed ? ' completed' : ''}`} key={item.id} data-testid="calendar-reminder"><button className="calendar-reminder-content" onClick={() => setSelected(item)}><strong>{item.title}</strong><span>{[item.due ? timeLabel(item.due) : '', item.priority !== 'none' ? `${item.priority} priority` : '', item.flagged ? 'Flagged' : '', item.repeat !== 'none' ? item.repeat : ''].filter(Boolean).join(' · ')}</span>{item.notes && <small>{item.notes}</small>}</button><Checkbox aria-label={`Complete ${item.title}`} checked={item.completed} disabled={busy} onChange={() => void complete(item)}/></div>)}</section>)}
          </div>}
          {selected && <aside className="calendar-detail" data-testid="calendar-detail"><div className="calendar-detail-heading"><h2>{selected.title}</h2><button className="btn btn-icon" aria-label="Close details" title="Close details" onClick={() => setSelected(null)}><IconX size={16}/></button></div><div className="calendar-detail-actions"><span style={{ color: collections.find((c) => c.id === selected.collectionId)?.color }}>{collections.find((c) => c.id === selected.collectionId)?.name}</span>{!collections.find((c) => c.id === selected.collectionId)?.readOnly && <button className="btn" disabled={busy} onClick={() => edit(selected)}>Edit</button>}</div>
            <dl>{selected.kind === 'event' ? <><dt>Starts</dt><dd>{localDate(selected.start).toLocaleDateString()} · {timeLabel(selected.start)}</dd><dt>Ends</dt><dd>{localDate(selected.allDay ? dateKey(addDays(localDate(selected.end), -1)) : selected.end).toLocaleDateString()} · {timeLabel(selected.end)}</dd></> : selected.due ? <><dt>Due</dt><dd>{localDate(selected.due).toLocaleDateString()} · {timeLabel(selected.due)}</dd></> : null}<dt>Time zone</dt><dd>{selected.timeZone}</dd>{selected.repeat !== 'none' && <><dt>Repeat</dt><dd>{selected.repeat}{selected.repeatUntil ? ` · until ${selected.repeatUntil}` : ''}</dd></>}{selected.kind === 'event' && selected.alertMinutes !== null && <><dt>Alert</dt><dd>{selected.alertMinutes === 0 ? 'At start' : `${selected.alertMinutes} minutes before`}</dd></>}{selected.location && <><dt>Location</dt><dd>{selected.location}</dd></>}</dl>{selected.notes && <p className="calendar-notes">{selected.notes}</p>}{selected.repeat !== 'none' && !selected.id.startsWith('g:') && <p className="calendar-hint">Editing or deleting changes the repeating series.</p>}{!collections.find((c) => c.id === selected.collectionId)?.readOnly && <button className="btn calendar-delete" disabled={busy} onClick={() => setDeleting(snapshot?.items.find((item) => item.id === selected.id) ?? selected)}>Delete</button>}
          </aside>}
        </div>}
        {undo && <div className="calendar-undo" role="status"><span>Deleted “{undo.title}”</span><button className="btn" disabled={busy} onClick={() => { void change({ action: 'restore', id: undo.id, revision: undo.revision }).then(() => setUndo(null)).catch((err) => setError(errorText(err))); }}>Undo</button><button className="btn btn-icon" aria-label="Dismiss undo" onClick={() => setUndo(null)}><IconX size={14}/></button></div>}
      </>}
    </main>
    {editing && <CalendarEditor initial={editing} collections={collections} onSave={save} onCancel={closeEditor} onDirty={setDirty} onBusy={setEditorBusy}/>}
    {discard && <AppConfirmation title="Discard unsaved changes?" confirm="Discard" onConfirm={() => { const proceed = discard; setDiscard(null); setDirty(false); proceed(); }} onCancel={() => setDiscard(null)}><p>Your changes have not been saved.</p></AppConfirmation>}
    {deleting && <AppConfirmation title={`Delete ${deleting.kind}?`} confirm="Delete" busy={busy} onConfirm={() => void remove()} onCancel={() => setDeleting(null)}><p>Delete “{deleting.title}”{deleting.repeat !== 'none' ? ' and its repeating series' : ''}?</p>{error && <p role="alert" className="calendar-error">{error}</p>}</AppConfirmation>}
    {newCollection && <AppConfirmation title={tab === 'calendar' ? 'New calendar' : 'New list'} confirm="Create" busy={busy} confirmDisabled={!name.trim()} onCancel={() => setNewCollection(false)} onConfirm={() => { void change({ action: 'collection', collection: { id: '', name: name.trim(), color, kind: tab === 'calendar' ? 'event' : 'reminder', provider: 'local', readOnly: false } }).then(() => setNewCollection(false)).catch((err) => setError(errorText(err))); }}><div className="calendar-editor app-modal-scroll"><label>Name<input aria-label="Name" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)}/></label><div className="calendar-color-field"><span>Color</span><div className="calendar-color-options" role="group" aria-label="Color">{collectionColors.map((choice) => <button key={choice.value} type="button" aria-label={choice.name} title={choice.name} aria-pressed={color === choice.value} style={{ background: choice.value }} onClick={() => setColor(choice.value)}/>)}</div></div>{error && <p role="alert" className="calendar-error">{error}</p>}</div></AppConfirmation>}
  </div>;
}
export function CalendarNotifications() {
  const { actions } = useShell();
  useEffect(() => {
    let alive = true, pending = false;
    if (new URLSearchParams(window.location.search).has('calendar')) actions.openApp('calendar');
    const source = getDataSource();
    const poll = async () => { if (pending) return; pending = true; try { const notices = await source.calendarNotices(); if (alive) for (const notice of notices) actions.notify(notice.title, notice.body); } catch {} finally { pending = false; } };
    void poll(); const timer = window.setInterval(() => void poll(), 60_000);
    const resume = () => void poll(); window.addEventListener('focus', resume); window.addEventListener('lumo-calendar-changed', resume);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', resume); window.removeEventListener('lumo-calendar-changed', resume); };
  }, [actions]);
  return null;
}
