// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { describeError, getDataSource, type FileLocationSettings } from '@lumo/sdk/api/source';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import { IconRefresh } from '@lumo/sdk/shell/icons';
import { AppModal } from '@lumo/sdk/shell/AppModal';
import { Select } from '@lumo/sdk/shell/Select';
import { formatSize } from '@lumo/sdk/utils/file-format';
import { folderPath } from '@lumo/sdk/utils/folder-path';
import { FilePicker } from '@lumo/sdk/apps/FilePicker';

type Location = FileLocationSettings['locations'][number];

export function SettingsFolders({ active }: { active: boolean }) {
  const source = getDataSource();
  const { actions } = useShell();
  const [settings, setSettings] = useState<FileLocationSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [removing, setRemoving] = useState<Location | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true); setError(null);
    source.getFileLocationSettings().then((value) => { if (alive) setSettings(value); }).catch((err) => { if (alive) setError(describeError(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, active, refresh]);


  async function apply(item: Location, path: string, remove = false) {
    if (!settings || busy) return;
    setBusy(item.id); setError(null);
    try { setSettings(await source.setFileLocation(item.id, path, settings.revision, remove)); setRemoving(null); actions.filesChanged(); }
    catch (err) { setError(describeError(err)); }
    finally { setBusy(null); }
  }

  return <>
    <header className="settings-heading"><h2>Folders</h2><button type="button" className="btn btn-icon" title="Refresh" aria-label="Refresh folder locations" disabled={loading || !!busy} onClick={() => setRefresh((value) => value + 1)}><IconRefresh size={16}/></button></header>
    <div className="settings-page">
      <section className="settings-group settings-folder-list" aria-label="Standard folders">
        {settings ? settings.locations.map((item) => <FolderRow key={item.id} item={item} settings={settings} disabled={loading || !!busy} busy={busy === item.id} onApply={(path) => void apply(item, path)} onRemove={() => { setError(null); setRemoving(item); }}/>) : <p>{loading ? 'Loading folders…' : 'Folder locations unavailable.'}</p>}
      </section>
      {error && !removing && <p className="settings-field-error" role="alert">{error}</p>}
    </div>
    {removing && <AppModal onCancel={() => { if (!busy) setRemoving(null); }}><div role="alertdialog" className="settings-folder-confirm" aria-labelledby="folder-remove-title">
      <h3 id="folder-remove-title">Remove {removing.name}?</h3>
      <p>Move this folder and its contents to Trash.</p>
      {error && <p className="settings-field-error" role="alert">{error}</p>}
      <div className="settings-folder-actions"><button type="button" className="btn" disabled={!!busy} autoFocus onClick={() => setRemoving(null)}>Cancel</button><button type="button" className="btn btn-danger" data-testid="settings-folder-remove-confirm" disabled={!!busy} onClick={() => void apply(removing, '', true)}>{busy ? 'Removing…' : 'Remove'}</button></div>
    </div></AppModal>}
  </>;
}

const parentPath = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
const childPath = (parent: string, name: string) => `${parent === '/' ? '' : parent}/${name}`;

function FolderRow({ item, settings, disabled, busy, onApply, onRemove }: { item: Location; settings: FileLocationSettings; disabled: boolean; busy: boolean; onApply: (path: string) => void; onRemove: () => void }) {
  const source = getDataSource();
  const [path, setPath] = useState(item.enabled ? item.path : item.defaultPath);
  const [picking, setPicking] = useState(false);
  const [plan, setPlan] = useState<{ files: number; bytes: number; create: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const exists = item.enabled && item.exists;
  const changed = !exists || path !== item.path;

  useEffect(() => { setPath(item.enabled ? item.path : item.defaultPath); }, [item.path, item.enabled, item.defaultPath]);
  useEffect(() => {
    setPlan(null); setError(null);
    if (!changed) { setPlanning(false); return; }
    let alive = true;
    setPlanning(true);
    source.planFileLocationMove(path, settings.revision, item.id).then((value) => { if (alive) setPlan(value); }).catch((err) => { if (alive) setError(describeError(err)); }).finally(() => { if (alive) setPlanning(false); });
    return () => { alive = false; };
  }, [source, path, changed, settings.revision, item.id]);

  const choices = settings.choices.map((choice) => { const value = childPath(choice.path, item.name); return { value, label: choice.path }; });
  if (!choices.some((choice) => choice.value === path)) choices.unshift({ value: path, label: parentPath(path) });
  choices.push({ value: 'choose', label: 'Choose another folder…' });
  const home = source.absolutePath(source.homePath());

  return <div className="settings-folder-row" data-testid={`settings-folder-${item.id}`}>
    <div className="settings-folder-label"><strong>{item.name}</strong>{!exists && <span>Not added</span>}</div>
    <div className="settings-folder-controls">
      <Select data-testid={`settings-folder-path-${item.id}`} aria-label={`${item.name} location`} value={path} options={choices} disabled={disabled} onChange={(value) => { if (value === 'choose') setPicking(true); else setPath(value); }}/>
      <div className="settings-folder-row-actions"><button type="button" className="btn" data-testid={`settings-folder-apply-${item.id}`} disabled={!changed || !plan || planning || disabled} onClick={() => onApply(path)}>{busy ? 'Updating…' : exists ? 'Apply' : 'Add'}</button>
      {exists && <button type="button" className="btn" data-testid={`settings-folder-remove-${item.id}`} disabled={disabled} onClick={onRemove}>Remove</button>}</div>
    </div>
    {plan && plan.files > 0 && <p role="status">{plan.files} files · {formatSize(plan.bytes)} to move</p>}
    {error && <p className="settings-field-error" role="alert">{error}</p>}
    {picking && <FilePicker mode="folder" initialPath={folderPath(exists ? parentPath(item.path) : home, home, home, source.homePath())} onCancel={() => setPicking(false)} onOpen={(value) => { setPath(childPath(source.absolutePath(value), item.name)); setPicking(false); }}/>}
  </div>;
}
