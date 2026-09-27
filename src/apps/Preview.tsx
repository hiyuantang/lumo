// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCurrentWindow } from '../shell/WindowContext';
import { describeError, getDataSource, type FileRead } from '../api/source';
import { textToBase64 } from '../api/encoding';
import { ApiError } from '../api/transport';
import { useShell } from '../shell/ShellContext';
import { Markdown } from './Markdown';
import { FilePicker } from './FilePicker';
import '../styles/preview.css';

export function Preview() {
  const { actions } = useShell();
  const win = useCurrentWindow();
  const path = win.filePath;
  const [picking, setPicking] = useState(false);
  return <>
    {path ? <PreviewDocument key={JSON.stringify(path)} path={path} onOpen={() => setPicking(true)} /> : <div className="app preview preview-empty" data-testid="app-preview"><p>Choose a file to preview.</p><button type="button" className="btn" data-testid="preview-open" onClick={() => setPicking(true)}>Open file…</button></div>}
    {picking && <FilePicker initialPath={path?.slice(0, -1)} onCancel={() => setPicking(false)} onOpen={(selected) => { setPicking(false); actions.openPreview(selected, false, win.id); }} />}
  </>;
}

function PreviewDocument({ path, onOpen }: { path: string[]; onOpen: () => void }) {
  const source = getDataSource();
  const { state, actions } = useShell();
  const name = path.at(-1) ?? 'File';
  const markdown = /\.(md|markdown|mdown)$/i.test(name);
  const win = useCurrentWindow();
  const mode = win.previewMode ?? 'rendered';
  const setMode = (value: 'rendered' | 'raw') => actions.setPreviewMode(win.id, value);
  const [read, setRead] = useState<FileRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const working = useRef(false);
  const alive = useRef(true);
  const editable = read?.content !== null && !!read?.revision && !read.truncated;
  const dirty = editing && editable && draft !== read?.content;

  useEffect(() => {
    alive.current = true;
    void source.readFile(path).then((result) => {
      if (!alive.current) return;
      setRead(result);
      setDraft(result.content ?? '');
    }).catch((err) => { if (alive.current) setError(describeError(err)); });
    return () => { alive.current = false; };
  }, [path, source]);

  useEffect(() => {
    if (state.navigation?.target === 'preview' && state.navigation.windowId === win.id && state.navigation.edit) setEditing(true);
  }, [state.navigation, win.id]);

  useLayoutEffect(() => actions.registerWindowGuard(win.id, (proceed) => {
    if (working.current) return;
    if (!dirty) proceed();
    else setPending(() => proceed);
  }), [actions, dirty, win.id]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function leaveEditor() {
    const leave = () => { setEditing(false); setDraft(read?.content ?? ''); setConflict(false); setError(null); };
    if (dirty) setPending(() => leave);
    else leave();
  }

  async function reload() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await source.readFile(path);
      if (editing && (result.content === null || result.truncated || !result.revision)) throw new Error('Only complete text files can be edited. Your draft is kept.');
      if (alive.current) { setRead(result); setDraft(result.content ?? ''); setConflict(false); }
    } catch (err) { if (alive.current) setError(describeError(err)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }

  async function save(copy = false, proceed?: () => void) {
    if (!editable || working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      const target = copy ? [...path.slice(0, -1), `${name}.copy`] : path;
      const result = await source.writeFile(target, textToBase64(draft), copy ? null : read!.revision);
      if (!alive.current) return;
      if (!copy) setRead({ ...read!, content: draft, contentBase64: textToBase64(draft), revision: result.revision });
      setEditing(false);
      setConflict(false);
      actions.filesChanged();
      actions.notify(copy ? 'Saved as copy' : 'File saved', copy ? `${name}.copy` : name);
      proceed?.();
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.code === 'stale_revision' && !copy) setConflict(true);
      else setError(describeError(err));
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }

  return <div className="app preview" data-testid="app-preview" onKeyDown={(event) => {
    if (editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  }}>
    <div className="app-toolbar preview-toolbar">
      <button type="button" className="btn" data-testid="preview-open" disabled={busy} onClick={onOpen}>Open…</button>
      <strong title={name}>{name}{dirty && <span className="preview-unsaved" aria-label="Unsaved changes"> •</span>}</strong>
      {editing && editable ? <>
        <button type="button" className="btn" data-testid="editor-close" disabled={busy} onClick={leaveEditor}>Cancel</button>
        <button type="button" className="btn btn-primary" data-testid="editor-save" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </> : <>
        {markdown && <div className="preview-modes" role="group" aria-label="Markdown display">
          <button type="button" className="btn" aria-pressed={mode === 'rendered'} data-testid="preview-mode-rendered" onClick={() => setMode('rendered')}>Rendered</button>
          <button type="button" className="btn" aria-pressed={mode === 'raw'} data-testid="preview-mode-raw" onClick={() => setMode('raw')}>Raw</button>
        </div>}
        <button type="button" className="btn" data-testid="preview-edit" disabled={!editable || busy} onClick={() => { setDraft(read?.content ?? ''); setEditing(true); setError(null); }}>Edit</button>
        <button type="button" className="btn" data-testid="preview-refresh" disabled={busy} onClick={() => void reload()}>Refresh</button>
      </>}
    </div>
    {read?.truncated && <p className="preview-notice" role="status">Showing the first 1 MiB of this file. Editing is unavailable for incomplete files.</p>}
    {error && <p role="alert" className="preview-error">{error}</p>}
    {editing && editable ? <div className="preview-editor" data-testid="file-editor">
      {conflict && <div className="preview-conflict" data-testid="editor-conflict" role="alert"><p>File changed on the server. Your draft is kept.</p><div>
        <button type="button" className="btn" data-testid="editor-reload" disabled={busy} onClick={() => void reload()}>Reload latest</button>
        <button type="button" className="btn" data-testid="editor-save-copy" disabled={busy} onClick={() => void save(true)}>Save as copy</button>
        <button type="button" className="btn" data-testid="editor-conflict-cancel" disabled={busy} onClick={() => setConflict(false)}>Keep editing</button>
      </div></div>}
      <textarea className="preview-editor-input" data-testid="editor-input" aria-label={`Contents of ${name}`} value={draft} onChange={(event) => setDraft(event.target.value)} readOnly={busy} spellCheck={false} autoFocus />
    </div> : <div className="preview-content" tabIndex={0} aria-label="File content">
      {!read ? <p className="preview-empty">{error ? 'Could not open this file.' : 'Loading…'}</p> : read.content === null ? <p className="preview-empty">This file type cannot be previewed yet. Use Files to download it.</p> : markdown && mode === 'rendered' ? <Markdown text={read.content} /> : <pre data-testid="preview-raw">{read.content || 'Empty file'}</pre>}
    </div>}
    <footer className="preview-path" title={source.absolutePath(path)}>{source.absolutePath(path)}</footer>
    {pending && <div className="quicklook-overlay"><div className="file-confirm" role="alertdialog" aria-modal="true" aria-label="Unsaved changes" data-testid="preview-unsaved-dialog">
      <p>Save changes to “{name}” before continuing?</p><div className="file-confirm-actions">
        <button type="button" className="btn" autoFocus onClick={() => setPending(null)}>Keep editing</button>
        <button type="button" className="btn" onClick={() => { const proceed = pending; setPending(null); proceed(); }}>Discard changes</button>
        <button type="button" className="btn btn-primary" onClick={() => void save(false, pending)}>Save changes</button>
      </div>
    </div></div>}
  </div>;
}
