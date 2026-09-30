// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { AppModal } from '../shell/AppModal';
import { describeError, getDataSource, type FsEntry } from '../api/source';
import { ApiError } from '../api/transport';
import { IconChevronRight, IconEye, IconEyeOff, IconFile, IconFolder, IconHome } from '../shell/icons';
import { useShell } from '../shell/ShellContext';
import { formatSize } from '../utils/file-format';
import '../styles/file-picker.css';

export function FilePicker({ initialPath, mode = 'file', onOpen, onCancel }: { initialPath?: string[]; mode?: 'file' | 'folder'; onOpen: (path: string[]) => void; onCancel: () => void }) {
  const source = getDataSource();
  const { actions } = useShell();
  const newFolderButton = useRef<HTMLButtonElement>(null);
  const creationLock = useRef(false);
  const [creation, setCreation] = useState<{ name: string; busy: boolean; error: string | null } | null>(null);
  const [path, setPath] = useState(() => initialPath ?? source.homePath());
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    void (async () => {
      await source.getIdentity().catch(() => null);
      if (!alive) return;
      if (path.length === 1 && path[0] !== '' && path[0] !== source.homePath()[0]) { setPath(source.homePath()); return; }
      try {
        const result = await source.listDir(path);
        if (alive) setEntries(result);
      } catch (err) { if (alive) { setEntries([]); setError(describeError(err)); } }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [source, path, revision]);

  function cancelCreation() {
    if (creationLock.current) return;
    setCreation(null);
    requestAnimationFrame(() => newFolderButton.current?.focus());
  }
  function dismiss() {
    if (creationLock.current) return;
    if (creation) cancelCreation(); else onCancel();
  }
  async function createFolder() {
    if (!creation || creationLock.current) return;
    const name = creation.name.trim();
    if (!name || name === '.' || name === '..' || /[\/\x00]/.test(name)) {
      setCreation({ ...creation, error: 'Enter a folder name without slashes.' }); return;
    }
    creationLock.current = true; setCreation({ ...creation, busy: true, error: null });
    try {
      await source.createEntry([...path, name], 'directory');
      setSelected(name); setSearch(''); if (name.startsWith('.')) setHidden(true);
      setCreation(null); setLoading(true); setRevision((value) => value + 1); actions.filesChanged();
    } catch (err) { setCreation({ ...creation, busy: false, error: err instanceof ApiError && err.code === 'conflict' ? 'A file or folder with this name already exists.' : describeError(err) }); }
    finally { creationLock.current = false; }
  }

  function navigate(next: string[]) {
    setPath(next); setSelected(null); setSearch(''); setEntries([]); setLoading(true);
  }
  function open(entry: FsEntry) {
    const next = [...path, entry.name];
    if (entry.kind === 'dir') navigate(next);
    else if (mode === 'file') onOpen(next);
  }
  const visible = entries.filter((entry) => (mode === 'file' || entry.kind === 'dir') && (hidden || !entry.name.startsWith('.')) && entry.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name));
  const chosen = visible.find((entry) => entry.name === selected);
  const segments = source.absolutePath(path).split('/').filter(Boolean);

  return <AppModal onCancel={dismiss}><div className="file-picker" role="dialog" aria-label={mode === 'folder' ? 'Choose folder' : 'Open file'} data-testid="file-picker">
    <div className="file-picker-body">
      <header><h2>{mode === 'folder' ? 'Choose folder' : 'Open file'}</h2><button type="button" className="file-picker-close" aria-label="Cancel file selection" disabled={creation?.busy} onClick={dismiss}>×</button></header>
      <div className="file-picker-location">
        <button type="button" className="btn btn-icon" aria-label="Home folder" disabled={!!creation} onClick={() => navigate(source.homePath())}><IconHome size={16}/></button>
        <button type="button" className="btn btn-icon file-picker-parent" aria-label="Parent folder" disabled={!segments.length || !!creation} onClick={() => navigate(['', ...segments.slice(0, -1)])}><IconChevronRight size={16}/></button>
        <nav aria-label="Folder path">
          <button type="button" aria-label="Filesystem root" title="/" disabled={!!creation} onClick={() => navigate([''])}>/</button>
          {segments.map((segment, index) => <span className="file-picker-path-part" key={index}>
            {index > 0 && <span className="file-picker-path-separator" aria-hidden="true">/</span>}
            <button type="button" disabled={!!creation} onClick={() => navigate(['', ...segments.slice(0, index + 1)])} title={`/${segments.slice(0, index + 1).join('/')}`}>{segment}</button>
          </span>)}
        </nav>
      </div>
      <div className="file-picker-filter"><label className="app-search"><input type="search" disabled={!!creation} autoFocus aria-label="Filter files" placeholder="Find in this folder" value={search} onChange={(event) => { setSearch(event.target.value); setSelected(null); }}/></label><button type="button" className="btn btn-icon" disabled={!!creation} aria-label="Hidden files" title={hidden ? 'Hide hidden files' : 'Show hidden files'} data-testid="file-picker-hidden" aria-pressed={hidden} onClick={() => { setHidden(!hidden); setSelected(null); }}>{hidden ? <IconEye size={18}/> : <IconEyeOff size={18}/>}</button></div>
      <div className="file-picker-list" role="listbox" aria-label={mode === 'folder' ? 'Choose a folder' : 'Choose a file'} aria-busy={loading} onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      }}>
        {loading ? <p role="status">Loading files…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="btn" onClick={() => setRevision((value) => value + 1)}>Try again</button></div> : visible.length ? visible.map((entry) => <button type="button" role="option" disabled={!!creation} aria-selected={selected === entry.name} key={entry.name} data-testid={`file-picker-entry-${entry.name}`} onFocus={() => setSelected(entry.name)} onClick={() => setSelected(entry.name)} onDoubleClick={() => open(entry)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); open(entry); } }}>
          {entry.kind === 'dir' ? <IconFolder size={19}/> : <IconFile size={19}/>}<span>{entry.name}</span><small>{entry.kind === 'dir' ? 'Folder' : formatSize(entry.size)}</small>
        </button>) : <p role="status">{search ? 'No matching files.' : 'This folder is empty.'}</p>}
      </div>
      {creation ? <form className="file-picker-create" aria-label="Create folder" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}>
        {creation.error && <p role="alert">{creation.error}</p>}
        <div><input className="input" autoFocus aria-label="New folder name" placeholder="Folder name" value={creation.name} disabled={creation.busy} onChange={(event) => setCreation({ ...creation, name: event.target.value, error: null })}/><button type="button" className="btn" disabled={creation.busy} onClick={cancelCreation}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="file-picker-create" disabled={creation.busy || !creation.name.trim()}>{creation.busy ? 'Creating…' : 'Create'}</button></div>
      </form> : <footer>{mode === 'folder' && <button ref={newFolderButton} type="button" className="btn" data-testid="file-picker-new-folder" disabled={loading || !!error} onClick={() => setCreation({ name: '', busy: false, error: null })}>New folder</button>}<span title={source.absolutePath(path)}>{source.absolutePath(path)}</span><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="button" className="btn btn-primary" data-testid="file-picker-open" disabled={loading || !!error || (mode === 'file' && !chosen)} onClick={() => { if (mode === 'folder') onOpen(chosen ? [...path, chosen.name] : path); else if (chosen) open(chosen); }}>{mode === 'folder' ? 'Choose' : 'Open'}</button></footer>}
    </div>
  </div></AppModal>;
}
