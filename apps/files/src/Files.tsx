// SPDX-License-Identifier: AGPL-3.0-only
import { useFileSelection } from '@lumo/sdk/apps/useFileSelection';
import { useFileDrop, useFileDragNavigation, startFileDrag, endFileDrag } from '@lumo/sdk/shell/fileDrag';
import { useAppMenus } from '@lumo/sdk/shell/appMenus';
import { folderPath } from '@lumo/sdk/utils/folder-path';
import { copyText } from '@lumo/sdk/utils/clipboard';
import { DropdownMenu } from '@lumo/sdk/shell/DropdownMenu';
import { useReorder } from '@lumo/sdk/shell/useReorder';
import { useAppPreference, useAppState } from '@lumo/sdk/shell/useAppState';
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { base64ToBytes, bytesToBase64 } from '@lumo/sdk/api/encoding';
import { describeError, getDataSource, type FileLocation as StandardLocation, type FsEntry } from '@lumo/sdk/api/source';
import { ApiError } from '@lumo/sdk/api/transport';
import { FileDetails } from './FileDetails';
import { PluginSurface } from '@lumo/sdk/platform/PluginApp';
import { useContextMenu } from '@lumo/sdk/shell/ContextMenu';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import { IconTrash, IconChevronRight, IconFile, IconFolder, IconHome, IconUpload, IconSidebar, IconDownload, IconMonitor, IconCopy, IconRefresh } from '@lumo/sdk/shell/icons';

import './files.css';

type FileLocation = { path: string[]; location: 'folder' | 'trash' };

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function Files() {
  const openContextMenu = useContextMenu();
  const source = getDataSource();
  const { state, actions } = useShell();
  const [path, setPath] = useAppState<string[]>('files', 'path', () => source.homePath());
  const [showHidden, setShowHidden] = useAppPreference<boolean>('files', 'show-hidden', false);
  const [viewMode, setViewMode] = useAppPreference<'list' | 'grid'>('files', 'view', 'list', ['list', 'grid']);
  const [sortBy, setSortBy] = useAppPreference<'name' | 'type' | 'size' | 'modified'>('files', 'sort-by', 'name', ['name', 'type', 'size', 'modified']);
  const [sortDirection, setSortDirection] = useAppPreference<'ascending' | 'descending'>('files', 'sort-direction', 'ascending', ['ascending', 'descending']);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [standardLocations, setStandardLocations] = useState<StandardLocation[]>([]);
  const [pinnedFolders, setPinnedFolders] = useAppPreference<string[]>('files', 'pinned-folders', []);
  const reorderPinned = useReorder(pinnedFolders, setPinnedFolders, (path) => path, 'vertical');
  const [location, setLocation] = useAppState<'folder' | 'trash'>('files', 'location', 'folder', ['folder', 'trash']);
  const [navigation, setNavigation] = useState<{ back: FileLocation[]; forward: FileLocation[] }>({ back: [], forward: [] });
  const [listError, setListError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const drop = useFileDrop();
  const currentFolder = source.absolutePath(path);
  const parentFolder = currentFolder === '/' || location !== 'folder' ? null : currentFolder.slice(0, currentFolder.lastIndexOf('/')) || '/';
  const dragParent = useFileDragNavigation(parentFolder, () => { if (parentFolder) navigateTo(['', ...parentFolder.split('/').filter(Boolean)]); });
  const [detailsOpen, setDetailsOpen] = useAppState<boolean>('files', 'details', false);
  const [creation, setCreation] = useState<{ kind: 'file' | 'directory'; name: string; busy: boolean; error: string | null } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useAppPreference<boolean>('files', 'sidebar-collapsed', () => window.innerWidth < 700);
  const [deleteTarget, setDeleteTarget] = useState<FsEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  useEffect(() => {
    if (copiedPath === null) return;
    const timer = window.setTimeout(() => setCopiedPath(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedPath]);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const navigationNonce = useRef<number>();
  useEffect(() => {
    if (state.navigation?.target !== 'files' || state.navigation.nonce === navigationNonce.current) return;
    navigationNonce.current = state.navigation.nonce;
    navigateTo(state.navigation.path);
  }, [state.navigation]);

  useEffect(() => {
    if (location === 'trash') return;
    let alive = true;
    (async () => {
      await source.getIdentity().catch(() => null);
      if (!alive) return;
      const home = source.homePath();
      if (path.length === 1 && path[0] !== '' && path[0] !== home[0]) {
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

  useEffect(() => {
    let alive = true;
    source.listFileLocations().then((locations) => {
      if (alive) setStandardLocations(locations);
    }).catch(() => { if (alive) setStandardLocations([]); });
    return () => { alive = false; };
  }, [source, refreshNonce, state.fileRevision]);

  const visibleEntries = entries.filter((entry) => showHidden || !entry.name.startsWith('.')).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    const names = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const value = sortBy === 'type' ? fileType(a).localeCompare(fileType(b)) : sortBy === 'size' ? a.size - b.size : sortBy === 'modified' ? (Date.parse(a.modifiedAt ?? a.modified) || 0) - (Date.parse(b.modifiedAt ?? b.modified) || 0) : names;
    return (value || names) * (sortDirection === 'ascending' ? 1 : -1);
  });
  const selection = useFileSelection(visibleEntries.map((entry) => entry.name));
  const { selectedNames, selectOne: setSelectedName } = selection;
  const selectedEntries = visibleEntries.filter((entry) => selectedNames.includes(entry.name));
  const selected = selectedEntries.length === 1 ? selectedEntries[0] : null;

  const absolutePath = source.absolutePath(selected ? [...path, selected.name] : path);
  const pathSegments = absolutePath.split('/').filter(Boolean);

  async function copyAbsolutePath() {
    try {
      await copyText(absolutePath);
      setCopiedPath(absolutePath);
    } catch {
      actions.notify('Clipboard unavailable', 'Could not copy the path.');
    }
  }

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  function pinAction(folderPath: string[]) {
    const key = folderPath.join('/');
    const pinned = pinnedFolders.includes(key);
    return { label: pinned ? 'Unpin Folder' : 'Pin Folder', run: () => setPinnedFolders((current) => pinned ? current.filter((item) => item !== key) : [...current, key]) };
  }

  function showLocation(next: FileLocation) {
    setLocation(next.location);
    setPath(next.path);
    setSelectedName(null);
  }

  function navigateTo(nextPath: string[], nextLocation: FileLocation['location'] = 'folder') {
    if (location === nextLocation && source.absolutePath(path) === source.absolutePath(nextPath)) {
      setSelectedName(null);
      return;
    }
    setNavigation((previous) => ({ back: [...previous.back, { path, location }].slice(-100), forward: [] }));
    showLocation({ path: nextPath, location: nextLocation });
  }

  function travel(direction: 'back' | 'forward') {
    const next = navigation[direction].at(-1);
    if (!next) return;
    const opposite = direction === 'back' ? 'forward' : 'back';
    setNavigation((previous) => ({ ...previous, [direction]: previous[direction].slice(0, -1), [opposite]: [...previous[opposite], { path, location }] }));
    showLocation(next);
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
      actions.filesChanged();
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
    } else if (['ArrowDown', 'ArrowUp', ...(viewMode === 'grid' ? ['ArrowLeft', 'ArrowRight'] : [])].includes(e.key)) {
      e.preventDefault();
      const idx = visibleEntries.findIndex((en) => en.name === entry.name);
      const rows = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-file-row]') ?? [])];
      const columns = viewMode === 'grid' ? Math.max(1, rows.filter((row) => row.offsetTop === rows[0]?.offsetTop).length) : 1;
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns : -columns;
      const next = visibleEntries[idx + step];
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
      actions.filesChanged();
    } catch (err) {
      actions.notify('Upload failed', describeError(err));
    } finally {
      setUploading(false);
    }
  }

  const displayOptions = [
    { id: 'list', label: 'List', checked: viewMode === 'list', run: () => setViewMode('list') },
    { id: 'grid', label: 'Grid', checked: viewMode === 'grid', run: () => setViewMode('grid') },
    { id: 'sort-name', label: 'Sort by Name', separator: true, checked: sortBy === 'name', run: () => setSortBy('name') },
    { id: 'sort-type', label: 'Sort by Type', checked: sortBy === 'type', run: () => setSortBy('type') },
    { id: 'sort-size', label: 'Sort by Size', checked: sortBy === 'size', run: () => setSortBy('size') },
    { id: 'sort-modified', label: 'Sort by Modified Date', checked: sortBy === 'modified', run: () => setSortBy('modified') },
    { id: 'ascending', label: 'Ascending', separator: true, checked: sortDirection === 'ascending', run: () => setSortDirection('ascending') },
    { id: 'descending', label: 'Descending', checked: sortDirection === 'descending', run: () => setSortDirection('descending') },
  ];

  useAppMenus({
    file: [
      { id: 'new-folder', label: 'New Folder', disabled: location !== 'folder', run: () => startCreate('directory') },
      { id: 'new-file', label: 'New File', disabled: location !== 'folder', run: () => startCreate('file') },
      { id: 'open', label: 'Open', disabled: location !== 'folder' || !selected, run: () => { if (selected) activate(selected); } },
      { id: 'upload', label: 'Upload File…', disabled: uploading || location !== 'folder', run: () => uploadInputRef.current?.click() },
      { id: 'download', label: 'Download', disabled: location !== 'folder' || selected?.kind !== 'file', run: () => { if (selected) void download(selected); } },
    ],
    view: [
      { id: 'back', label: 'Back', disabled: !navigation.back.length, run: () => travel('back') },
      { id: 'forward', label: 'Forward', disabled: !navigation.forward.length, run: () => travel('forward') },
      ...displayOptions.map((item) => ({ ...item, separatorAbove: item.separator })),
      ...(location === 'folder' ? [{ id: 'refresh', label: 'Refresh', run: refresh }] : []),
      { id: 'hidden', label: 'Show Hidden Files', checked: showHidden, run: () => setShowHidden(!showHidden) },
      { id: 'details', label: 'Show Details', checked: detailsOpen, disabled: location !== 'folder', run: () => setDetailsOpen(!detailsOpen) },
      { id: 'sidebar', label: 'Show Sidebar', checked: !sidebarCollapsed, run: () => setSidebarCollapsed(!sidebarCollapsed) },
    ],
  });

  return (
    <div className="app files" data-testid="app-files" onKeyDownCapture={(event) => {
        if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault(); event.stopPropagation(); travel(event.key === 'ArrowLeft' ? 'back' : 'forward');
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'h') {
          event.preventDefault(); event.stopPropagation(); setShowHidden((value) => !value);
        }
      }}>
      <div className="files-workspace">
        <aside className={`files-sidebar${sidebarCollapsed ? ' collapsed' : ''}`} aria-label="File locations" data-testid="files-sidebar">
          <header className="files-sidebar-header"><h2>Locations</h2><button type="button" className="btn files-sidebar-toggle" data-testid="files-sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><IconSidebar size={18} /></button></header>
          <button
            type="button"
            className={`files-location${location === 'folder' && path.join('/') === source.homePath().join('/') ? ' selected' : ''}`}
            {...drop(source.homePath())}
            data-testid="files-location-home" aria-label="Home" title="Home"
            aria-current={location === 'folder' && path.join('/') === source.homePath().join('/') ? 'location' : undefined}
            onClick={() => navigateTo(source.homePath())}
            onContextMenu={(event) => openContextMenu(event, [{ label: 'Open in Pi', run: () => actions.openPi(source.absolutePath(source.homePath())) }])}
          >
            <IconHome size={19} />
            <span>Home</span>
          </button>
          {standardLocations.filter((item) => !pinnedFolders.some((key) => source.absolutePath(key.split('/')) === item.path)).map((item) => {
            const home = source.absolutePath(source.homePath());
            const destination = folderPath(item.path, home, home, source.homePath());
            const active = location === 'folder' && source.absolutePath(path) === item.path;
            const Icon = item.id === 'documents' ? IconFile : item.id === 'download' ? IconDownload : item.id === 'desktop' ? IconMonitor : IconFolder;
            return <button type="button" key={item.id} className={`files-location${active ? ' selected' : ''}`} {...drop(destination)} data-testid={`files-location-${item.id}`} aria-label={item.name} title={`${item.name} — ${item.path}`} aria-current={active ? 'location' : undefined} onClick={() => navigateTo(destination)} onContextMenu={(event) => openContextMenu(event, [{ label: 'Open Folder', run: () => navigateTo(destination) }, { label: 'Open in Pi', run: () => actions.openPi(item.path) }, pinAction(destination)])}><Icon size={19}/><span>{item.name}</span></button>;
          })}
          <button type="button" className={`files-location${location === 'trash' ? ' selected' : ''}`} aria-current={location === 'trash' ? 'location' : undefined} {...drop('trash')} data-testid="files-location-trash" aria-label="Trash" title="Trash" onClick={() => navigateTo(path, 'trash')}><IconTrash size={19}/><span>Trash</span></button>
          <h2>Pinned</h2>
          {pinnedFolders.length === 0 && !sidebarCollapsed && <p className="files-pinned-hint">Right-click a folder to pin it here.</p>}
          {pinnedFolders.map((key) => {
            const folderPath = key.split('/');
            const name = folderPath[folderPath.length - 1] || '/';
            const active = location === 'folder' && path.join('/') === key;
            return (
              <button
                key={key}
                {...reorderPinned.bind(key)}
                {...drop(folderPath)}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                type="button"
                className={`files-location${active ? ' selected' : ''}`}
                data-testid={`files-pin-${key}`} aria-label={name} title={source.absolutePath(folderPath)}
                aria-current={active ? 'location' : undefined}
                onClick={() => navigateTo(folderPath)}
                onContextMenu={(event) => openContextMenu(event, [{ label: 'Open Folder', run: () => navigateTo(folderPath) }, { label: 'Open in Pi', run: () => actions.openPi(source.absolutePath(folderPath)) }, pinAction(folderPath)])}
              >
                <IconFolder size={19} />
                <span>{name}</span>
              </button>
            );
          })}
        </aside>
        <div className="files-main">
          <div className="app-toolbar">
            <div className="files-navigation">
              <nav className="app-history" aria-label="Folder history">
                <button type="button" className="app-history-back files-drag-parent" data-testid="files-back" aria-label="Back" title="Back · Hold a dragged item here to open the parent folder" aria-disabled={!navigation.back.length} tabIndex={navigation.back.length ? 0 : -1} {...dragParent} onClick={() => travel('back')}><IconChevronRight size={18}/></button>
                <button type="button" data-testid="files-forward" aria-label="Forward" title="Forward" disabled={!navigation.forward.length} onClick={() => travel('forward')}><IconChevronRight size={18}/></button>
              </nav>
              <div className="files-current-folder" data-testid="files-current-folder" title={location === 'trash' ? 'Trash' : source.absolutePath(path)}>
                {location === 'trash' ? <IconTrash size={18}/> : source.absolutePath(path) === source.absolutePath(source.homePath()) ? <IconHome size={18}/> : <IconFolder size={18}/>}
                <span>{location === 'trash' ? 'Trash' : source.absolutePath(path) === source.absolutePath(source.homePath()) ? 'Home' : path.at(-1) || '/'}</span>
              </div>
            </div>
            {location === 'folder' && <div className="app-toolbar-actions">
              <button type="button" className="btn btn-icon" data-testid="files-refresh" aria-label="Refresh folder" title="Refresh folder" onClick={refresh}><IconRefresh size={16}/></button>
              <DropdownMenu label="View" testId="files-view" items={[
                ...displayOptions,
                { label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', separator: true, run: () => setShowHidden((value) => !value) },
                { label: detailsOpen ? 'Hide Details' : 'Show Details', run: () => setDetailsOpen((value) => !value) },
                { label: sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar', run: () => setSidebarCollapsed((value) => !value) },
              ]} />
              <DropdownMenu label="New" testId="files-new" items={[
                { label: 'New Folder', run: () => startCreate('directory') },
                { label: 'New File', run: () => startCreate('file') },
              ]} />
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
            </div>}

          </div>
          {location === 'trash' ? <PluginSurface id="trash" componentProps={{ embedded: true }}/> : <>

          <div className="files-table-scroll" data-testid="files-table-scroll" data-view={viewMode}><div className={`files-table${viewMode === 'grid' ? ' files-grid' : ''}`}>
          {viewMode === 'list' && <div className="files-head" role="row" aria-hidden="true">
            <span>Name</span>
            <span>Modified</span>
          </div>}
          <div className="files-list" tabIndex={0} {...selection.bind} {...drop(path)} onContextMenu={(event) => openContextMenu(event, [
            { label: 'New File', run: () => startCreate('file') },
            { label: 'New Folder', run: () => startCreate('directory') },
            { label: 'Upload File', disabled: uploading, run: () => uploadInputRef.current?.click() },
            { label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', separator: true, run: () => setShowHidden((value) => !value) },
            { label: 'Refresh', run: refresh },
            { label: 'Open in Pi', run: () => actions.openPi(source.absolutePath(path)) },
            pinAction(path),
          ])} role="listbox" aria-multiselectable="true" aria-label="Files" aria-activedescendant={selected ? `file-${selected.name}` : undefined}>
            {visibleEntries.map((entry) => (
              <div
                key={entry.name}
                id={`file-${entry.name}`}
                role="option"
                aria-selected={selectedNames.includes(entry.name)}
                tabIndex={0}
                data-file-row={entry.name}
                data-testid={`file-row-${entry.name}`}
                data-kind={entry.kind}
                className={`file-row${selectedNames.includes(entry.name) ? ' selected' : ''}`}
                draggable
                onDragStart={(event) => {
                  const items = selectedNames.includes(entry.name) ? selectedEntries : [entry];
                  if (!selectedNames.includes(entry.name)) setSelectedName(entry.name);
                  startFileDrag(event, items.map((item) => ({ path: [...path, item.name], kind: item.kind })));
                }}
                onDragEnd={endFileDrag}
                {...drop(entry.kind === 'dir' ? [...path, entry.name] : null)}
                onContextMenu={(event) => {
                  setSelectedName(entry.name);
                  openContextMenu(event, [
                    { label: entry.kind === 'dir' ? 'Open Folder' : 'Open in Preview', run: () => activate(entry) },
                    ...(entry.kind === 'dir' ? [{ label: 'Open in Pi', run: () => actions.openPi(source.absolutePath([...path, entry.name])) }, pinAction([...path, entry.name])] : []),
                    ...(entry.kind === 'file' ? [
                      { label: 'Download', run: () => void download(entry) },
                    ] : []),
                    { label: 'Copy Path', run: () => { void copyText(source.absolutePath([...path, entry.name])).catch(() => actions.notify('Clipboard unavailable', 'Could not copy the file path.')); } },
                    { label: 'Details', run: () => showDetails(entry) },
                    { label: 'Move to Trash', separator: true, danger: true, run: () => setDeleteTarget(entry) },
                  ]);
                }}
                onClick={(event) => selection.select(entry.name, event)}
                onDoubleClick={() => activate(entry)}
                onKeyDown={(e) => onRowKey(e, entry)}
              >
                <span className="file-name">
                  {entry.kind === 'dir' ? <IconFolder size={15} /> : <IconFile size={15} />}
                  <span title={entry.name}>{entry.name}</span>
                </span>
                <span className="file-modified">{entry.modified}</span>
              </div>
            ))}
            {selection.box && <div className="files-selection-box" data-testid="files-selection-box" style={selection.box} aria-hidden="true"/>}
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
            <span>{listError ? 'Folder unavailable' : selectedEntries.length > 1 ? `${selectedEntries.length} of ${visibleEntries.length} selected` : `${visibleEntries.length} ${visibleEntries.length === 1 ? 'item' : 'items'}`}</span>
              <nav className="mono files-path-trail" data-testid="files-absolute-path" aria-label="Folder ancestors">
                <button type="button" className="files-path-segment" {...drop([''])} title="/" onClick={() => navigateTo([''])}>/</button>
                {pathSegments.map((segment, index) => {
                  const destination = `/${pathSegments.slice(0, index + 1).join('/')}`;
                  const isFile = selected?.kind === 'file' && index === pathSegments.length - 1;
                  return <span className="files-path-part" key={destination}>
                    {index > 0 && <span className="files-path-separator" aria-hidden="true">/</span>}
                    {isFile ? <span className="files-path-filename" title={destination}>{segment}</span> : <button type="button" className="files-path-segment" {...drop(folderPath(destination, source.absolutePath(path), source.absolutePath(source.homePath()), source.homePath()))} title={destination} onClick={() => navigateTo(folderPath(destination, source.absolutePath(path), source.absolutePath(source.homePath()), source.homePath()))}>{segment}</button>}
                  </span>;
                })}
              </nav>
            <button type="button" className="files-path-action" data-testid="files-copy-path" aria-label={copiedPath === absolutePath ? 'Copied' : 'Copy absolute path'} title={copiedPath === absolutePath ? 'Copied' : `Copy ${absolutePath}`} onClick={() => void copyAbsolutePath()}><IconCopy size={16}/></button>
          </footer>
          </>}
        </div>
        <FileDetails open={detailsOpen && location === 'folder'} entry={selected} path={source.absolutePath(selected ? [...path, selected.name] : path)} onClose={() => setDetailsOpen(false)} />
      </div>

      {creation && <div className="quicklook-overlay">
        <form className="file-confirm file-create" role="dialog" aria-modal="true" aria-label={creation.kind === 'directory' ? 'New Folder' : 'New File'} data-testid="files-create-dialog" onSubmit={(event) => { event.preventDefault(); void create(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !creation.busy) { event.stopPropagation(); setCreation(null); } }}>
          <h2>{creation.kind === 'directory' ? 'New Folder' : 'New File'}</h2>
          <label>Name<input autoFocus className="input file-create-name" data-testid="files-create-name" value={creation.name} disabled={creation.busy} onChange={(event) => setCreation({ ...creation, name: event.target.value, error: null })} autoComplete="off" /></label>
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

function fileType(entry: FsEntry): string {
  const dot = entry.name.lastIndexOf('.');
  return entry.kind === 'file' && dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : '';
}
