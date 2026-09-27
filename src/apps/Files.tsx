// SPDX-License-Identifier: AGPL-3.0-only
import { useReorder } from '../shell/useReorder';
import { useAppPreference, useAppState } from '../shell/useAppState';
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { base64ToBytes, bytesToBase64 } from '../api/encoding';
import { describeError, getDataSource, type FsEntry } from '../api/source';
import { ApiError } from '../api/transport';
import { FileDetails } from './FileDetails';
import { Trash } from './Trash';
import { formatSize } from '../utils/file-format';
import { useContextMenu } from '../shell/ContextMenu';
import { useShell } from '../shell/ShellContext';
import { IconTrash, IconChevronRight, IconEye, IconFile, IconFolder, IconHome, IconUpload } from '../shell/icons';
import '../styles/apps.css';
import '../styles/files.css';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function Files() {
  const openContextMenu = useContextMenu();
  const source = getDataSource();
  const { state, actions } = useShell();
  const [path, setPath] = useAppState<string[]>('files', 'path', () => source.homePath());
  const [showHidden, setShowHidden] = useAppPreference<boolean>('files', 'show-hidden', false);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [pinnedFolders, setPinnedFolders] = useAppPreference<string[]>('files', 'pinned-folders', []);
  const reorderPinned = useReorder(pinnedFolders, setPinnedFolders, (path) => path, 'vertical');
  const [location, setLocation] = useAppState<'folder' | 'trash'>('files', 'location', 'folder', ['folder', 'trash']);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedName, setSelectedName] = useAppState<string | null>('files', 'selection', null);
  const [detailsOpen, setDetailsOpen] = useAppState<boolean>('files', 'details', false);
  const [creation, setCreation] = useState<{ kind: 'file' | 'directory'; name: string; busy: boolean; error: string | null } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useAppPreference<boolean>('files', 'sidebar-collapsed', () => window.innerWidth < 700);
  const [deleteTarget, setDeleteTarget] = useState<FsEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (location === 'trash') return;
    let alive = true;
    (async () => {
      await source.getIdentity().catch(() => null);
      if (!alive) return;
      const home = source.homePath();
      if (path.length === 1 && path[0] !== home[0]) {
        setPath(home);
        return;
      }
      try {
        const list = await source.listDir(path);
        if (!alive) return;
        setEntries(list);
        setListError(null);
      } catch (err) {
        if (!alive) return;
        setEntries([]);
        setListError(describeError(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, path, refreshNonce, state.fileRevision, location]);

  const visibleEntries = entries.filter((entry) => showHidden || !entry.name.startsWith('.'));
  const selected = visibleEntries.find((e) => e.name === selectedName) ?? null;

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  function pinAction(folderPath: string[]) {
    const key = folderPath.join('/');
    const pinned = pinnedFolders.includes(key);
    return { label: pinned ? 'Unpin Folder' : 'Pin Folder', run: () => setPinnedFolders((current) => pinned ? current.filter((item) => item !== key) : [...current, key]) };
  }

  function navigateTo(nextPath: string[]) {
    setLocation('folder');
    setPath(nextPath);
    setSelectedName(null);
  }

  function showDetails(entry: FsEntry) {
    setSelectedName(entry.name);
    setDetailsOpen(true);
  }

  function startCreate(kind: 'file' | 'directory') {
    setCreation({ kind, name: '', busy: false, error: null });
  }

  async function create() {
    if (!creation || creation.busy) return;
    const name = creation.name.trim();
    if (!name || name === '.' || name === '..' || /[\/\x00]/.test(name)) {
      setCreation({ ...creation, error: 'Enter a name without slashes.' });
      return;
    }
    setCreation({ ...creation, busy: true, error: null });
    try {
      await source.createEntry([...path, name], creation.kind);
      setCreation(null);
      setSelectedName(name);
      refresh();
    } catch (err) { setCreation({ ...creation, busy: false, error: err instanceof ApiError && err.code === 'conflict' ? 'A file or folder with this name already exists.' : describeError(err) }); }
  }

  function activate(entry: FsEntry) {
    if (entry.kind === 'dir') navigateTo([...path, entry.name]);
    else actions.openPreview([...path, entry.name]);
  }

  function onRowKey(e: ReactKeyboardEvent, entry: FsEntry) {
    if (e.key === 'Enter') {
      e.preventDefault();
      activate(entry);
    } else if (e.key === ' ') {
      e.preventDefault();
      showDetails(entry);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = visibleEntries.findIndex((en) => en.name === entry.name);
      const next = visibleEntries[e.key === 'ArrowDown' ? idx + 1 : idx - 1];
      if (next) {
        setSelectedName(next.name);
        const row = document.querySelector<HTMLElement>(`[data-file-row="${CSS.escape(next.name)}"]`);
        row?.focus();
      }
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await source.deleteFile([...path, target.name]);
      actions.filesChanged();
      setDeleteTarget(null);
      setSelectedName(null);
      refresh();
    } catch (err) {
      setDeleteTarget(null);
      actions.notify('Could not move to Trash', describeError(err));
    } finally {
      setDeleting(false);
    }
  }

  async function download(entry: FsEntry) {
    try {
      const read = await source.readFile([...path, entry.name]);
      if (read.contentBase64 === null || read.truncated) {
        actions.notify('Download unavailable', read.truncated ? 'This file exceeds the 1 MiB download limit.' : `${entry.name} cannot be downloaded yet.`);
        return;
      }
      const bytes = base64ToBytes(read.contentBase64);
      const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = entry.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      actions.notify('Download failed', describeError(err));
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      actions.notify('Upload too large', 'Maximum file size: 8 MiB.');
      return;
    }
    setUploading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await source.writeFile([...path, file.name], bytesToBase64(bytes), null);
      refresh();
    } catch (err) {
      actions.notify('Upload failed', describeError(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="app files" data-testid="app-files" onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'h') {
          event.preventDefault(); event.stopPropagation(); setShowHidden((value) => !value);
        }
      }}>
      <div className="files-workspace">
        <aside className={`files-sidebar${sidebarCollapsed ? ' collapsed' : ''}`} aria-label="File locations" data-testid="files-sidebar">
          <header className="files-sidebar-header"><h2>Locations</h2><button type="button" className="btn files-sidebar-toggle" data-testid="files-sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><IconChevronRight size={16} /></button></header>
          <button
            type="button"
            className={`files-location${location === 'folder' && path.join('/') === source.homePath().join('/') ? ' selected' : ''}`}
            data-testid="files-location-home" aria-label="Home" title="Home"
            aria-current={location === 'folder' && path.join('/') === source.homePath().join('/') ? 'location' : undefined}
            onClick={() => navigateTo(source.homePath())}
            onContextMenu={(event) => openContextMenu(event, [{ label: 'Open in OpenCode', run: () => actions.openOpenCode(source.absolutePath(source.homePath())) }])}
          >
            <IconHome size={19} />
            <span>Home</span>
          </button>
          <button type="button" className={`files-location${location === 'trash' ? ' selected' : ''}`} aria-current={location === 'trash' ? 'location' : undefined} data-testid="files-location-trash" aria-label="Trash" title="Trash" onClick={() => setLocation('trash')}><IconTrash size={19}/><span>Trash</span></button>
          <h2>Pinned</h2>
          {pinnedFolders.length === 0 && !sidebarCollapsed && <p className="files-pinned-hint">Right-click a folder to pin it here.</p>}
          {pinnedFolders.map((key) => {
            const folderPath = key.split('/');
            const name = folderPath[folderPath.length - 1];
            const active = location === 'folder' && path.join('/') === key;
            return (
              <button
                key={key}
                {...reorderPinned.bind(key)}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                type="button"
                className={`files-location${active ? ' selected' : ''}`}
                data-testid={`files-pin-${key}`} aria-label={name} title={source.absolutePath(folderPath)}
                aria-current={active ? 'location' : undefined}
                onClick={() => navigateTo(folderPath)}
                onContextMenu={(event) => openContextMenu(event, [{ label: 'Open Folder', run: () => navigateTo(folderPath) }, { label: 'Open in OpenCode', run: () => actions.openOpenCode(source.absolutePath(folderPath)) }, pinAction(folderPath)])}
              >
                <IconFolder size={19} />
                <span>{name}</span>
              </button>
            );
          })}
        </aside>
        <div className="files-main">
          {location === 'trash' ? <Trash embedded/> : <>
          <div className="app-toolbar">
            <button type="button" className="btn" data-testid="files-new" aria-haspopup="menu" onClick={(event) => openContextMenu(event, [
              { label: 'New File', run: () => startCreate('file') },
              { label: 'New Folder', run: () => startCreate('directory') },
            ])}>New</button>
            <button type="button" className="btn" data-testid="files-view" aria-haspopup="menu" onClick={(event) => openContextMenu(event, [
              { label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', run: () => setShowHidden((value) => !value) },
              { label: detailsOpen ? 'Hide Details' : 'Show Details', run: () => setDetailsOpen((value) => !value) },
              { label: sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar', run: () => setSidebarCollapsed((value) => !value) },
            ])}>View</button>
            <nav className="files-breadcrumbs" aria-label="Path">
              <IconHome size={18} />
              <button type="button" className="files-crumb" onClick={() => navigateTo(source.homePath())}>
                Home
              </button>
              {path.slice(1).map((segment, i) => (
                <span key={segment} className="files-crumb-group">
                  <IconChevronRight size={11} />
                  <button
                    type="button"
                    className="files-crumb"
                    onClick={() => navigateTo(path.slice(0, i + 2))}
                  >
                    {segment}
                  </button>
                </span>
              ))}
            </nav>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="upload-button"
              disabled={uploading}
              onClick={() => uploadInputRef.current?.click()}
            >
              <IconUpload size={15} />
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input ref={uploadInputRef} type="file" hidden data-testid="upload-input" onChange={(e) => void upload(e)} />
            <button
              type="button"
              className="btn files-details-btn"
              data-testid="quick-look-button" aria-pressed={detailsOpen}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              <IconEye size={13} />
              Details
            </button>

          </div>

          <div className="files-table-scroll" data-testid="files-table-scroll"><div className="files-table">
          <div className="files-head" role="row" aria-hidden="true">
            <span>Name</span>
            <span>Size</span>
            <span>Modified</span>
          </div>
          <div className="files-list" onClick={(event) => { if (event.target === event.currentTarget) setSelectedName(null); }} onContextMenu={(event) => openContextMenu(event, [
            { label: 'New File', run: () => startCreate('file') },
            { label: 'New Folder', run: () => startCreate('directory') },
            { label: 'Upload File', disabled: uploading, run: () => uploadInputRef.current?.click() },
            { label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', run: () => setShowHidden((value) => !value) },
            { label: 'Refresh', run: refresh },
            { label: 'Open in OpenCode', run: () => actions.openOpenCode(source.absolutePath(path)) },
            pinAction(path),
            { label: 'Go Home', run: () => navigateTo(source.homePath()) },
          ])} role="listbox" aria-label="Files" aria-activedescendant={selected ? `file-${selected.name}` : undefined}>
            {visibleEntries.map((entry) => (
              <div
                key={entry.name}
                id={`file-${entry.name}`}
                role="option"
                aria-selected={selectedName === entry.name}
                tabIndex={0}
                data-file-row={entry.name}
                data-testid={`file-row-${entry.name}`}
                data-kind={entry.kind}
                className={`file-row${selectedName === entry.name ? ' selected' : ''}`}
                onContextMenu={(event) => {
                  setSelectedName(entry.name);
                  openContextMenu(event, [
                    { label: entry.kind === 'dir' ? 'Open Folder' : 'Open in Preview', run: () => activate(entry) },
                    ...(entry.kind === 'dir' ? [{ label: 'Open in OpenCode', run: () => actions.openOpenCode(source.absolutePath([...path, entry.name])) }, pinAction([...path, entry.name])] : []),
                    ...(entry.kind === 'file' ? [
                      { label: 'Edit', run: () => actions.openPreview([...path, entry.name], true) },
                      { label: 'Download', run: () => void download(entry) },
                    ] : []),
                    { label: 'Details', run: () => showDetails(entry) },
                    { label: 'Move to Trash', separator: true, danger: true, run: () => setDeleteTarget(entry) },
                  ]);
                }}
                onClick={() => setSelectedName(entry.name)}
                onDoubleClick={() => activate(entry)}
                onKeyDown={(e) => onRowKey(e, entry)}
              >
                <span className="file-name">
                  {entry.kind === 'dir' ? <IconFolder size={15} /> : <IconFile size={15} />}
                  <span>{entry.name}</span>
                </span>
                <span className="file-size mono">{entry.kind === 'dir' ? '—' : formatSize(entry.size)}</span>
                <span className="file-modified">{entry.modified}</span>
              </div>
            ))}
            {listError && (
              <p className="files-empty">
                {listError}{' '}
                <button type="button" className="btn" data-testid="files-retry" onClick={() => setPath((p) => [...p])}>
                  Retry
                </button>
              </p>
            )}
            {!listError && visibleEntries.length === 0 && <p className="files-empty">Empty folder.</p>}
          </div>
          </div></div>
          <footer className="files-status" data-testid="files-status">
            <span>{listError ? 'Folder unavailable' : `${visibleEntries.length} ${visibleEntries.length === 1 ? 'item' : 'items'}`}</span>
            <span className="mono" data-testid="files-absolute-path" title={source.absolutePath(selected ? [...path, selected.name] : path)}>{source.absolutePath(selected ? [...path, selected.name] : path)}</span>
          </footer>
          </>}
        </div>
        <FileDetails open={detailsOpen && location === 'folder'} entry={selected} path={source.absolutePath(selected ? [...path, selected.name] : path)} onClose={() => setDetailsOpen(false)} />
      </div>

      {creation && <div className="quicklook-overlay">
        <form className="file-confirm file-create" role="dialog" aria-modal="true" aria-label={creation.kind === 'directory' ? 'New Folder' : 'New File'} data-testid="files-create-dialog" onSubmit={(event) => { event.preventDefault(); void create(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !creation.busy) { event.stopPropagation(); setCreation(null); } }}>
          <h2>{creation.kind === 'directory' ? 'New Folder' : 'New File'}</h2>
          <label>Name<input autoFocus className="file-create-name" data-testid="files-create-name" value={creation.name} disabled={creation.busy} onChange={(event) => setCreation({ ...creation, name: event.target.value, error: null })} autoComplete="off" /></label>
          {creation.error && <p role="alert">{creation.error}</p>}
          <div className="file-confirm-actions"><button type="button" className="btn" disabled={creation.busy} onClick={() => setCreation(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="files-create-submit" disabled={creation.busy || !creation.name.trim()}>{creation.busy ? 'Creating…' : 'Create'}</button></div>
        </form>
      </div>}

      {deleteTarget && (
        <div className="quicklook-overlay" onPointerDown={() => !deleting && setDeleteTarget(null)}>
          <div
            className="file-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Move ${deleteTarget.name} to Trash`}
            data-testid="delete-confirm"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p>
              Move “{deleteTarget.name}” to Trash?
            </p>
            <div className="file-confirm-actions">
              <button
                type="button"
                className="btn"
                data-testid="delete-cancel-button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="delete-confirm-button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? 'Moving…' : 'Move to Trash'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
