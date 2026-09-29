// SPDX-License-Identifier: AGPL-3.0-only
import { IconRefresh } from '../shell/icons';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppMenus } from '../shell/appMenus';
import { useAppPreference } from '../shell/useAppState';
import { useContextMenu } from '../shell/ContextMenu';
import { copyText } from '../utils/clipboard';
import { useCurrentWindow } from '../shell/WindowContext';
import { describeError, getDataSource, type FileRead } from '../api/source';
import { textToBase64 } from '../api/encoding';
import { ApiError } from '../api/transport';
import { useShell } from '../shell/ShellContext';
import { Markdown } from './Markdown';
import { HtmlPreview } from './HtmlPreview';
import { ImagePreview, imageType } from './ImagePreview';
import { FilePicker } from './FilePicker';
import '../styles/preview.css';

export function Preview() {
  const { actions } = useShell();
  const win = useCurrentWindow();
  const path = win.filePath;
  const [picking, setPicking] = useState(false);
  useAppMenus({ file: [{ id: 'open', label: 'Open File…', run: () => setPicking(true) }] });
  const Document = imageType(path?.at(-1) ?? '') ? ImagePreview : PreviewDocument;
  return <>
    {path ? <Document key={JSON.stringify(path)} path={path} onOpen={() => setPicking(true)} /> : <div className="app preview preview-empty" data-testid="app-preview"><p>Choose a file to preview.</p><button type="button" className="btn" data-testid="preview-open" onClick={() => setPicking(true)}>Open file…</button></div>}
    {picking && <FilePicker initialPath={path?.slice(0, -1)} onCancel={() => setPicking(false)} onOpen={(selected) => { setPicking(false); actions.openPreview(selected, false, win.id); }} />}
  </>;
}

function PreviewDocument({ path, onOpen }: { path: string[]; onOpen: () => void }) {
  const source = getDataSource();
  const openContextMenu = useContextMenu();
  const { state, actions } = useShell();
  const name = path.at(-1) ?? 'File';
  const markdown = /\.(md|markdown|mdown)$/i.test(name);
  const html = /\.(html?|xhtml)$/i.test(name);
  const rendered = markdown || html;
  const win = useCurrentWindow();
  const mode = win.previewMode ?? 'rendered';
  const setMode = (value: 'rendered' | 'raw') => actions.setPreviewMode(win.id, value);
  const [read, setRead] = useState<FileRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | null>('load');
  const [conflict, setConflict] = useState(false);
  const [autoSave, setAutoSave] = useAppPreference<boolean>('preview', 'auto-save', false);
  const [autoSavePaused, setAutoSavePaused] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const working = useRef(false);
  const alive = useRef(true);
  const editable = typeof read?.content === 'string' && !!read.revision && !read.truncated;
  const editing = editable && (!rendered || mode === 'raw');
  const dirty = editable && draft !== read?.content;

  useEffect(() => {
    alive.current = true;
    void source.readFile(path).then((result) => {
      if (!alive.current) return;
      setRead(result);
      setDraft(result.content ?? '');
    }).catch((err) => { if (alive.current) setError(describeError(err)); })
      .finally(() => { if (alive.current) setBusy(null); });
    return () => { alive.current = false; };
  }, [path, source]);

  useEffect(() => {
    if (state.navigation?.target === 'preview' && state.navigation.windowId === win.id && state.navigation.edit) actions.setPreviewMode(win.id, 'raw');
  }, [actions, state.navigation, win.id]);

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

  async function reload() {
    if (working.current) return;
    working.current = true;
    setBusy('load');
    setError(null);
    try {
      const result = await source.readFile(path);
      if (dirty && (result.content === null || result.truncated || !result.revision)) throw new Error('Only complete text files can be edited. Your draft is kept.');
      if (alive.current) { setRead(result); setDraft(result.content ?? ''); setConflict(false); setAutoSavePaused(false); }
    } catch (err) { if (alive.current) setError(describeError(err)); }
    finally { working.current = false; if (alive.current) setBusy(null); }
  }

  function requestReload() {
    if (dirty) setPending(() => () => { void reload(); });
    else void reload();
  }

  const save = useCallback(async (copy = false, proceed?: () => void, automatic = false) => {
    if (!editable || working.current) return;
    working.current = true;
    setBusy('save');
    setError(null);
    setPending(null);
    const content = draft;
    try {
      const target = copy ? [...path.slice(0, -1), `${name}.copy`] : path;
      const encoded = textToBase64(content);
      const result = await source.writeFile(target, encoded, copy ? null : read!.revision);
      if (!alive.current) return;
      if (!copy) {
        setRead({ ...read!, content, contentBase64: encoded, revision: result.revision });
        setConflict(false);
        setAutoSavePaused(false);
      }
      actions.filesChanged();
      if (!automatic) actions.notify(copy ? 'Saved as copy' : 'File saved', copy ? `${name}.copy` : name);
      proceed?.();
    } catch (err) {
      if (!alive.current) return;
      setAutoSavePaused(true);
      if (err instanceof ApiError && err.code === 'stale_revision' && !copy) setConflict(true);
      else setError(describeError(err));
    } finally { working.current = false; if (alive.current) setBusy(null); }
  }, [actions, draft, editable, name, path, read, source]);

  useEffect(() => {
    if (!autoSave || !dirty || busy || conflict || autoSavePaused || pending) return;
    const timer = window.setTimeout(() => { void save(false, undefined, true); }, 800);
    return () => window.clearTimeout(timer);
  }, [autoSave, dirty, busy, conflict, autoSavePaused, pending, save]);

  useAppMenus({
    app: [{ id: 'auto-save', label: 'Auto-save', checked: autoSave, disabled: !editable, run: () => { setAutoSave(!autoSave); if (!conflict) setAutoSavePaused(false); } }],
    file: [{ id: 'save', label: 'Save', hint: '⌘S', disabled: !dirty || busy !== null, run: () => { void save(); } }],
    view: [
      { id: 'refresh', label: 'Refresh', disabled: busy !== null, run: requestReload },
      ...(rendered ? [
        { id: 'rendered', label: 'Rendered', checked: mode === 'rendered', run: () => setMode('rendered') },
        { id: 'raw', label: 'Raw', checked: mode === 'raw', run: () => setMode('raw') },
      ] : []),
    ],
  });

  return <div className="app preview" data-testid="app-preview" onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (dirty) void save(); }
  }}>
    <div className="app-toolbar preview-toolbar">
      <strong title={name}>{name}{dirty && <span className="preview-unsaved" aria-label="Unsaved changes"> •</span>}</strong>
      <div className="app-toolbar-actions">
        {rendered && <div className="preview-modes" role="group" aria-label={html ? "HTML display" : "Markdown display"}>
          <button type="button" className="btn" aria-pressed={mode === 'rendered'} data-testid="preview-mode-rendered" onClick={() => setMode('rendered')}>Rendered</button>
          <button type="button" className="btn" aria-pressed={mode === 'raw'} data-testid="preview-mode-raw" onClick={() => setMode('raw')}>Raw</button>
        </div>}
        <button type="button" className="btn" data-testid="preview-open" disabled={busy !== null} onClick={onOpen}>Open…</button>
        <button aria-label="Refresh" title="Refresh" type="button" className="btn btn-icon" data-testid="preview-refresh" disabled={busy !== null} onClick={requestReload}><IconRefresh size={16}/></button>
        <button type="button" className="btn btn-primary" data-testid="editor-save" disabled={!dirty || busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
    {read?.truncated && <p className="preview-notice" role="status">Showing the first 1 MiB of this file. Editing is unavailable for incomplete files.</p>}
    {error && <p role="alert" className="preview-error">{error}</p>}
    {conflict && <div className="preview-conflict" data-testid="editor-conflict" role="alert"><p>File changed on the server. Your draft is kept.{autoSave ? ' Auto-save is paused.' : ''}</p><div>
      <button type="button" className="btn" data-testid="editor-reload" disabled={busy !== null} onClick={requestReload}>Reload latest</button>
      <button type="button" className="btn" data-testid="editor-save-copy" disabled={busy !== null} onClick={() => void save(true)}>Save as copy</button>
    </div></div>}
    {editing ? <div className="preview-editor" data-testid="file-editor">
      <textarea className="preview-editor-input" data-testid="editor-input" aria-label={`Contents of ${name}`} value={draft} onChange={(event) => setDraft(event.target.value)} readOnly={busy === 'load' || !!pending} spellCheck={false} />
    </div> : <div className={`preview-content${html && mode === 'rendered' ? ' preview-html-content' : ''}`} tabIndex={0} aria-label="File content" onContextMenu={(event) => {
      const selection = window.getSelection()?.toString();
      openContextMenu(event, [
        ...(selection ? [{ label: 'Copy', run: () => { void copyText(selection).catch(() => actions.notify('Clipboard unavailable', 'Use the keyboard shortcut to copy.')); } }] : []),
        ...(rendered ? [{ label: mode === 'rendered' ? 'Show Raw' : 'Show Rendered', run: () => setMode(mode === 'rendered' ? 'raw' : 'rendered') }] : []),
        { label: 'Copy Path', run: () => { void copyText(source.absolutePath(path)).catch(() => actions.notify('Clipboard unavailable', 'Could not copy the file path.')); } },
      ]);
    }}>
      {!read ? <p className="preview-empty">{error ? 'Could not open this file.' : 'Loading…'}</p> : read.content === null ? <p className="preview-empty">This file type cannot be previewed yet. Use Files to download it.</p> : html && mode === 'rendered' ? <HtmlPreview text={editable ? draft : read.content} name={name}/> : markdown && mode === 'rendered' ? <Markdown text={editable ? draft : read.content} /> : <pre data-testid="preview-raw">{read.content || 'Empty file'}</pre>}
    </div>}
    <footer className="preview-path"><span title={source.absolutePath(path)}>{source.absolutePath(path)}</span><span role="status" data-testid="preview-save-status">{busy === 'save' ? 'Saving…' : autoSave && autoSavePaused ? 'Auto-save paused' : dirty ? 'Unsaved changes' : editable ? 'Saved' : 'Read-only'}</span></footer>
    {pending && <div className="quicklook-overlay"><div className="file-confirm" role="alertdialog" aria-modal="true" aria-label="Unsaved changes" data-testid="preview-unsaved-dialog">
      <p>Save changes to “{name}” before continuing?</p><div className="file-confirm-actions">
        <button type="button" className="btn" autoFocus onClick={() => setPending(null)}>Keep editing</button>
        <button type="button" className="btn" onClick={() => { const proceed = pending; setPending(null); proceed(); }}>Discard changes</button>
        <button type="button" className="btn btn-primary" onClick={() => void save(false, pending)}>Save changes</button>
      </div>
    </div></div>}
  </div>;
}
