// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { describeError, getDataSource, type FsEntry } from '../api/source';
import { useItemSelection } from '../apps/useFileSelection';
import { folderPath } from '../utils/folder-path';
import { copyText } from '../utils/clipboard';
import { useShell } from './ShellContext';
import { useContextMenu } from './ContextMenu';
import { IconFile, IconFolder } from './icons';
import { endFileDrag, startFileDrag, useFileDrop } from './fileDrag';
import { dockSpace, MENUBAR_H } from './windowGeometry';
import '../styles/desktop-items.css';

export function DesktopItems() {
  const source = getDataSource();
  const { state, actions } = useShell();
  const contextMenu = useContextMenu();
  const drop = useFileDrop();
  const grid = useRef<HTMLDivElement>(null);
  const [desktop, setDesktop] = useState<string[] | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const selection = useItemSelection(entries.map((item) => item.name), selected, setSelected);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rows = Math.max(1, Math.floor((state.viewport.h - MENUBAR_H - dockSpace(state.viewport) - 56) / 128));

  useEffect(() => {
    let alive = true, loading = false;
    async function load() {
      if (loading || document.hidden) return;
      loading = true;
      try {
        await source.getIdentity().catch(() => null);
        const location = (await source.listFileLocations()).find((item) => item.id === 'desktop');
        const home = source.absolutePath(source.homePath());
        const path = location ? folderPath(location.path, home, home, source.homePath()) : null;
        const items = path ? await source.listDir(path) : [];
        if (!alive) return;
        setDesktop(path);
        setEntries(items.filter((item) => !item.name.startsWith('.')).sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
        setError(null);
      } catch (err) { if (alive) { setEntries([]); setDesktop(null); setError(describeError(err)); } }
      finally { loading = false; }
    }
    void load();
    const reload = () => { void load(); };
    const timer = window.setInterval(reload, 30_000);
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', reload); };
  }, [source, state.fileRevision, refresh]);

  const directoryKey = desktop?.join('/');
  useEffect(() => { setSelected([]); }, [directoryKey]);
  useEffect(() => { setSelected((current) => current.filter((name) => entries.some((item) => item.name === name))); }, [entries]);

  function open(entry: FsEntry) {
    if (!desktop) return;
    const path = [...desktop, entry.name];
    if (entry.kind === 'dir') actions.openFolder(path);
    else actions.openPreview(path);
  }

  async function trash(names: string[]) {
    if (!desktop || deleting) return;
    setDeleting(true);
    const failures: string[] = [];
    for (const name of names) {
      try { await source.deleteFile([...desktop, name]); }
      catch (err) { failures.push(`${name}: ${describeError(err)}`); }
    }
    setDeleting(false); actions.filesChanged();
    if (failures.length) actions.notify('Could not move to Trash', failures.join('\n'));
  }

  return <div ref={grid} className="desktop-items" data-testid="desktop-items" role="listbox" aria-label="Desktop files" aria-multiselectable="true" tabIndex={0} style={{ '--desktop-rows': rows } as CSSProperties} {...selection.bind} {...drop(desktop)} onPointerDown={(event) => {
    actions.focusDesktop();
    selection.bind.onPointerDown(event);
  }} onKeyDown={(event) => {
    selection.bind.onKeyDown(event);
    if (event.key === 'Delete' || ((event.metaKey || event.ctrlKey) && event.key === 'Backspace')) { event.preventDefault(); void trash(selected); }
  }} onContextMenu={(event) => contextMenu(event, [
    { label: 'Open Desktop Folder', disabled: !desktop, run: () => { if (desktop) actions.openFolder(desktop); } },
    { label: 'Refresh', run: () => setRefresh((value) => value + 1) },
    { label: 'Folder Settings', run: () => actions.openSettings('folders') },
  ])}>
    {entries.map((entry, index) => <button type="button" role="option" aria-selected={selected.includes(entry.name)} className={`desktop-item ${entry.kind}`} key={entry.name} data-file-row={entry.name} data-testid={`desktop-item-${entry.name}`} title={entry.name} draggable onClick={(event) => {
      selection.select(entry.name, event);
    }} onDoubleClick={() => open(entry)} onDragStart={(event) => {
      if (!desktop) { event.preventDefault(); return; }
      const names = selected.includes(entry.name) ? selected : [entry.name];
      setSelected(names);
      startFileDrag(event, entries.filter((item) => names.includes(item.name)).map((item) => ({ path: [...desktop, item.name], kind: item.kind })));
    }} onDragEnd={endFileDrag} {...drop(entry.kind === 'dir' && desktop ? [...desktop, entry.name] : null)} onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); open(entry); }
      const offset = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowLeft' ? rows : event.key === 'ArrowRight' ? -rows : 0;
      if (offset) { event.preventDefault(); const next = Math.max(0, Math.min(entries.length - 1, index + offset)); setSelected([entries[next].name]); grid.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus(); }
    }} onContextMenu={(event) => {
      const names = selected.includes(entry.name) ? selected : [entry.name];
      setSelected(names);
      contextMenu(event, [
        { label: 'Open', run: () => open(entry) },
        { label: 'Show in Files', run: () => { if (desktop) actions.openFolder(desktop); } },
        { label: 'Copy Path', run: () => { if (desktop) void copyText(source.absolutePath([...desktop, entry.name])).catch(() => actions.notify('Clipboard unavailable', 'Could not copy the file path.')); } },
        { label: 'Move to Trash', separator: true, disabled: deleting, run: () => { void trash(names); } },
      ]);
    }}><span className="desktop-item-icon">{entry.kind === 'dir' ? <IconFolder/> : <IconFile/>}</span><span className="desktop-item-name">{entry.name}</span></button>)}
    {selection.box && <div className="files-selection-box" data-testid="desktop-selection-box" style={selection.box} aria-hidden="true"/>}
    {error && <button type="button" className="desktop-error" title={error} onClick={() => setRefresh((value) => value + 1)}>Desktop unavailable · Retry</button>}
  </div>;
}
