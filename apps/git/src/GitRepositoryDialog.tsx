// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { getDataSource } from '@lumo/sdk/api/source';
import { FilePicker } from '@lumo/sdk/apps/FilePicker';
import { AppConfirmation, errorText } from '@lumo/sdk/apps/ServerAppUI';

export function GitRepositoryDialog({ mode, initialParent, onCancel, onCreated, onBusy }: { mode: 'clone' | 'init'; initialParent: string[]; onCancel: () => void; onCreated: (path: string, parent: string[]) => void; onBusy: (busy: boolean) => void }) {
  const source = getDataSource();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [customName, setCustomName] = useState(false);
  const [parent, setParent] = useState(initialParent);
  const [pickerPath, setPickerPath] = useState(parent);
  useEffect(() => { let alive = true; void source.listDir(parent).then(() => { if (alive) setPickerPath(parent); }).catch(() => { if (alive) setPickerPath(source.homePath()); }); return () => { alive = false; }; }, [source, parent]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const folder = source.absolutePath(parent).replace(/\/$/, '');
  const valid = name.trim() !== '' && !/[\/\\\x00\r\n]/.test(name) && !['.', '..'].includes(name.trim()) && (mode !== 'clone' || url.trim() !== '');
  async function submit() {
    if (busy || !valid) return;
    setBusy(true); onBusy(true); setError('');
    const path = `${folder}/${name.trim()}`;
    try {
      const defaultParent = [...source.homePath(), 'GitHub'];
      if (source.absolutePath(parent) === source.absolutePath(defaultParent)) {
        const entries = await source.listDir(source.homePath());
        if (!entries.some((entry) => entry.name === 'GitHub')) {
          try { await source.createEntry(defaultParent, 'directory'); } catch { await source.listDir(defaultParent); }
        }
      }
      await source.gitAction({ action: mode, path, revision: '', url: mode === 'clone' ? url.trim() : undefined }); onCreated(path, parent); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); onBusy(false); }
  }
  return <>
    <AppConfirmation title={mode === 'clone' ? 'Clone repository' : 'Create repository'} confirm={mode === 'clone' ? 'Clone' : 'Create'} busy={busy} confirmDisabled={!valid} onCancel={onCancel} onConfirm={() => void submit()}>
      <div className="git-repository-fields">
        {mode === 'clone' && <label>Repository URL<input className="input" aria-label="Repository URL" data-testid="git-clone-url" placeholder="https://host/owner/project.git" disabled={busy} value={url} onChange={(event) => { const value = event.target.value; setUrl(value); if (!customName) setName(value.split(/[/:]/).at(-1)?.replace(/\.git$/, '') ?? ''); }}/></label>}
        <label>Folder name<input className="input" aria-label="Repository folder name" data-testid="git-repository-name" placeholder="my-project" disabled={busy} value={name} onChange={(event) => { setCustomName(true); setName(event.target.value); }}/></label>
        <div className="git-destination"><span>Location<strong title={folder || '/'}>{folder || '/'}</strong></span><button className="btn" data-testid="git-repository-location" disabled={busy} onClick={() => setPicking(true)}>Choose…</button></div>
      </div>
      {mode === 'init' && <p>Creates a new folder with an empty repository on main.</p>}
      {error && <p role="alert">{error}</p>}
    </AppConfirmation>
    {picking && <FilePicker mode="folder" initialPath={pickerPath} onCancel={() => setPicking(false)} onOpen={(path) => { setParent(path); setPicking(false); }}/>}
  </>;
}
