// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/transport';
import { describeError, getDataSource } from '../api/source';
import type { TrashItem } from '../api/trash';
import { useShell } from '../shell/ShellContext';
import { useCurrentWindow } from '../shell/WindowContext';
import { useContextMenu } from '../shell/ContextMenu';
import { IconFile, IconFolder, IconTrash } from '../shell/icons';
import { formatModified, formatSize } from '../utils/file-format';
import { AppConfirmation } from './ServerAppUI';
import '../styles/trash.css';

export function Trash({ embedded = false }: { embedded?: boolean }) {
  const source = getDataSource();
  const { state, actions } = useShell();
  const win = useCurrentWindow();
  const contextMenu = useContextMenu();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<TrashItem[] | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (embedded || state.navigation?.target !== 'trash') return;
    let alive = true;
    void source.listTrash().then((next) => {
      if (!alive) return;
      setItems(next);
      if (next.length) setConfirm(next);
      else actions.notify('Trash is empty', 'There are no items to remove.');
    }).catch((err) => { if (alive) setError(describeError(err)); });
    return () => { alive = false; };
  }, [state.navigation, source, embedded]);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await source.listTrash();
      if (request === generation.current) setItems(next);
    } catch (err) { if (request === generation.current) setError(describeError(err)); }
    finally { if (request === generation.current) setLoading(false); }
  }, [source]);
  const focused = state.focused === win.id;
  useEffect(() => {
    void refresh();
    if (!focused) return () => { generation.current++; };
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    window.addEventListener('focus', refresh);
    return () => { generation.current++; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [focused, refresh, state.fileRevision]);
  const item = items.find((entry) => entry.id === selected);

  async function restore(entry: TrashItem) {
    setBusy(true); setError(null);
    try {
      await source.restoreTrash({ id: entry.id, revision: entry.revision });
      actions.filesChanged();
      actions.notify(`${entry.name} restored`, entry.originalPath);
      setSelected(null);
    } catch (err) { setError(err instanceof ApiError && err.code === 'conflict' ? 'An item already exists at the original location. Move or rename it before restoring.' : err instanceof ApiError && err.code === 'not_found' ? 'The original folder or Trash item is no longer available.' : describeError(err)); }
    finally { await refresh(); setBusy(false); }
  }

  async function remove(entries: TrashItem[]) {
    setBusy(true); setError(null);
    try {
      await source.deleteTrash(entries.map(({ id, revision }) => ({ id, revision })));
      actions.filesChanged();
      setSelected(null);
    } catch (err) { setError(describeError(err)); }
    finally { setConfirm(null); await refresh(); setBusy(false); }
  }

  return <div className="app trash" data-testid="app-trash">
    <div className="app-toolbar">
      <span className="trash-intro">Deleted items stay here until you empty Trash.</span>
      <button className="btn" type="button" data-testid="trash-refresh" disabled={busy} onClick={() => { setError(null); void refresh(); }}>Refresh</button>
      <button className="btn" type="button" data-testid="trash-restore" disabled={busy || !item?.canRestore} onClick={() => item && void restore(item)}>Restore</button>
      <button className="btn btn-danger" type="button" data-testid="trash-empty" disabled={busy || !items.length} onClick={() => setConfirm([...items])}>Empty Trash…</button>
    </div>
    {error && <p className="trash-error" role="alert">{error}</p>}
    {loading ? <div className="trash-empty">Loading Trash…</div> : items.length === 0 ? <div className="trash-empty" data-testid="trash-empty-state"><IconTrash size={48}/><h2>Trash is empty</h2><p>Items you move to Trash will appear here.</p></div> : <div className="trash-scroll">
      <div className="trash-columns" aria-hidden="true"><span>Name and original location</span><span>Deleted</span><span>Size</span></div>
      <div role="listbox" aria-label="Trash items">{items.map((entry) => {
        const Icon = entry.type === 'directory' ? IconFolder : IconFile;
        return <button type="button" role="option" aria-selected={entry.id === selected} key={entry.id} className={`trash-row${entry.id === selected ? ' selected' : ''}`} data-testid={`trash-item-${entry.id}`} disabled={busy} onClick={() => setSelected(entry.id)} onDoubleClick={() => { if (entry.canRestore) void restore(entry); }} onKeyDown={(event) => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); setConfirm([entry]); } }} onContextMenu={(event) => {
          setSelected(entry.id);
          contextMenu(event, [
            { label: 'Restore', disabled: busy || !entry.canRestore, run: () => void restore(entry) },
            { label: 'Delete Permanently…', danger: true, separator: true, disabled: busy, run: () => setConfirm([entry]) },
          ]);
        }}>
          <span className="trash-name"><Icon size={22}/><span><strong>{entry.name}</strong><small>{entry.canRestore ? entry.originalPath : 'Original location unavailable · cannot restore automatically'}</small></span></span>
          <span>{entry.deletedAt ? formatModified(entry.deletedAt) : 'Unknown'}</span><span>{entry.type === 'directory' ? 'Folder' : formatSize(entry.sizeBytes)}</span>
        </button>;
      })}</div>
    </div>}
    <footer className="trash-footer"><span>{items.length} {items.length === 1 ? 'item' : 'items'}</span><span title={item?.originalPath}>{item?.originalPath}</span>{item && <button className="btn" type="button" data-testid="trash-delete" disabled={busy} onClick={() => setConfirm([item])}>Delete Permanently…</button>}</footer>
    {confirm && <AppConfirmation title={confirm.length === 1 ? `Permanently delete “${confirm[0].name}”?` : `Permanently delete ${confirm.length} items?`} confirm="Delete Permanently" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void remove(confirm)}><p>These items will be permanently removed from this server. This cannot be undone.</p></AppConfirmation>}
  </div>;
}
