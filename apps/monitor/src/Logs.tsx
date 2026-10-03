// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '@lumo/sdk/shell/appMenus';
import { useContextMenu } from '@lumo/sdk/shell/ContextMenu';
import { copyText } from '@lumo/sdk/utils/clipboard';
import { useAppState } from '@lumo/sdk/shell/useAppState';
import { Select } from '@lumo/sdk/shell/Select';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  describeError,
  getDataSource,
  type JournalBoot,
  type LogLine,
  type LogPriority,
} from '@lumo/sdk/api/source';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import { IconPause, IconPlay, IconSearch } from '@lumo/sdk/shell/icons';

import './logs.css';

const PRIORITY_FILTERS: { id: 'all' | LogPriority; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'err', label: 'Errors' },
  { id: 'warning', label: 'Warnings' },
  { id: 'info', label: 'Info' },
  { id: 'debug', label: 'Debug' },
];

type TimeRange = 'all' | '15m' | '1h' | '24h';
type BootFilter = 'all' | JournalBoot;

interface SavedSearch {
  id: string;
  label: string;
  priority: 'all' | LogPriority;
  unit: string;
  boot: BootFilter;
  timeRange: TimeRange;
  search: string;
}

const SAVED_SEARCHES_KEY = 'lumo.logs.saved.v1';
const SAVED_PRIORITIES = new Set(['all', 'err', 'warning', 'info', 'debug']);
const SAVED_BOOTS = new Set(['all', 'current', 'previous']);
const SAVED_TIME_RANGES = new Set(['all', '15m', '1h', '24h']);

function loadSavedSearches(): SavedSearch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SavedSearch => {
        if (!item || typeof item !== 'object') return false;
        const value = item as Partial<SavedSearch>;
        return (
          typeof value.id === 'string' &&
          typeof value.label === 'string' &&
          typeof value.unit === 'string' &&
          typeof value.priority === 'string' &&
          SAVED_PRIORITIES.has(value.priority) &&
          typeof value.boot === 'string' &&
          SAVED_BOOTS.has(value.boot) &&
          typeof value.timeRange === 'string' &&
          SAVED_TIME_RANGES.has(value.timeRange) &&
          typeof value.search === 'string'
        );
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}

function sinceFor(range: TimeRange): string | undefined {
  const duration = range === '15m' ? 15 * 60_000 : range === '1h' ? 60 * 60_000 : range === '24h' ? 24 * 60 * 60_000 : 0;
  return duration > 0 ? new Date(Date.now() - duration).toISOString() : undefined;
}

function savedSearchLabel(search: Omit<SavedSearch, 'id' | 'label'>): string {
  const parts = [
    search.unit === 'all' ? 'All units' : search.unit,
    search.priority === 'all' ? null : search.priority,
    search.boot === 'all' ? null : search.boot === 'current' ? 'current boot' : 'previous boot',
    search.timeRange === 'all' ? null : `last ${search.timeRange}`,
    search.search.trim() || null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function exportLines(lines: LogLine[]) {
  const body = lines
    .map((line) =>
      JSON.stringify({
        timestamp: new Date(line.timestamp).toISOString(),
        priority: line.priority,
        unit: line.unit,
        message: line.message,
        fields: line.fields,
      }),
    )
    .join('\n');
  const url = URL.createObjectURL(new Blob([body + (body ? '\n' : '')], { type: 'application/x-ndjson' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `lumo-journal-${new Date().toISOString().replaceAll(':', '-')}.jsonl`;
  link.click();
  URL.revokeObjectURL(url);
}

export function Logs() {
  const openContextMenu = useContextMenu();
  const { actions, state } = useShell();
  const source = getDataSource();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [paused, setPaused] = useState(false);
  const [priority, setPriority] = useAppState<'all' | LogPriority>('logs', 'priority', 'all', ['all', 'err', 'warning', 'info', 'debug']);
  const [unit, setUnit] = useAppState<string>('logs', 'unit', 'all');
  const [boot, setBoot] = useAppState<BootFilter>('logs', 'boot', 'current', ['all', 'current', 'previous']);
  const [timeRange, setTimeRange] = useAppState<TimeRange>('logs', 'range', '1h', ['all', '15m', '1h', '24h']);
  const [search, setSearch] = useAppState<string>('logs', 'search', '');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(loadSavedSearches);
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ id: string; offset: number } | null>(null);

  function rememberScrollPosition() {
    const el = scrollRef.current;
    if (!el || el.scrollTop <= 1) {
      scrollAnchor.current = null;
      return;
    }
    const top = el.getBoundingClientRect().top;
    const row = [...el.querySelectorAll<HTMLElement>('[data-log-id]')].find((item) => item.getBoundingClientRect().bottom > top);
    scrollAnchor.current = row ? { id: row.dataset.logId!, offset: row.getBoundingClientRect().top - top } : null;
  }

  useEffect(() => {
    if (state.navigation?.target === 'logs') {
      setUnit(state.navigation.unit);
    }
  }, [state.navigation]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(savedSearches));
    } catch {
      return;
    }
  }, [savedSearches]);

  useEffect(() => {
    let alive = true;
    source
      .listJournalUnits()
      .then((list) => {
        if (alive) setUnits(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [source, retryNonce]);

  useEffect(() => {
    let alive = true;
    source
      .queryJournal({
        limit: 500,
        unit: unit === 'all' ? undefined : unit,
        priority: priority === 'all' ? undefined : priority,
        since: sinceFor(timeRange),
        boot: boot === 'all' ? undefined : boot,
      })
      .then((page) => {
        if (!alive) return;
        scrollAnchor.current = null;
        setLines(page.entries);
        setSelectedId(null);
        setLoadError(null);
      })
      .catch((err) => {
        if (alive) setLoadError(describeError(err));
      });
    return () => {
      alive = false;
    };
  }, [boot, priority, retryNonce, source, timeRange, unit]);

  useEffect(() => {
    if (paused || boot === 'previous') return;
    setStreamError(null);
    return source.streamJournal(
      (line) => {
        setStreamError(null);
        setLines((prev) => [...prev.slice(-999), line]);
      },
      () => setStreamError('Log stream interrupted. Reconnecting…'),
    );
  }, [boot, source, paused]);

  const unitOptions = useMemo(
    () => [...new Set([...units, ...lines.map((line) => line.unit), ...(unit === 'all' ? [] : [unit])])].sort(),
    [units, lines, unit],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const since = sinceFor(timeRange);
    const sinceMs = since ? Date.parse(since) : 0;
    return lines.filter(
      (line) =>
        (priority === 'all' || line.priority === priority) &&
        (unit === 'all' || line.unit === unit) &&
        (sinceMs === 0 || line.timestamp >= sinceMs) &&
        (!q ||
          line.message.toLowerCase().includes(q) ||
          line.unit.toLowerCase().includes(q) ||
          Object.values(line.fields).some((value) => value.toLowerCase().includes(q))),
    ).sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
  }, [lines, priority, unit, timeRange, search]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = scrollAnchor.current;
    const row = anchor && el.querySelector<HTMLElement>(`[data-log-id="${anchor.id}"]`);
    if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset;
    else el.scrollTop = 0;
    rememberScrollPosition();
  }, [filtered]);

  const selected = lines.find((line) => line.id === selectedId) ?? null;
  const selectedFields = selected ? Object.entries(selected.fields).sort(([a], [b]) => a.localeCompare(b)) : [];

  function saveCurrentSearch() {
    const value = { priority, unit, boot, timeRange, search };
    const signature = JSON.stringify(value);
    const existing = savedSearches.find((item) => JSON.stringify({
      priority: item.priority,
      unit: item.unit,
      boot: item.boot,
      timeRange: item.timeRange,
      search: item.search,
    }) === signature);
    if (existing) {
      setSelectedSavedId(existing.id);
      return;
    }
    const saved: SavedSearch = {
      id: crypto.randomUUID(),
      label: savedSearchLabel(value),
      ...value,
    };
    setSavedSearches((current) => [saved, ...current].slice(0, 20));
    setSelectedSavedId(saved.id);
  }

  function applySavedSearch(id: string) {
    setSelectedSavedId(id);
    const saved = savedSearches.find((item) => item.id === id);
    if (!saved) return;
    setPriority(saved.priority);
    setUnit(saved.unit);
    setBoot(saved.boot);
    setTimeRange(saved.timeRange);
    setSearch(saved.search);
  }

  useAppMenus({
    file: [{ id: 'export', label: 'Export JSONL…', disabled: filtered.length === 0, run: () => exportLines(filtered) }],
    view: [
      { id: 'refresh', label: 'Refresh', run: () => setRetryNonce((value) => value + 1) },
      { id: 'pause', label: 'Pause Live Logs', checked: paused, run: () => setPaused(!paused) },
    ],
  });

  return (
    <div className="app logs" data-testid="app-logs">
      <div className="app-toolbar logs-toolbar">
        <div className="logs-priorities" role="group" aria-label="Priority filter">
          {PRIORITY_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn${priority === item.id ? ' active' : ''}`}
              data-testid={`logs-filter-${item.id}`}
              aria-pressed={priority === item.id}
              onClick={() => setPriority(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <Select className="logs-select" value={unit} onChange={setUnit} aria-label="Filter by unit" options={[{ value: 'all', label: 'All units' }, ...unitOptions.map((name) => ({ value: name, label: name }))]} />
        <Select className="logs-select" value={boot} onChange={(value) => setBoot(value as BootFilter)} aria-label="Filter by boot" options={[{ value: 'all', label: 'All boots' }, { value: 'current', label: 'Current boot' }, { value: 'previous', label: 'Previous boot' }]} />
        <Select className="logs-select" value={timeRange} onChange={(value) => setTimeRange(value as TimeRange)} aria-label="Filter by time" options={[{ value: '15m', label: 'Last 15 minutes' }, { value: '1h', label: 'Last hour' }, { value: '24h', label: 'Last 24 hours' }, { value: 'all', label: 'Any time' }]} />
        <label className="app-search">
          <IconSearch size={13} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs" aria-label="Search logs" />
        </label>
        <div className="app-toolbar-actions">
        <button type="button" className="btn" data-testid="logs-pause" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
          {paused ? <IconPlay size={12} /> : <IconPause size={12} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        </div>
      </div>

      <div className="logs-saved-bar">
        <span>{filtered.length} entries · Newest first</span>
        <Select value={selectedSavedId} onChange={applySavedSearch} aria-label="Saved searches" options={[{ value: '', label: 'Saved searches' }, ...savedSearches.map((saved) => ({ value: saved.id, label: saved.label }))]} />
        <div className="app-toolbar-actions">
        <button type="button" className="btn" data-testid="logs-save-search" onClick={saveCurrentSearch}>Save search</button>
        <button type="button" className="btn" data-testid="logs-export" disabled={filtered.length === 0} onClick={() => exportLines(filtered)}>Export JSONL</button>
        <button
          type="button"
          className="btn"
          data-testid="logs-delete-search"
          disabled={!selectedSavedId}
          onClick={() => {
            setSavedSearches((current) => current.filter((item) => item.id !== selectedSavedId));
            setSelectedSavedId('');
          }}
        >
          Delete
        </button>
        </div>
      </div>

      {streamError && <p className="logs-banner" data-testid="logs-stream-error">{streamError}</p>}

      <div className="logs-list" ref={scrollRef} onScroll={rememberScrollPosition} role="log" aria-label="Journal stream" data-testid="logs-list">
        {filtered.map((line) => (
          <button key={line.id} type="button" className={`logs-row${selectedId === line.id ? ' selected' : ''}`} data-log-id={line.id} data-testid="logs-row" onClick={() => setSelectedId(line.id)} onContextMenu={(event) => {
            setSelectedId(line.id);
            openContextMenu(event, [
              { label: 'Copy Message', run: () => { void copyText(line.message).catch(() => actions.notify('Clipboard unavailable', 'Could not copy the log message.')); } },
              { label: 'Filter to This Unit', disabled: unit === line.unit, run: () => setUnit(line.unit) },
              ...(line.unit.endsWith('.service') ? [{ label: 'Open Service', run: () => actions.openService(line.unit) }] : []),
            ]);
          }}>
            <span className="logs-time mono">{new Date(line.timestamp).toLocaleTimeString([], { hour12: false })}</span>
            <span className={`logs-prio prio-${line.priority}`}>{line.priority}</span>
            <span className="logs-unit-name mono">{line.unit}</span>
            <span className="logs-message">{line.message}</span>
          </button>
        ))}
        {loadError && (
          <p className="logs-empty">
            {loadError}{' '}
            <button type="button" className="btn" data-testid="logs-retry" onClick={() => setRetryNonce((value) => value + 1)}>Retry</button>
          </p>
        )}
        {!loadError && filtered.length === 0 && <p className="logs-empty">No matching entries.</p>}
      </div>

      {selected && (
        <div className="logs-detail" data-testid="logs-detail" aria-label="Log entry detail">
          <header>
            <h2>Fields</h2>
            {selected.unit.endsWith('.service') && (
              <button type="button" className="btn" data-testid="logs-open-service" onClick={() => actions.openService(selected.unit)}>Open service</button>
            )}
          </header>
          <dl>
            <div><dt>PRIORITY</dt><dd className="mono">{selected.priorityCode} ({selected.priority})</dd></div>
            <div><dt>_SYSTEMD_UNIT</dt><dd className="mono">{selected.unit}</dd></div>
            <div><dt>TIMESTAMP</dt><dd className="mono">{new Date(selected.timestamp).toISOString()}</dd></div>
            <div className="logs-detail-message"><dt>MESSAGE</dt><dd>{selected.message}</dd></div>
            {selectedFields.map(([name, value]) => <div key={name}><dt>{name}</dt><dd className="mono">{value}</dd></div>)}
          </dl>
        </div>
      )}
    </div>
  );
}
